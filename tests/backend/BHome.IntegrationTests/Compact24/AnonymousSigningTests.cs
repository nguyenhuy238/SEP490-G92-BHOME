using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using iText.Signatures;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Compact24;

public sealed class AnonymousSigningTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    internal string? LiveRecipient { get; init; }
    private sealed class Diagnostic : Microsoft.AspNetCore.Diagnostics.IExceptionHandler
    {
        public static ConcurrentQueue<string> Errors { get; } = new();
        public ValueTask<bool> TryHandleAsync(Microsoft.AspNetCore.Http.HttpContext context, Exception e, CancellationToken t)
        { if (e is not ContractException) Errors.Enqueue(e.ToString()); return ValueTask.FromResult(false); }
    }
    private sealed class Delivery : INotificationChannelProvider, IPasswordResetDelivery
    {
        public Func<ChannelMessage, CancellationToken, Task<string>>? LiveSend { get; set; }
        public ConcurrentQueue<ChannelMessage> Messages { get; } = new();
        public ConcurrentDictionary<Guid, string> AccountTokens { get; } = new();
        public int AccountSendCount { get; private set; }
        public bool IsAvailable => true;
        public bool IsConfigured(string channel) => channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => true;
        public async Task<string> SendAsync(ChannelMessage message, CancellationToken t)
        {
            Messages.Enqueue(message);
            return LiveSend is null ? "test-only" : await LiveSend(message, t);
        }
        public Task SendAsync(Guid id, string destination, string token, CancellationToken t) { AccountTokens[id] = token; AccountSendCount++; return Task.CompletedTask; }
    }
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, object input, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(input) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await client.SendAsync(request);
    }
    private static async Task<T> Result<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()} {string.Join("\n", Diagnostic.Errors.TakeLast(1))}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static async Task SignOwnerWithOtp(HttpClient owner, HttpClient staff, string path, Delivery delivery, IServiceProvider? externalSigner = null, bool ownerSession = false)
    {
        var before = await owner.GetFromJsonAsync<ContractView>(path);
        Assert.Equal("PendingSigning", before!.Status);
        var tenantPdf = await owner.GetByteArrayAsync(path + "/document");
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, path + "/signing", new SigningInput(Guid.Empty, Method: SigningMethods.Otp))).StatusCode);
        if (externalSigner is not null)
        {
            await Result<SignatureView>(await Post(owner, path + "/signing", new SigningInput(Guid.Empty, Method: SigningMethods.UploadProof)));
            var source = await owner.GetByteArrayAsync(path + "/signing/upload-source");
            Assert.Equal(tenantPdf, source);
            async Task<HttpResponseMessage> Upload(byte[] content, Guid key)
            {
                using var request = new HttpRequestMessage(HttpMethod.Put, path + "/signing/upload") { Content = new ByteArrayContent(content) };
                request.Content.Headers.ContentType = new("application/pdf");
                request.Headers.Add("Idempotency-Key", key.ToString());
                return await owner.SendAsync(request);
            }
            Assert.Equal(HttpStatusCode.BadRequest, (await Upload(source, Guid.NewGuid())).StatusCode);
            using var rsa = RSA.Create(2048);
            using var cert = new System.Security.Cryptography.X509Certificates.CertificateRequest("CN=Synthetic Owner, O=Viettel-CA Test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
                .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(7));
            var pdfSigner = externalSigner.GetRequiredService<BHome.DigitalSigning.Application.IPdfSigner>();
            System.Security.Cryptography.X509Certificates.X509Certificate2[] chain = [cert];
            var prepared = pdfSigner.Prepare(source, chain, DateTimeOffset.UtcNow, null);
            var pdfBytes = pdfSigner.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, chain,
                rsa.SignHash(prepared.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
            var uploadKey = Guid.NewGuid();
            var done = await Result<ContractView>(await Upload(pdfBytes, uploadKey));
            Assert.Equal("PendingActivation", done.Status); Assert.Null(done.ActivatedAt);
            (await Upload(pdfBytes, uploadKey)).EnsureSuccessStatusCode();
            var final = await owner.GetByteArrayAsync(path + "/document");
            Assert.Equal(pdfBytes, final);
            using var signedPdf = new PdfDocument(new PdfReader(new MemoryStream(final)));
            var signatures = new SignatureUtil(signedPdf);
            Assert.True(signatures.ReadSignatureData(Assert.Single(signatures.GetSignatureNames())).VerifySignatureIntegrityAndAuthenticity());
            return;
        }
        var requestKey = Guid.NewGuid();
        if (ownerSession)
        {
            var input = new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true);
            Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, path + "/signing", input)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, path + "/signing", input with { Consent = false })).StatusCode);
            // Exercise conversion of a legacy OTP prompt without touching the accepted representative PDF.
            await Result<SignatureView>(await Post(owner, path + "/signing", new SigningInput(Guid.Empty, Method: SigningMethods.Otp)));
            var otpCount = delivery.Messages.Count(m => m.EventType == "CONTRACT_SIGNING_OTP");
            var immediate = await Result<SignatureView>(await Post(owner, path + "/signing", input, requestKey));
            Assert.Equal("Signed", immediate.Status);
            Assert.Equal(SigningMethods.OwnerSession, immediate.Method);
            var repeated = await Result<SignatureView>(await Post(owner, path + "/signing", input, requestKey));
            Assert.Equal(immediate.Id, repeated.Id);
            Assert.Equal(otpCount, delivery.Messages.Count(m => m.EventType == "CONTRACT_SIGNING_OTP"));
            var done = (await owner.GetFromJsonAsync<ContractView>(path))!;
            Assert.Equal("PendingActivation", done.Status); Assert.Null(done.ActivatedAt);
            Assert.Single(done.Signatures, s => s.Status == "Signed");
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, path + "/signing", input)).StatusCode);
            var statusNow = (await owner.GetFromJsonAsync<InternalSigningStatus>(path + "/internal-signing"))!;
            Assert.True(statusNow.CanContinue); Assert.NotNull(statusNow.OwnerAcceptedAt);
            var final = await owner.GetByteArrayAsync(path + "/document");
            Assert.True(final.AsSpan(0, tenantPdf.Length).SequenceEqual(tenantPdf));
            using var document = new PdfDocument(new PdfReader(new MemoryStream(final)));
            var signatures = new SignatureUtil(document);
            var field = Assert.Single(signatures.GetSignatureNames());
            Assert.True(signatures.ReadSignatureData(field).VerifySignatureIntegrityAndAuthenticity());
            Assert.True(signatures.SignatureCoversWholeDocument(field));
            return;
        }
        var started = await Result<SignatureView>(await Post(owner, path + "/signing", new SigningInput(Guid.Empty, Method: SigningMethods.Otp), requestKey));
        var replay = await Result<SignatureView>(await Post(owner, path + "/signing", new SigningInput(Guid.Empty, Method: SigningMethods.Otp), requestKey));
        Assert.Equal(started.Id, replay.Id);
        var mail = delivery.Messages.Last(m => m.EventType == "CONTRACT_SIGNING_OTP");
        var code = mail.Title[(mail.Title.LastIndexOf(' ') + 1)..];
        var wrong = code == "000000" ? "111111" : "000000";
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, path + "/signing/otp/confirm", new SigningOtpConfirmation(wrong))).StatusCode);
        var key = Guid.NewGuid();
        var signed = await Result<ContractView>(await Post(owner, path + "/signing/otp/confirm", new SigningOtpConfirmation(code), key));
        Assert.Equal("PendingActivation", signed.Status);
        Assert.Null(signed.ActivatedAt);
        Assert.Null(signed.TenantUserId);
        Assert.Equal("Signed", Assert.Single(signed.Signatures).Status);
        (await Post(owner, path + "/signing/otp/confirm", new SigningOtpConfirmation(code), key)).EnsureSuccessStatusCode();
        var status = (await owner.GetFromJsonAsync<InternalSigningStatus>(path + "/internal-signing"))!;
        Assert.NotNull(status.TenantAcceptedAt); Assert.NotNull(status.OwnerAcceptedAt); Assert.True(status.CanContinue);
        var finalPdf = await owner.GetByteArrayAsync(path + "/document");
        Assert.True(finalPdf.AsSpan(0, tenantPdf.Length).SequenceEqual(tenantPdf));
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(finalPdf)));
        var util = new SignatureUtil(pdf);
        var name = Assert.Single(util.GetSignatureNames());
        Assert.True(util.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity());
        Assert.True(util.SignatureCoversWholeDocument(name));
    }
    [CompactPostgresFact]
    public async Task AnonymousOtpDrawnAcceptanceRequiresExactPdfThenOwnerAndDepositBeforeAtomicAccountsAndOneTimePassword()
        => await AnonymousMainWorkflow();

    [CompactPostgresFact]
    public async Task MainOwnerSessionSignsAcceptedPdfWithoutAnotherOtp()
    {
        await using var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        await new AnonymousSigningTests(isolated).AnonymousMainWorkflow(ownerSession: true);
    }

    [CompactPostgresFact]
    public async Task EmailsStayOnInvitationUntilMainActivationAndDoNotReserveDraftProfiles()
    {
        await using var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        await new AnonymousSigningTests(isolated).AnonymousMainWorkflow(ownerSession: true, deferredContacts: true);
    }

    private async Task AnonymousMainWorkflow(bool ownerSession = false, bool deferredContacts = false)
    {
        var delivery = new Delivery();
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AnonymousSigning:OtpHmacKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                // Development can keep other notifications in Sandbox while SMTP is configured.
                // Delivery below is explicitly replaced; these synthetic credentials never leave the test host.
                ["NotificationChannels:Mode"] = "Sandbox",
                ["Email:Enabled"] = "true",
                ["Email:Username"] = "sender@example.invalid",
                ["Email:FromEmail"] = "sender@example.invalid",
                ["Email:AppPassword"] = "synthetic-password",
                ["ContractPdf:TemplateId"] = "main-contract-development-v1",
                ["ContractSigning:Methods:Otp"] = "true"
            }));
            b.ConfigureTestServices(s =>
            {
                s.Insert(0, ServiceDescriptor.Singleton<Microsoft.AspNetCore.Diagnostics.IExceptionHandler, Diagnostic>());
                s.AddSingleton<IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage());
                s.RemoveAll<INotificationChannelProvider>(); s.AddSingleton<INotificationChannelProvider>(delivery);
                s.RemoveAll<IContractSigningProvider>(); s.AddScoped<IContractSigningProvider, ContractSigningRouter>();
                s.RemoveAll<IPasswordResetDelivery>(); s.AddSingleton<IPasswordResetDelivery>(delivery);
            });
        });
        await Compact24SampleSeed.RunAsync(host.Services, "Development", WorkflowTestUsers.Password);
        using var owner = host.CreateClient(); using var staff = host.CreateClient(); using var anonymous = host.CreateClient();
        async Task Login(HttpClient client, string email, string password)
        {
            var login = await Result<LoginResult>(await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password }));
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        }
        await Login(owner, "owner.sample@example.invalid", WorkflowTestUsers.Password);
        await Login(staff, "staff.sample@example.invalid", WorkflowTestUsers.Password);
        Guid representative, coOccupant; int usersBefore;
        var email = $"anon-{Guid.NewGuid():N}@example.invalid";
        var familyEmail = $"family-{Guid.NewGuid():N}@example.invalid";
        if (deferredContacts)
        {
            var profile = new BHome.Application.Ocr.ResidentInput(Compact24SampleSeed.Id(41), "Synthetic deferred contact", ResidentType.Representative, email);
            await Result<BHome.Application.Ocr.IdResult>(await Post(staff, "/api/v1/capture/residents", profile));
            await Result<BHome.Application.Ocr.IdResult>(await Post(staff, "/api/v1/capture/residents", profile));
            await using var scope = host.Services.CreateAsyncScope();
            Assert.False(await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().Set<Resident>().AnyAsync(r => r.ContactEmail == email));
        }
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); usersBefore = await db.Users.CountAsync();
            var first = new Resident { RoomId = Compact24SampleSeed.Id(41), OwnerUserId = Compact24SampleSeed.Id(1), DisplayLabel = "Synthetic representative", ContactEmail = deferredContacts ? null : email, VerificationStatus = IdentityVerificationStatus.Verified };
            var second = new Resident { RoomId = first.RoomId, OwnerUserId = first.OwnerUserId, DisplayLabel = "Synthetic family", ContactEmail = deferredContacts ? null : familyEmail, ResidentType = ResidentType.CoOccupant, VerificationStatus = IdentityVerificationStatus.Verified };
            db.AddRange(first, second); await db.SaveChangesAsync(); representative = first.Id; coOccupant = second.Id;
        }
        var draft = await Result<ContractId>(await Post(staff, "/api/v1/contracts", new ContractDraftInput(Compact24SampleSeed.Id(41), Compact24SampleSeed.Id(1), null,
            representative, [representative, coOccupant], Today, Today.AddMonths(6), 3000000, 1000000, "SYNTHETIC ACCEPTANCE TERMS")));
        var root = $"/api/v1/contracts/{draft.Id}";
        var view = await owner.GetFromJsonAsync<ContractView>(root);
        Assert.Null(view!.TenantUserId); Assert.Equal(ContractSigningModes.Internal, view.SigningMode);
        var premature = await Post(owner, root + "/signing", new SigningInput(Guid.Empty, Method: SigningMethods.Otp));
        Assert.Equal(HttpStatusCode.Conflict, premature.StatusCode);
        Assert.Contains("tenant_acceptance_required", await premature.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await Post(owner, $"/api/v1/residents/{representative}/invitation", new TenantInvitationRequest(email))).StatusCode);
        var invitationInput = new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view.SnapshotHash,
            deferredContacts ? email : null, deferredContacts ? [new(representative, email), new(coOccupant, familyEmail)] : null);
        if (deferredContacts)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, root + "/signing-invitations", invitationInput with { Contacts = [new(Guid.NewGuid(), email)] })).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK, (await Post(staff, root + "/signing-invitations", invitationInput)).StatusCode);
        var firstInvite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var expired = await db.Set<ContractSigningInvitation>().SingleAsync(i => i.Id == firstInvite.Id);
            expired.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await Post(anonymous, "/api/v1/contract-signing/info", new AnonymousSigningToken(firstInvite.Token!))).StatusCode);
        var invite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        Assert.Equal(HttpStatusCode.NotFound, (await Post(anonymous, "/api/v1/contract-signing/info", new AnonymousSigningToken(firstInvite.Token!))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(anonymous, "/api/v1/contract-signing/document", new AnonymousSigningSession(invite.Token!, new string('A', 64)))).StatusCode);
        Assert.Contains("Mã OTP của bạn:", delivery.Messages.Last().Body);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Post(anonymous, "/api/v1/contract-signing/otp", new AnonymousSigningToken(invite.Token!))).StatusCode);
        var otp = Regex.Match(delivery.Messages.Last().Body, @"\b[0-9]{6}\b").Value;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var expired = await db.Set<ContractSigningInvitation>().SingleAsync(i => i.Id == invite.Id);
            Assert.Equal(1, expired.OtpSendCount);
            Assert.NotEqual(otp, expired.OtpHash);
            Assert.Equal(6, otp.Length);
            expired.OtpExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, otp))).StatusCode);
        invite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var pending = await db.Set<ContractSigningInvitation>().SingleAsync(i => i.Id == invite.Id);
            pending.OtpSentAt = DateTimeOffset.UtcNow.AddMinutes(-2);
            await db.SaveChangesAsync();
        }
        (await Post(anonymous, "/api/v1/contract-signing/otp", new AnonymousSigningToken(invite.Token!))).EnsureSuccessStatusCode();
        otp = Regex.Match(delivery.Messages.Last().Body, @"\b[0-9]{6}\b").Value;
        var wrong = otp == "000000" ? "111111" : "000000";
        for (var n = 0; n < 5; n++)
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, wrong))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, otp))).StatusCode);
        invite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        Assert.Contains("Mã OTP của bạn:", delivery.Messages.Last().Body);
        otp = Regex.Match(delivery.Messages.Last().Body, @"\b[0-9]{6}\b").Value;
        var access = await Result<AnonymousSigningAccess>(await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, otp)));
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, otp))).StatusCode);
        var document = await Post(anonymous, "/api/v1/contract-signing/document", new AnonymousSigningSession(invite.Token!, access.Session));
        document.EnsureSuccessStatusCode(); var pdf = await document.Content.ReadAsByteArrayAsync();
        Assert.Equal(access.DocumentHash, Convert.ToHexString(SHA256.HashData(pdf))); Assert.Equal("%PDF-", System.Text.Encoding.ASCII.GetString(pdf[..5]));
        var acceptance = new AnonymousAcceptanceInput(invite.Token!, access.Session, access.DocumentHash, access.ConsentVersion, true,
            [[new(.1, .2), new(.7, .4), new(.4, .9)]]);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/accept", acceptance with { Consent = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/accept", acceptance with { DocumentHash = "changed" })).StatusCode);
        foreach (var response in await Task.WhenAll(Post(anonymous, "/api/v1/contract-signing/accept", acceptance), Post(anonymous, "/api/v1/contract-signing/accept", acceptance)))
            response.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/activate", new { })).StatusCode);
        var ownerConsent = new InternalOwnerAcceptance(access.DocumentHash, access.ConsentVersion, true);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, root + "/internal-signing/owner-confirmation", ownerConsent)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/internal-signing/owner-confirmation", ownerConsent)).StatusCode);
        await SignOwnerWithOtp(owner, staff, root, delivery, ownerSession: ownerSession);
        if (deferredContacts)
        {
            await using var scope = host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.All(await db.Set<Resident>().Where(r => r.Id == representative || r.Id == coOccupant).ToArrayAsync(), r => Assert.Null(r.ContactEmail));
            Assert.Equal(usersBefore, await db.Users.CountAsync());
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/activate", new { })).StatusCode);
        await using (var scope = host.Services.CreateAsyncScope())
            Assert.Equal(usersBefore, await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().Users.CountAsync());
        (await Post(owner, root + "/deposit-verifications", new DepositInput("SYNTHETIC-" + Guid.NewGuid(), 1000000, "Synthetic bank statement verified"))).EnsureSuccessStatusCode();
        var active = await Result<ContractView>(await Post(owner, root + "/activate", new { }));
        Assert.Equal("Active", active.Status); Assert.NotNull(active.TenantUserId);
        var dispatches = new List<(Guid Id, string Key, string Payload)>();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(usersBefore + 2, await db.Users.CountAsync());
            var people = await db.Set<Resident>().Where(r => r.Id == representative || r.Id == coOccupant).ToArrayAsync();
            Assert.All(people, p => Assert.NotNull(p.TenantUserId));
            Assert.All(people, p => Assert.False(string.IsNullOrWhiteSpace(p.ContactEmail)));
            Assert.Equal(view.SnapshotHash, (await db.Set<Contract>().SingleAsync(c => c.Id == draft.Id)).SnapshotHash);
            var stored = await db.Set<ContractSigningInvitation>().SingleAsync(i => i.Id == invite.Id);
            Assert.Null(stored.OtpHash); Assert.NotEqual(invite.Token, stored.TokenHash); Assert.NotEqual(access.Session, stored.SessionHash);
            var rows = await db.Database.SqlQueryRaw<DispatchRow>("SELECT id AS \"Id\",task_data->>'idempotencyKey' AS \"Key\",(task_data->'payload')::text AS \"Payload\" FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'name'='post-activation-account-invitation'").ToArrayAsync();
            dispatches.AddRange(rows.Select(r => (r.Id, r.Key, r.Payload)));
        }
        Assert.Equal(2, dispatches.Count);
        foreach (var job in dispatches)
        {
            await using var scope = host.Services.CreateAsyncScope();
            var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "post-activation-account-invitation");
            await handler.ExecuteAsync(new(job.Id, job.Key, job.Payload), default);
            await handler.ExecuteAsync(new(job.Id, job.Key, job.Payload), default);
        }
        Assert.Equal(2, delivery.AccountTokens.Count);
        Assert.Equal(2, delivery.AccountSendCount);
        var accountToken = delivery.AccountTokens[active.TenantUserId!.Value];
        var password = "Synthetic!NewPassword-493";
        var setup = new AcceptInvitationRequest(email, accountToken, password);
        (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", setup)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", setup)).StatusCode);
        await Login(anonymous, email, password);
        (await anonymous.GetAsync(root)).EnsureSuccessStatusCode();
        await using (var cleanup = host.Services.CreateAsyncScope())
            await BHome.Infrastructure.Contracts.ContractFileCleanup.CleanupAsync(
                cleanup.ServiceProvider.GetRequiredService<Compact24DbContext>(), cleanup.ServiceProvider.GetRequiredService<IObjectStorage>(),
                DateTimeOffset.UtcNow.AddDays(2), default);
        // Technical orphan cleanup must retain every linked acceptance artifact.
        (await anonymous.GetAsync(root + "/document")).EnsureSuccessStatusCode();
        // Repeated activation cannot duplicate Users or dispatch intents.
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/activate", new { })).StatusCode);
        await using var final = host.Services.CreateAsyncScope();
        Assert.Equal(usersBefore + 2, await final.ServiceProvider.GetRequiredService<Compact24DbContext>().Users.CountAsync());
    }
    public sealed class DispatchRow { public Guid Id { get; set; } public string Key { get; set; } = ""; public string Payload { get; set; } = ""; }

    [CompactPostgresFact]
    public async Task AnonymousHoldingTransfersAllVerifiedDepositOnceAndProvisionsOnlyAfterMainActivation()
        => await AnonymousHoldingWorkflow();

    [CompactPostgresFact]
    public async Task AnonymousHoldingAndMainSupportOwnerExternalPdfWithoutTenantAccount()
    {
        await using var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        await new AnonymousSigningTests(isolated).AnonymousHoldingWorkflow(externalOwner: true);
    }

    [CompactPostgresFact]
    public async Task HoldingAndConvertedMainOwnerSessionSignWithoutAnotherOtp()
    {
        await using var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        await new AnonymousSigningTests(isolated).AnonymousHoldingWorkflow(ownerSession: true);
    }

    [CompactPostgresFact]
    public async Task HoldingEmailsRemainDeferredThroughHoldingAndBecomeAccountsOnlyOnMainActivation()
    {
        await using var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        await new AnonymousSigningTests(isolated).AnonymousHoldingWorkflow(ownerSession: true, deferredContacts: true);
    }

    [CompactPostgresFact]
    public async Task GenuinelySignedHoldingExposesSandboxQrToAssignedStaffWithoutSimulationOrPaymentEffects()
    {
        await using var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        await new AnonymousSigningTests(isolated).AnonymousHoldingWorkflow(ownerSession: true, deferredContacts: true, qrPreview: true);
    }

    internal async Task AnonymousHoldingWorkflow(HoldingCancellationCause? cancellationCause = null, bool externalOwner = false, bool ownerSession = false, bool deferredContacts = false, bool qrPreview = false)
    {
        var delivery = new Delivery();
        const string sandboxSecret = "SYNTHETIC-SANDBOX-WEBHOOK-SECRET-ONLY-123456";
        var sandboxDate = DateTimeOffset.UtcNow.AddSeconds(-5).ToOffset(TimeSpan.FromHours(7)).ToString("yyyy-MM-dd HH:mm:ss");
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            if (qrPreview) b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SePay:Enabled"] = "false", ["SePay:Mode"] = "Test",
                ["SePay:WebhookSecret"] = sandboxSecret,
                ["SePay:ReceivingAccounts:0:LocationId"] = Compact24SampleSeed.Id(10).ToString(),
                ["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416",
                ["SePay:ReceivingAccounts:0:Gateway"] = "ACB",
                ["SePay:ReceivingAccounts:0:AccountNumber"] = "12345678"
            }));
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AnonymousSigning:OtpHmacKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                ["ContractPdf:TemplateId"] = "main-contract-development-v1",
                ["ContractSigning:Methods:Otp"] = "true",
                ["ContractSigning:Methods:UploadProof"] = "true"
            }));
            b.ConfigureTestServices(s =>
            {
                s.Insert(0, ServiceDescriptor.Singleton<Microsoft.AspNetCore.Diagnostics.IExceptionHandler, Diagnostic>());
                s.AddSingleton<IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage());
                s.RemoveAll<INotificationChannelProvider>(); s.AddSingleton<INotificationChannelProvider>(delivery);
                s.RemoveAll<IContractSigningProvider>(); s.AddScoped<IContractSigningProvider, ContractSigningRouter>();
            });
        });
        await Compact24SampleSeed.RunAsync(host.Services, "Development", WorkflowTestUsers.Password);
        using var owner = host.CreateClient(); using var guest = host.CreateClient(); using var assignedStaff = host.CreateClient();
        async Task RunAutomaticActivation(Guid id)
        {
            await using (var scope = host.Services.CreateAsyncScope())
            {
                Assert.True(await scope.ServiceProvider.GetRequiredService<ContractService>().AutomaticActivationReadyAsync(id, default));
                var scheduling = scope.ServiceProvider.GetRequiredService<BHome.Infrastructure.PaymentsDebt.MainContractActivationScheduling>();
                await scheduling.EnqueueDueAsync(default);
                await scheduling.EnqueueDueAsync(default);
            }
            await host.Services.GetRequiredService<BHome.Infrastructure.Jobs.PostgresJobWorker>().ProcessAllowedAsync(default, ["activate-paid-main-contract"]);
            await using var retry = host.Services.CreateAsyncScope();
            var service = retry.ServiceProvider.GetRequiredService<ContractService>();
            await service.AutoActivatePaidMainAsync(id, default);
            var db = retry.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var contract = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == id);
            var activatedAt = contract.ActivatedAt;
            var roomVersion = (await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().SingleAsync(r => r.Id == contract.RoomId)).Version;
            await service.AutoActivatePaidMainAsync(id, default);
            Assert.Equal(activatedAt, (await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == id)).ActivatedAt);
            Assert.Equal(roomVersion, (await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().SingleAsync(r => r.Id == contract.RoomId)).Version);
        }
        async Task<HttpResponseMessage> SendSandbox(string code, decimal amount)
        {
            var eventId = new Guid(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code))[..16]).ToString();
            var body = JsonSerializer.Serialize(new { id = eventId, gateway = "ACB", transactionDate = sandboxDate, accountNumber = "12345678", subAccount = "", code,
                content = "Synthetic transfer " + code, transferType = "in", transferAmount = amount, referenceCode = "SYN-" + code, description = "Synthetic transfer", accumulated = amount });
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/integrations/sepay/webhook") { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
            request.Headers.Add("X-SePay-Timestamp", timestamp);
            request.Headers.Add("X-SePay-Signature", "sha256=" + Convert.ToHexString(HMACSHA256.HashData(System.Text.Encoding.UTF8.GetBytes(sandboxSecret), System.Text.Encoding.UTF8.GetBytes(timestamp + "." + body))));
            return await guest.SendAsync(request);
        }
        if (LiveRecipient is not null)
        {
            await using var scope = host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var user = await db.Users.SingleAsync(u => u.Id == Compact24SampleSeed.Id(1));
            user.Email = LiveRecipient; user.NormalizedEmail = LiveRecipient.ToUpperInvariant();
            user.UserName = LiveRecipient; user.NormalizedUserName = LiveRecipient.ToUpperInvariant();
            await db.SaveChangesAsync();
            var mail = scope.ServiceProvider.GetRequiredService<BHome.Infrastructure.Modules.Notifications.MailKitEmailSender>();
            Assert.True(mail.IsConfigured);
            delivery.LiveSend = (message, t) => message.Destination.Equals(LiveRecipient, StringComparison.OrdinalIgnoreCase)
                ? mail.SendAsync(message with { Title = "[TEST BHOME Step 6] " + message.Title }, t)
                : Task.FromResult("test-only-other-recipient");
        }
        var login = await Result<LoginResult>(await owner.PostAsJsonAsync("/api/v1/auth/login", new { email = LiveRecipient ?? "owner.sample@example.invalid", password = WorkflowTestUsers.Password }));
        owner.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
        var staffLogin = await Result<LoginResult>(await assignedStaff.PostAsJsonAsync("/api/v1/auth/login", new { email = "staff.sample@example.invalid", password = WorkflowTestUsers.Password }));
        assignedStaff.DefaultRequestHeaders.Authorization = new("Bearer", staffLogin.AccessToken);
        Guid residentId; int usersBefore;
        var deliveryEmail = LiveRecipient ?? $"holding-{Guid.NewGuid():N}@example.invalid";
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); usersBefore = await db.Users.CountAsync();
            var person = new Resident
            {
                RoomId = Compact24SampleSeed.Id(40),
                OwnerUserId = Compact24SampleSeed.Id(1),
                ContactEmail = deferredContacts ? null : deliveryEmail,
                DisplayLabel = "Synthetic holding",
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            db.Add(person); await db.SaveChangesAsync(); residentId = person.Id;
            if (qrPreview)
            {
                db.Add(new BHome.Domain.PropertyManagement.BillingPolicy { LocationId = Compact24SampleSeed.Id(10), ChargeCode = "SYN_INTERNET", Name = "Synthetic Internet", Category = BHome.Domain.PropertyManagement.ChargeCategory.ServiceFee, Method = BHome.Domain.PropertyManagement.ChargingMethod.FixedPerRoomPerMonth, Rate = 50000, EffectiveFrom = Today });
                db.Add(new BHome.Domain.PropertyManagement.BillingPolicy { LocationId = Compact24SampleSeed.Id(10), ChargeCode = "SYN_PERSON", Name = "Synthetic person fee", Category = BHome.Domain.PropertyManagement.ChargeCategory.ServiceFee, Method = BHome.Domain.PropertyManagement.ChargingMethod.FixedPerPersonPerMonth, Rate = 10000, EffectiveFrom = Today });
                await db.SaveChangesAsync();
            }
        }
        var holding = await Result<ContractId>(await Post(owner, "/api/v1/contracts/holdings", new HoldingDraftInput(
            Compact24SampleSeed.Id(40), Compact24SampleSeed.Id(1), null, residentId, [residentId], Today, Today.AddMonths(6),
            DateTimeOffset.UtcNow.AddDays(2), 100000, "Synthetic holding terms")));
        var root = $"/api/v1/contracts/{holding.Id}";
        var qrPath = $"/api/v1/contracts/{holding.Id}/deposit-payment/transfer-instructions";
        if (qrPreview)
        {
            // Model a previously genuinely signed contract when sandbox QR is enabled later.
            host.Services.GetRequiredService<BHome.Application.PaymentsDebt.SePay.SePayOptions>().Enabled = true;
            await using var scope = host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            (await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).PaymentMode = "Test";
            db.Add(new BHome.Domain.PaymentsDebt.ReceivingBankAccount { LocationId = Compact24SampleSeed.Id(10), BankIdentifier = "970416", AccountNumber = "12345678", AccountHolder = "SYNTHETIC TEST", Enabled = true, IsDevelopmentDemo = true, Version = 1, ConfirmedByUserId = Compact24SampleSeed.Id(1), ConfirmedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
            Assert.Equal(HttpStatusCode.Conflict, (await assignedStaff.GetAsync(qrPath)).StatusCode);
        }
        (await Post(owner, root + "/holding-approval", new HoldingDecisionInput("Synthetic Owner review"))).EnsureSuccessStatusCode();
        async Task Sign(string path)
        {
            var view = await owner.GetFromJsonAsync<ContractView>(path);
            var invitationInput = new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view!.SnapshotHash, deferredContacts ? deliveryEmail : null);
            var invite = await Result<SigningInvitationResult>(await Post(owner, path + "/signing-invitations", invitationInput));
            var inviteToken = invite.Token!;
            if (path == root)
            {
                (await owner.DeleteAsync(path + "/signing-invitations/" + invite.Id)).EnsureSuccessStatusCode();
                var sent = await Result<SigningInvitationResult>(await Post(assignedStaff, path + "/signing-invitations", invitationInput));
                Assert.Null(sent.Token); Assert.Equal("InvitationAcceptedByProvider", sent.Status);
                inviteToken = Regex.Match(delivery.Messages.Last().Body, @"\b[A-F0-9]{64}\b").Value;
                Assert.Equal(64, inviteToken.Length);
                var staffStatus = await assignedStaff.GetFromJsonAsync<InternalSigningStatus>(path + "/internal-signing");
                Assert.Null(staffStatus!.DocumentHash); Assert.Contains("***", staffStatus.MaskedEmail!); Assert.False(staffStatus.CanContinue);
                Assert.Equal(HttpStatusCode.Conflict, (await Post(assignedStaff, path + "/signing-invitations", new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view.SnapshotHash))).StatusCode);
            }
            Assert.Contains("Mã OTP của bạn:", delivery.Messages.Last().Body);
            var otp = Regex.Match(delivery.Messages.Last().Body, @"\b[0-9]{6}\b").Value;
            var access = await Result<AnonymousSigningAccess>(await Post(guest, "/api/v1/contract-signing/verify", new AnonymousOtpInput(inviteToken, otp)));
            if (path == root)
            {
                var otpOnly = await assignedStaff.GetFromJsonAsync<InternalSigningStatus>(path + "/internal-signing");
                Assert.Null(otpOnly!.TenantAcceptedAt); Assert.False(otpOnly.CanContinue);
                Assert.Equal(HttpStatusCode.Forbidden, (await Post(assignedStaff, path + "/internal-signing/owner-confirmation", new InternalOwnerAcceptance(access.DocumentHash, access.ConsentVersion, true))).StatusCode);
            }
            (await Post(guest, "/api/v1/contract-signing/accept", new AnonymousAcceptanceInput(inviteToken, access.Session, access.DocumentHash, access.ConsentVersion, true, [[new(.1, .2), new(.7, .6)]]))).EnsureSuccessStatusCode();
            await SignOwnerWithOtp(owner, assignedStaff, path, delivery, externalOwner ? host.Services : null, ownerSession);
        }
        // Payment before signing must not mark the room held or create a login.
        if (!qrPreview) (await Post(owner, root + "/deposit-verifications", new DepositInput("HOLD-SYNTHETIC-" + Guid.NewGuid(), 100000, "Synthetic statement verified"))).EnsureSuccessStatusCode();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<ContractService>();
            Assert.False(await service.AutomaticActivationReadyAsync(holding.Id, default));
            await Assert.ThrowsAsync<ContractException>(() => service.AutoActivatePaidMainAsync(holding.Id, default));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/holding-activation", new { })).StatusCode);
        await Sign(root);
        if (qrPreview)
        {
            var qr = (await assignedStaff.GetFromJsonAsync<BHome.Application.PaymentsDebt.ContractDepositInstructions>(qrPath))!;
            Assert.False(qr.PreviewOnly); Assert.Equal("Test", qr.Mode);
            Assert.Equal("100000", qr.OutstandingAmount);
            Assert.StartsWith("data:image/png;base64,", qr.QrImageDataUri);
            Assert.Matches("^BH[0-9]{8}$", qr.TransferReference);
            var repeat = (await assignedStaff.GetFromJsonAsync<BHome.Application.PaymentsDebt.ContractDepositInstructions>(qrPath))!;
            Assert.Equal(qr.TransferReference, repeat.TransferReference);
            Assert.Equal(HttpStatusCode.NotFound, (await assignedStaff.PostAsync($"/api/v1/integrations/sepay/testing/holdings/{holding.Id}/simulation/activate", null)).StatusCode);
            Assert.Equal("PendingActivation", (await owner.GetFromJsonAsync<ContractView>(root))!.Status);
            var unpaid = (await owner.GetFromJsonAsync<HoldingDepositStatus>(root + "/holding-deposit"))!;
            Assert.Equal(0m, unpaid.Verified);
            await using (var scope = host.Services.CreateAsyncScope())
                Assert.False(await scope.ServiceProvider.GetRequiredService<ContractService>().AutomaticActivationReadyAsync(holding.Id, default));
            (await SendSandbox(qr.TransferReference, 100000)).EnsureSuccessStatusCode();
            (await SendSandbox(qr.TransferReference, 100000)).EnsureSuccessStatusCode();
            Assert.Equal(100000m, (await owner.GetFromJsonAsync<HoldingDepositStatus>(root + "/holding-deposit"))!.Verified);
        }
        var ready = await owner.GetFromJsonAsync<ActivationReadiness>(root + "/activation-readiness"); Assert.True(ready!.Ready);
        await RunAutomaticActivation(holding.Id);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(ContractStatus.Active, (await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).Status);
            Assert.Equal(BHome.Domain.PropertyManagement.RoomStatus.OnHold,
                (await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == Compact24SampleSeed.Id(40))).Status);
            Assert.Equal(usersBefore, await db.Users.CountAsync());
            Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == residentId)).TenantUserId);
            if (deferredContacts) Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == residentId)).ContactEmail);
        }
        if (cancellationCause is { } cause)
        {
            var cancel = new HoldingCancellationInput("Synthetic verified cancellation cause and original depositor", cause, true); var cancellationKey = Guid.NewGuid();
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, root + "/holding-cancellation", cancel with { HumanConfirmed = false })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await Post(guest, root + "/holding-cancellation", cancel)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, root + "/holding-cancellation", new { reason = "Synthetic unspecified cause", humanConfirmed = true })).StatusCode);
            var commands = await Task.WhenAll(Post(owner, root + "/holding-cancellation", cancel, cancellationKey), Post(owner, root + "/holding-cancellation", cancel, cancellationKey));
            var cancelled = await Result<ContractView>(commands[0]); Assert.Equal(cancelled.Id, (await Result<ContractView>(commands[1])).Id);
            Assert.Equal("Cancelled", cancelled.Status);
            Assert.Equal(cancelled.Id, (await Result<ContractView>(await Post(owner, root + "/holding-cancellation", cancel, cancellationKey))).Id);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/holding-cancellation", cancel with { Cause = cause == HoldingCancellationCause.TenantVoluntary ? HoldingCancellationCause.OwnerCannotProvideRoom : HoldingCancellationCause.TenantVoluntary }, cancellationKey)).StatusCode);
            var status = await owner.GetFromJsonAsync<HoldingDepositStatus>(root + "/holding-deposit");
            Assert.Equal(cause == HoldingCancellationCause.TenantVoluntary ? "Forfeited" : "RefundPending", status!.Disposition!.Status);
            Assert.Equal(cause == HoldingCancellationCause.TenantVoluntary ? 100000 : 0, status.Disposition.ForfeitedAmount);
            await using (var savedScope = host.Services.CreateAsyncScope())
            {
                var savedReview = await savedScope.ServiceProvider.GetRequiredService<Compact24DbContext>().Set<ContractSettlementReview>().SingleAsync(r => r.ContractId == holding.Id);
                Assert.Equal(status.Disposition.FinancialReference, savedReview.LedgerReference);
                Assert.Equal(HoldingCancellationRules.Reference(holding.Id, savedReview), savedReview.LedgerReference);
            }
            var source = await Result<BHome.Application.Finance.RefundSource>(await owner.GetAsync(root + "/deposit-refunds"));
            var refundInput = new BHome.Application.Finance.DepositRefundInput(new(residentId, 100000, "Synthetic verified original depositor", true), source.FinancialReference!, true, true);
            if (cause == HoldingCancellationCause.TenantVoluntary)
            {
                Assert.Contains("holding_deposit_forfeited", source.Blockers!);
                Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/deposit-refunds", refundInput)).StatusCode);
                Assert.Empty(source.Requests);
            }
            else
            {
                Assert.Empty(source.Blockers!); Assert.Equal(100000, source.AvailableAmount);
                var refund = await Result<BHome.Application.Finance.RefundView>(await Post(owner, root + "/deposit-refunds", refundInput)); Assert.Equal("REQUESTED", refund.Status);
                var decision = await Result<BHome.Application.Finance.RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new BHome.Application.Finance.RefundDecision(1, true, "Synthetic verified external refund obligation", true)));
                Assert.Equal("APPROVED", decision.Status);
                Assert.Equal("RefundReserved", (await owner.GetFromJsonAsync<HoldingDepositStatus>(root + "/holding-deposit"))!.Disposition!.Status);
                using var image = new OpenCvSharp.Mat(40, 100, OpenCvSharp.MatType.CV_8UC3, OpenCvSharp.Scalar.White); var bytes = image.ImEncode(".png");
                var executeKey = Guid.NewGuid(); var executedAt = DateTimeOffset.UtcNow;
                async Task<HttpResponseMessage> Execute()
                {
                    var form = new MultipartFormDataContent { { new StringContent(decision.Version.ToString()), "expectedVersion" }, { new StringContent(executedAt.ToString("O")), "executedAt" }, { new StringContent("SYN-HOLD-" + executeKey), "externalReference" }, { new StringContent("Synthetic verified bank refund evidence"), "reason" }, { new StringContent("true"), "humanConfirmed" } };
                    var photo = new ByteArrayContent(bytes); photo.Headers.ContentType = new("image/png"); form.Add(photo, "evidence", "synthetic.png");
                    var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/refund-requests/{refund.Id}/execution") { Content = form }; request.Headers.Add("Idempotency-Key", executeKey.ToString()); return await owner.SendAsync(request);
                }
                foreach (var result in await Task.WhenAll(Execute(), Execute())) Assert.Equal("COMPLETED", (await Result<BHome.Application.Finance.RefundView>(result)).Status);
                Assert.Equal("RefundCompleted", (await owner.GetFromJsonAsync<HoldingDepositStatus>(root + "/holding-deposit"))!.Disposition!.Status);
                Assert.Equal(0, (await Result<BHome.Application.Finance.RefundSource>(await owner.GetAsync(root + "/deposit-refunds"))).AvailableAmount);
            }
            await using var cancellationScope = host.Services.CreateAsyncScope(); var cancelledDb = cancellationScope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(usersBefore, await cancelledDb.Users.CountAsync()); Assert.Null((await cancelledDb.Set<Resident>().SingleAsync(r => r.Id == residentId)).TenantUserId);
            Assert.Equal(BHome.Domain.PropertyManagement.RoomStatus.Available, (await cancelledDb.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == cancelled.RoomId)).Status);
            Assert.Equal(1, await cancelledDb.Set<ContractSettlementReview>().CountAsync(r => r.ContractId == holding.Id));
            var finances = await cancellationScope.ServiceProvider.GetRequiredService<BHome.Application.Finance.IFinancialReportRepository>()
                .ReadAsync(new(Today.AddDays(-1), Today, RoomId: cancelled.RoomId), default);
            Assert.False(finances.HasUnclassifiedRefunds); Assert.Equal(cause == HoldingCancellationCause.OwnerCannotProvideRoom ? 100000 : 0, finances.VerifiedDepositReturns);
            Assert.Equal(cause == HoldingCancellationCause.TenantVoluntary ? 100000 : 0, Assert.Single(finances.Locations).HoldingForfeitures);
            for (var pass = 0; pass < 3; pass++)
                await cancellationScope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);
            var notices = (await owner.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<NotificationView>>("/api/v1/notifications?category=Contract&pageSize=100"))!.Items;
            Assert.Single(notices, n => n.RelatedObjectId == holding.Id && n.Title == (cause == HoldingCancellationCause.TenantVoluntary ? "Giữ chỗ đã hủy theo yêu cầu Tenant, cọc không hoàn" : "Giữ chỗ đã hủy do không cung cấp được phòng, chờ xử lý hoàn cọc"));
            if (cause == HoldingCancellationCause.OwnerCannotProvideRoom) Assert.Single(notices, n => n.RelatedObjectId == holding.Id && n.Title == "Giao dịch hoàn cọc đã được xác minh thủ công");
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/holding-conversion", new HoldingConversionInput(200000))).StatusCode);
            return;
        }
        var main = await Result<ContractId>(await Post(owner, root + "/holding-conversion", new HoldingConversionInput(200000, RequireInitialPayment: qrPreview)));
        var convertedAgain = await Result<ContractId>(await Post(owner, root + "/holding-conversion", new HoldingConversionInput(200000, RequireInitialPayment: qrPreview)));
        Assert.Equal(main.Id, convertedAgain.Id);
        var mainRoot = $"/api/v1/contracts/{main.Id}";
        await Sign(mainRoot);
        if (qrPreview)
        {
            var quote = await Result<BHome.Application.PaymentsDebt.MainInitialPaymentView>(await owner.PostAsync(mainRoot + "/initial-payment/transfer-instructions", null));
            Assert.True(quote.IsDevelopmentDemo);
            Assert.Equal(100000m, quote.HoldingCredit); Assert.Equal(100000m, quote.VerifiedDeposit);
            Assert.Contains(quote.Charges, p => p.Code == "SYN_INTERNET" && p.Amount == 50000m);
            Assert.Contains(quote.Charges, p => p.Code == "SYN_PERSON" && p.Amount == 10000m);
            var mainView = (await owner.GetFromJsonAsync<ContractView>(mainRoot))!;
            Assert.Equal(quote.RequiredDeposit - quote.VerifiedDeposit + quote.Charges.Sum(p => p.Amount), quote.OutstandingAmount);
            Assert.Equal(mainView.MonthlyRent, Assert.Single(quote.Charges, p => p.Code == "RENT").Amount);
            Assert.StartsWith("data:image/png;base64,", quote.QrImageDataUri);
            (await SendSandbox(quote.TransferReference!, quote.OutstandingAmount)).EnsureSuccessStatusCode();
            (await SendSandbox(quote.TransferReference!, quote.OutstandingAmount)).EnsureSuccessStatusCode();
            var paid = (await owner.GetFromJsonAsync<BHome.Application.PaymentsDebt.MainInitialPaymentView>(mainRoot + "/initial-payment"))!;
            Assert.True(paid.Paid); Assert.Equal(0m, paid.OutstandingAmount);
            await RunAutomaticActivation(main.Id);
            var activated = (await owner.GetFromJsonAsync<ContractView>(mainRoot))!;
            Assert.Equal("Active", activated.Status);
            await using var scope = host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(usersBefore + 1, await db.Users.CountAsync());
            Assert.Equal(ContractStatus.Converted, (await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).Status);
            Assert.Equal(BHome.Domain.PropertyManagement.RoomStatus.Occupied, (await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == activated.RoomId)).Status);
            Assert.Equal(2, await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().CountAsync(a => a.TransferId != null && (a.TargetDepositContractId == main.Id || a.TargetInitialContractId == main.Id)));
            return;
        }
        if (LiveRecipient is not null)
        {
            Assert.Equal("PendingActivation", (await owner.GetFromJsonAsync<ContractView>(mainRoot))!.Status);
            return; // Live SMTP smoke stops before account provisioning; all data is disposable.
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, mainRoot + "/activate", new { })).StatusCode);
        (await Post(owner, mainRoot + "/deposit-verifications", new DepositInput("MAIN-SYNTHETIC-" + Guid.NewGuid(), 100000, "Synthetic difference verified"))).EnsureSuccessStatusCode();
        var active = await Result<ContractView>(await Post(owner, mainRoot + "/activate", new { }));
        Assert.Equal("Active", active.Status); Assert.Equal(100000, active.AppliedHoldingDeposit);
        await using var final = host.Services.CreateAsyncScope();
        var context = final.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(usersBefore + 1, await context.Users.CountAsync());
        Assert.Equal(1, await context.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().CountAsync(a => a.SourceDepositContractId == holding.Id));
        Assert.Equal(ContractStatus.Converted, (await context.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).Status);
        Assert.Equal(BHome.Domain.PropertyManagement.RoomStatus.Occupied, (await context.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == active.RoomId)).Status);
    }
}
