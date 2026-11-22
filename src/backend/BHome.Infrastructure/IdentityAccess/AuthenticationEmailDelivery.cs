using System.Security.Cryptography;
using System.Text.Json;
using System.Text;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class AuthenticationEmailDelivery(Compact24DbContext db, CompactNotificationWriter sql,
    IDataProtectionProvider protection, IOptions<AuthenticationEmailOptions> options,
    IHostEnvironment environment, IOptions<SessionOptions> sessions, IOptions<NotificationChannelOptions> channels,
    UserManager<ApplicationUser> users, NotificationEmailContent contractEmail,
    IOptions<EmailOptions> email) : IPasswordResetDelivery
{
    public void ValidateInvitationRecipient(string destination, bool automaticTenantSetup = false)
    {
        if (email.Value.Enabled && !email.Value.RecipientAllowed(destination, environment.EnvironmentName))
            throw new NotificationException(503, "email_recipient_not_allowed");
    }
    private IDataProtector Protector => protection.CreateProtector("BHome.AuthenticationEmail.v1");
    public bool IsAvailable => IsAvailableFor("PasswordReset");
    public bool IsAvailableFor(string kind) => channels.Value.Enabled && kind switch
    {
        "PasswordReset" => options.Value.PasswordResetConfigured(environment.IsDevelopment()),
        "StaffInvitation" or "TenantInvitation" or "PostActivationTenantInvitation" => options.Value.InvitationConfigured(environment.IsDevelopment()),
        "StaffCredentials" => email.Value.Enabled && email.Value.ValidForEnvironment(environment.EnvironmentName),
        "EmailConfirmation" => options.Value.VerificationConfigured(environment.IsDevelopment()),
        _ => false
    };
    public bool IsDurable => true;
    private sealed record Envelope(AuthenticationEmailRequest Request);
    internal sealed record Content(string Destination, string Title, string Body, string? ActionUrl,
        IReadOnlyList<EmailAttachment>? Attachments = null, string? MobileActionUrl = null, EmailCredentials? Credentials = null, string? DeliveryEventType = null);

    internal static string CallbackLink(string callback, string userName, string token) =>
        callback + (new Uri(callback).Scheme == "bhome" ? "?" : "#") +
        "userName=" + Uri.EscapeDataString(userName) + "&token=" + Uri.EscapeDataString(token);

    public async Task EnsureQueueWritableAsync(CancellationToken t)
    {
        var transaction = db.Database.CurrentTransaction ?? throw new InvalidOperationException("Authentication email requires the grant transaction.");
        // Exercise the same durable sink for every identifier, so a system-wide Outbox write
        // failure cannot reveal account existence. The savepoint removes the probe immediately;
        // no notification, delivery, identifier or token is retained or visible to a worker.
        const string savepoint = "authentication_email_acceptance";
        await transaction.CreateSavepointAsync(savepoint, t);
        await sql.Execute("""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,next_delivery_at)
            VALUES(@id,'OUTBOX',@key,'CHANNEL_DELIVERY','{"schemaVersion":1,"recordType":"ChannelDelivery"}'::jsonb,@now,'Pending',@now)
            """, t, ("id", Guid.NewGuid()), ("key", "authentication-email:acceptance:" + Guid.NewGuid()), ("now", sql.Now));
        await transaction.RollbackToSavepointAsync(savepoint, t);
        await transaction.ReleaseSavepointAsync(savepoint, t);
    }

    public Task SendAsync(Guid userId, string destination, string token, CancellationToken t) =>
        QueueAsync(new(userId, destination, token, sql.Now.AddMinutes(sessions.Value.PasswordResetMinutes)), t);

    public async Task QueueAsync(AuthenticationEmailRequest request, CancellationToken t)
    {
        if (!IsAvailableFor(request.Kind)) throw new IntegrationUnavailableException("Authentication email callbacks or channel processing are not configured.");
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Authentication email requires the grant transaction.");
        if (!EmailOptions.ValidAddress(request.Destination)) throw new ChannelDeliveryException("email_recipient_invalid");
        var user = await db.Users.SingleAsync(u => u.Id == request.UserId, t);
        var roles = db.Entry(user).Property<string[]>("roles").CurrentValue!;
        var role = roles.Contains("Owner") ? "Owner" : roles.Contains("Staff") ? "Staff" : "Tenant";
        var hash = IdentitySecurityStore.Hash(request.Token);
        var key = $"authentication-email:{request.Kind}:{user.Id}:{hash}";
        var verification = request.Kind == "EmailConfirmation";
        var credentials = request.Kind == "StaffCredentials";
        var eventType = verification ? "EMAIL_CONFIRMATION_REQUESTED" : request.Kind == "PasswordReset" ? "PASSWORD_RESET_REQUESTED" : credentials ? "STAFF_PASSWORD_ISSUED" : "ACCOUNT_INVITATION";
        await sql.Emit(user.Id, role, null, key, eventType, "Account", verification ? "Xác nhận email BHOME" : credentials ? "Mật khẩu Staff mới" : "Hướng dẫn thiết lập mật khẩu",
            credentials ? "Owner đã cấp mật khẩu mới cho tài khoản Staff. Kiểm tra email cá nhân để đăng nhập." : "Kiểm tra email của chính bạn để hoàn tất yêu cầu; không chia sẻ liên kết xác nhận.",
            "Account", user.Id, t, channels: ["IN_APP", "EMAIL"]);
        var notice = await sql.Scalar<Guid>("SELECT id FROM notifications WHERE record_kind='INBOX' AND recipient_user_id=@user AND event_key=@key", t, ("user", user.Id), ("key", key));
        var payload = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "ChannelDelivery",
            notificationId = notice,
            recipient = user.Id,
            role,
            channel = "EMAIL",
            eventType,
            authenticationKind = request.Kind,
            tokenHash = hash,
            destinationHash = IdentitySecurityStore.Hash(request.Destination.Trim().ToUpperInvariant()),
            expiresAt = request.ExpiresAt,
            protectedAuthenticationEmail = Protector.Protect(JsonSerializer.Serialize(new Envelope(request)))
        }, CompactNotificationWriter.Json);
        await sql.Execute("""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,next_delivery_at)
            VALUES(@id,'OUTBOX',@key,'CHANNEL_DELIVERY',@data::jsonb,@now,'Pending',@now)
            ON CONFLICT(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT') DO NOTHING
            """, t, ("id", Guid.NewGuid()), ("key", $"channel:{notice}:EMAIL"), ("data", payload), ("now", sql.Now));
    }

    internal async Task<Content?> ResolveAsync(Guid recipient, string protectedPayload, CancellationToken t)
    {
        AuthenticationEmailRequest request;
        try { request = JsonSerializer.Deserialize<Envelope>(Protector.Unprotect(protectedPayload))!.Request; }
        catch (Exception e) when (e is CryptographicException or JsonException or FormatException)
        { throw new ChannelDeliveryException("authentication_email_protection_unavailable"); }
        if (request.UserId != recipient || request.ExpiresAt <= sql.Now) return null;
        if (request.Kind == "StaffCredentials")
        {
            var staff = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == recipient, t);
            if (staff is null || !staff.IsActive || !staff.EmailConfirmed ||
                !string.Equals(staff.Email, request.Destination, StringComparison.OrdinalIgnoreCase) ||
                !((await db.Users.Where(u => u.Id == recipient).Select(u => EF.Property<string[]>(u, "roles")).SingleAsync(t)).Contains("Staff")) ||
                staff.PasswordHash is null || users.PasswordHasher.VerifyHashedPassword(staff, staff.PasswordHash, request.Token) == PasswordVerificationResult.Failed)
                return null;
            var staffName = await db.Users.Where(u => u.Id == recipient).Select(u => EF.Property<string>(u, "full_name")).SingleAsync(t);
            var credentialBody = $"Xin chào {staffName ?? "bạn"},\n\nNgười quản lý đã cấp mật khẩu mới cho tài khoản Nhân viên vận hành của bạn trên BHOME.";
            var portal = options.Value.StaffPortalUrl;
            if (!string.IsNullOrWhiteSpace(portal) && !options.Value.Trusted(portal, environment.IsDevelopment()))
                throw new ChannelDeliveryException("authentication_email_url_invalid");
            return new(request.Destination, "Thông tin tài khoản nhân viên", credentialBody,
                string.IsNullOrWhiteSpace(portal) ? null : portal, Credentials: new(request.Destination, request.Token));
        }
        var verification = request.Kind == "EmailConfirmation";
        var hash = IdentitySecurityStore.Hash(request.Token);
        var eligible = verification ? await EmailVerificationService.CurrentAsync(sql, recipient, request.Destination, request.Token, t) : await sql.Scalar<bool>("""
            SELECT EXISTS(SELECT 1 FROM users WHERE id=@user AND is_active AND lower(email)=lower(@email)
              AND reset_token_hash=@hash AND reset_expires_at>@now AND reset_consumed_at IS NULL
              AND email_confirmed=@confirmed)
            """, t, ("user", recipient), ("email", request.Destination), ("hash", hash), ("now", sql.Now), ("confirmed", request.Kind == "PasswordReset"));
        if (!eligible) return null;
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == recipient, t);
        if (verification && (!string.Equals(user.Email, request.Destination, StringComparison.OrdinalIgnoreCase) ||
            !await users.VerifyUserTokenAsync(user, users.Options.Tokens.EmailConfirmationTokenProvider, "EmailConfirmation",
                Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Token))))) return null;
        var roles = await db.Users.Where(u => u.Id == recipient).Select(u => EF.Property<string[]>(u, "roles")).SingleAsync(t);
        var automaticTenantSetup = request.Kind == "PostActivationTenantInvitation";
        var tenantInvitation = automaticTenantSetup || request.Kind == "TenantInvitation";
        if (request.Kind == "StaffInvitation" && !roles.Contains("Staff") || tenantInvitation && !roles.Contains("Tenant")) return null;
        var owner = roles.Contains("Owner");
        var reset = request.Kind == "PasswordReset";
        var url = verification ? owner ? options.Value.WebVerificationUrl : options.Value.MobileVerificationUrl :
            reset ? owner ? options.Value.WebResetUrl : options.Value.MobileResetUrl : owner ? options.Value.WebInvitationUrl : options.Value.MobileInvitationUrl;
        if (!options.Value.Trusted(url, environment.IsDevelopment())) throw new ChannelDeliveryException("authentication_email_url_invalid");
        string Link(string callback) => CallbackLink(callback, user.UserName!, request.Token);
        var nativeLink = new Uri(url).Scheme == "bhome" ? Link(url) : null;
        // Mail clients may remove custom-scheme anchors. Existing anonymous Web pages
        // accept the same token for every role; retain the native link as an alternative.
        if (nativeLink is not null)
        {
            url = verification ? options.Value.WebVerificationUrl : reset ? options.Value.WebResetUrl : options.Value.WebInvitationUrl;
            if (!options.Value.Trusted(url, environment.IsDevelopment()) || new Uri(url).Scheme is not ("https" or "http"))
                throw new ChannelDeliveryException("authentication_email_url_invalid");
        }
        var link = Link(url);
        var title = verification ? "Xác nhận email BHOME" : reset ? "Yêu cầu đặt lại mật khẩu" : request.Kind == "StaffInvitation" ? "Lời mời tài khoản Staff" : "Chào mừng bạn đến BHOME";
        var name = await db.Users.Where(u => u.Id == recipient).Select(u => EF.Property<string>(u, "full_name")).SingleAsync(t);
        var expiry = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(request.ExpiresAt, "Asia/Ho_Chi_Minh");
        var body = $"Xin chào {name ?? "bạn"},\n\n" + (verification ? "Vui lòng xác nhận địa chỉ email đã đăng ký với BHOME bằng liên kết trong email này. Sau khi xác nhận, bạn có thể yêu cầu đặt lại mật khẩu." :
            reset ? "BHOME nhận được yêu cầu đặt lại mật khẩu của bạn." : "Bạn được mời sử dụng tài khoản BHOME. Hãy thiết lập mật khẩu trước khi đăng nhập trên ứng dụng BHOME.") +
            $"\nTài khoản: {request.Destination}\nLiên kết chỉ dùng một lần, hết hạn lúc {expiry:HH:mm dd/MM/yyyy} (giờ Việt Nam).\n\nNếu không yêu cầu thao tác này, hãy bỏ qua email hoặc liên hệ Owner. Không chia sẻ liên kết này.";
        IReadOnlyList<EmailAttachment>? attachments = null;
        if (tenantInvitation)
        {
            var contract = await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking()
                .Where(c => c.TenantUserId == recipient && c.Kind == BHome.Domain.TenantContracts.ContractKind.Main &&
                    c.Status == BHome.Domain.TenantContracts.ContractStatus.Active)
                .OrderByDescending(c => c.ActivatedAt)
                .Select(c => new
                {
                    c.Id,
                    SeparateConfirmation = c.InitialPaymentRequired &&
                    c.SigningMode == BHome.Application.Contracts.ContractSigningModes.Internal
                }).FirstOrDefaultAsync(t);
            if (contract is { SeparateConfirmation: false } && await contractEmail.MainConfirmationAsync(contract.Id, recipient, t) is { } confirmed)
            {
                title = confirmed.Title;
                attachments = await contractEmail.MainAttachmentsAsync(contract.Id, recipient, request.Destination, t);
                body = confirmed.Body + "\nHãy dùng liên kết trong email này để tự đặt mật khẩu trước khi đăng nhập. Không chia sẻ liên kết này.\n\n" + body;
            }
        }
        return new(request.Destination, title, body, link, attachments, nativeLink, DeliveryEventType: automaticTenantSetup ? "TENANT_SETUP_AFTER_ACTIVATION" : null);
    }
}
