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
    private sealed class Diagnostic : Microsoft.AspNetCore.Diagnostics.IExceptionHandler
    {
        public static ConcurrentQueue<string> Errors { get; } = new();
        public ValueTask<bool> TryHandleAsync(Microsoft.AspNetCore.Http.HttpContext context, Exception e, CancellationToken t)
        { if (e is not ContractException) Errors.Enqueue(e.ToString()); return ValueTask.FromResult(false); }
    }
    private sealed class Delivery : INotificationChannelProvider, IPasswordResetDelivery
    {
        public ConcurrentQueue<ChannelMessage> Messages { get; } = new();
        public ConcurrentDictionary<Guid, string> AccountTokens { get; } = new();
        public int AccountSendCount { get; private set; }
        public bool IsAvailable => true;
        public bool IsConfigured(string channel) => channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => true;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken t) { Messages.Enqueue(message); return Task.FromResult("test-only"); }
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
    [CompactPostgresFact]
    public async Task AnonymousOtpDrawnAcceptanceRequiresExactPdfThenOwnerAndDepositBeforeAtomicAccountsAndOneTimePassword()
    {
        var delivery = new Delivery();
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AnonymousSigning:OtpHmacKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                ["ContractPdf:TemplateId"] = "main-contract-development-v1"
            }));
            b.ConfigureTestServices(s =>
            {
                s.Insert(0, ServiceDescriptor.Singleton<Microsoft.AspNetCore.Diagnostics.IExceptionHandler, Diagnostic>());
                s.AddSingleton<IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage());
                s.RemoveAll<INotificationChannelProvider>(); s.AddSingleton<INotificationChannelProvider>(delivery);
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
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); usersBefore = await db.Users.CountAsync();
            var first = new Resident { RoomId = Compact24SampleSeed.Id(41), OwnerUserId = Compact24SampleSeed.Id(1), DisplayLabel = "Synthetic representative", ContactEmail = email, VerificationStatus = IdentityVerificationStatus.Verified };
            var second = new Resident { RoomId = first.RoomId, OwnerUserId = first.OwnerUserId, DisplayLabel = "Synthetic family", ContactEmail = $"family-{Guid.NewGuid():N}@example.invalid", ResidentType = ResidentType.CoOccupant, VerificationStatus = IdentityVerificationStatus.Verified };
            db.AddRange(first, second); await db.SaveChangesAsync(); representative = first.Id; coOccupant = second.Id;
        }
        var draft = await Result<ContractId>(await Post(staff, "/api/v1/contracts", new ContractDraftInput(Compact24SampleSeed.Id(41), Compact24SampleSeed.Id(1), null,
            representative, [representative, coOccupant], Today, Today.AddMonths(6), 3000000, 1000000, "SYNTHETIC ACCEPTANCE TERMS")));
        var root = $"/api/v1/contracts/{draft.Id}";
        var view = await owner.GetFromJsonAsync<ContractView>(root);
        Assert.Null(view!.TenantUserId); Assert.Equal(ContractSigningModes.Internal, view.SigningMode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(owner, $"/api/v1/residents/{representative}/invitation", new TenantInvitationRequest(email))).StatusCode);
        var invitationInput = new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view.SnapshotHash);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, root + "/signing-invitations", invitationInput)).StatusCode);
        var firstInvite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        var invite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        Assert.Equal(HttpStatusCode.NotFound, (await Post(anonymous, "/api/v1/contract-signing/info", new AnonymousSigningToken(firstInvite.Token!))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(anonymous, "/api/v1/contract-signing/document", new AnonymousSigningSession(invite.Token!, new string('A', 64)))).StatusCode);
        (await Post(anonymous, "/api/v1/contract-signing/otp", new AnonymousSigningToken(invite.Token!))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Post(anonymous, "/api/v1/contract-signing/otp", new AnonymousSigningToken(invite.Token!))).StatusCode);
        var otp = Regex.Match(delivery.Messages.Last().Body, @"\b[0-9]{6}\b").Value;
        var wrong = otp == "000000" ? "111111" : "000000";
        for (var n = 0; n < 5; n++)
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, wrong))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/api/v1/contract-signing/verify", new AnonymousOtpInput(invite.Token!, otp))).StatusCode);
        invite = await Result<SigningInvitationResult>(await Post(owner, root + "/signing-invitations", invitationInput));
        (await Post(anonymous, "/api/v1/contract-signing/otp", new AnonymousSigningToken(invite.Token!))).EnsureSuccessStatusCode();
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
        (await Post(owner, root + "/internal-signing/owner-confirmation", ownerConsent)).EnsureSuccessStatusCode();
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

    internal async Task AnonymousHoldingWorkflow(HoldingCancellationCause? cancellationCause = null)
    {
        var delivery = new Delivery();
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AnonymousSigning:OtpHmacKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                ["ContractPdf:TemplateId"] = "main-contract-development-v1"
            }));
            b.ConfigureTestServices(s =>
            {
                s.Insert(0, ServiceDescriptor.Singleton<Microsoft.AspNetCore.Diagnostics.IExceptionHandler, Diagnostic>());
                s.AddSingleton<IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage());
                s.RemoveAll<INotificationChannelProvider>(); s.AddSingleton<INotificationChannelProvider>(delivery);
            });
        });
        await Compact24SampleSeed.RunAsync(host.Services, "Development", WorkflowTestUsers.Password);
        using var owner = host.CreateClient(); using var guest = host.CreateClient(); using var assignedStaff = host.CreateClient();
        var login = await Result<LoginResult>(await owner.PostAsJsonAsync("/api/v1/auth/login", new { email = "owner.sample@example.invalid", password = WorkflowTestUsers.Password }));
        owner.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
        var staffLogin = await Result<LoginResult>(await assignedStaff.PostAsJsonAsync("/api/v1/auth/login", new { email = "staff.sample@example.invalid", password = WorkflowTestUsers.Password }));
        assignedStaff.DefaultRequestHeaders.Authorization = new("Bearer", staffLogin.AccessToken);
        Guid residentId; int usersBefore;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); usersBefore = await db.Users.CountAsync();
            var person = new Resident
            {
                RoomId = Compact24SampleSeed.Id(40),
                OwnerUserId = Compact24SampleSeed.Id(1),
                ContactEmail = $"holding-{Guid.NewGuid():N}@example.invalid",
                DisplayLabel = "Synthetic holding",
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            db.Add(person); await db.SaveChangesAsync(); residentId = person.Id;
        }
        var holding = await Result<ContractId>(await Post(owner, "/api/v1/contracts/holdings", new HoldingDraftInput(
            Compact24SampleSeed.Id(40), Compact24SampleSeed.Id(1), null, residentId, [residentId], Today, Today.AddMonths(6),
            DateTimeOffset.UtcNow.AddDays(2), 100000, "Synthetic holding terms")));
        var root = $"/api/v1/contracts/{holding.Id}";
        (await Post(owner, root + "/holding-approval", new HoldingDecisionInput("Synthetic Owner review"))).EnsureSuccessStatusCode();
        async Task Sign(string path)
        {
            var view = await owner.GetFromJsonAsync<ContractView>(path);
            var invite = await Result<SigningInvitationResult>(await Post(owner, path + "/signing-invitations", new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view!.SnapshotHash)));
            var inviteToken = invite.Token!;
            if (path == root)
            {
                (await owner.DeleteAsync(path + "/signing-invitations/" + invite.Id)).EnsureSuccessStatusCode();
                var sent = await Result<SigningInvitationResult>(await Post(assignedStaff, path + "/signing-invitations", new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view.SnapshotHash)));
                Assert.Null(sent.Token); Assert.Equal("InvitationAcceptedByProvider", sent.Status);
                inviteToken = Regex.Match(delivery.Messages.Last().Body, @"\b[A-F0-9]{64}\b").Value;
                Assert.Equal(64, inviteToken.Length);
                var staffStatus = await assignedStaff.GetFromJsonAsync<InternalSigningStatus>(path + "/internal-signing");
                Assert.Null(staffStatus!.DocumentHash); Assert.Contains("***", staffStatus.MaskedEmail!); Assert.False(staffStatus.CanContinue);
                Assert.Equal(HttpStatusCode.Conflict, (await Post(assignedStaff, path + "/signing-invitations", new SigningInvitationInput(DateTimeOffset.UtcNow.AddHours(1), view.SnapshotHash))).StatusCode);
            }
            (await Post(guest, "/api/v1/contract-signing/otp", new AnonymousSigningToken(inviteToken))).EnsureSuccessStatusCode();
            var otp = Regex.Match(delivery.Messages.Last().Body, @"\b[0-9]{6}\b").Value;
            var access = await Result<AnonymousSigningAccess>(await Post(guest, "/api/v1/contract-signing/verify", new AnonymousOtpInput(inviteToken, otp)));
            if (path == root)
            {
                var otpOnly = await assignedStaff.GetFromJsonAsync<InternalSigningStatus>(path + "/internal-signing");
                Assert.Null(otpOnly!.TenantAcceptedAt); Assert.False(otpOnly.CanContinue);
                Assert.Equal(HttpStatusCode.Forbidden, (await Post(assignedStaff, path + "/internal-signing/owner-confirmation", new InternalOwnerAcceptance(access.DocumentHash, access.ConsentVersion, true))).StatusCode);
            }
            (await Post(guest, "/api/v1/contract-signing/accept", new AnonymousAcceptanceInput(inviteToken, access.Session, access.DocumentHash, access.ConsentVersion, true, [[new(.1, .2), new(.7, .6)]]))).EnsureSuccessStatusCode();
            (await Post(owner, path + "/internal-signing/owner-confirmation", new InternalOwnerAcceptance(access.DocumentHash, access.ConsentVersion, true))).EnsureSuccessStatusCode();
        }
        // Payment before signing must not mark the room held or create a login.
        (await Post(owner, root + "/deposit-verifications", new DepositInput("HOLD-SYNTHETIC-" + Guid.NewGuid(), 100000, "Synthetic statement verified"))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/holding-activation", new { })).StatusCode);
        await Sign(root);
        var ready = await owner.GetFromJsonAsync<ActivationReadiness>(root + "/activation-readiness"); Assert.True(ready!.Ready);
        await Result<ContractView>(await Post(owner, root + "/holding-activation", new { }));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(ContractStatus.Active, (await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).Status);
            Assert.Equal(BHome.Domain.PropertyManagement.RoomStatus.OnHold,
                (await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == Compact24SampleSeed.Id(40))).Status);
            Assert.Equal(usersBefore, await db.Users.CountAsync());
            Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == residentId)).TenantUserId);
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
        var main = await Result<ContractId>(await Post(owner, root + "/holding-conversion", new HoldingConversionInput(200000)));
        var convertedAgain = await Result<ContractId>(await Post(owner, root + "/holding-conversion", new HoldingConversionInput(200000)));
        Assert.Equal(main.Id, convertedAgain.Id);
        var mainRoot = $"/api/v1/contracts/{main.Id}";
        await Sign(mainRoot);
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
