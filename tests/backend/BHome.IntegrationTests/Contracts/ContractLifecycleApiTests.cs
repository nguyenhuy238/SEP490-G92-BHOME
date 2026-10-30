using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Contracts;
using BHome.Application.Storage;
using BHome.IntegrationTests.Ocr;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenCvSharp;
using Npgsql;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Docker")]
public sealed class ContractLifecycleApiTests(ContractFixture fixture) : IClassFixture<ContractFixture>
{
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private sealed record Actor(HttpClient Client, Guid Id);
    private sealed record Workspace(Actor Owner, Actor Staff, Actor Tenant, Guid Location, Guid Room, Guid Resident);
    private async Task<Actor> User(string role)
    {
        var id = Guid.NewGuid(); var name = id.ToString("N") + "@example.invalid";
        const string password = "Synthetic-Contract!537";
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { Id = id, UserName = name, Email = name, LockoutEnabled = true };
            Assert.True((await users.CreateAsync(user, password)).Succeeded); Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        }
        var client = fixture.Factory.CreateClient(); var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = name, password });
        response.EnsureSuccessStatusCode(); var login = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken); return new(client, id);
    }
    private async Task<Workspace> Setup()
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff); var tenant = await User(Roles.Tenant);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var location = new Location("Synthetic Contract Location"); var room = new Room { LocationId = location.Id, RoomNumber = "SYNTHETIC" };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = owner.Id, DisplayLabel = "Synthetic Representative", VerificationStatus = IdentityVerificationStatus.Verified };
        db.AddRange(location, room, resident, new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddDays(-30), Today.AddDays(60)));
        await db.SaveChangesAsync(); return new(owner, staff, tenant, location.Id, room.Id, resident.Id);
    }
    private static string Path(Guid id, string operation = "") => $"/api/v1/contracts/{id}" + (operation.Length == 0 ? "" : "/" + operation);
    private static async Task<HttpResponseMessage> Post(Actor actor, string path, object? input = null, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(input ?? new { }) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await actor.Client.SendAsync(request);
    }
    private static async Task<T> Success<T>(HttpResponseMessage response)
    { Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}"); return (await response.Content.ReadFromJsonAsync<T>())!; }
    private static ContractDraftInput Input(Workspace w) => new(w.Room, w.Owner.Id, w.Tenant.Id, w.Resident, [w.Resident], Today.AddDays(-10), Today.AddDays(30), 3000000, 3000000, "SYNTHETIC TEST TERMS");
    private async Task<Guid> Draft(Workspace w) => (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts", Input(w)))).Id;
    private static async Task Signed(Workspace w, Guid id)
    {
        foreach (var actor in new[] { w.Owner, w.Tenant })
        {
            await Success<SignatureView>(await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid())));
            await Success<ContractView>(await Post(actor, Path(id, "signing/sync")));
        }
    }
    private static async Task Deposit(Workspace w, Guid id, decimal amount = 3000000) =>
        await Success<ContractId>(await Post(w.Owner, Path(id, "deposit-verifications"), new DepositInput("SYNTHETIC-" + Guid.NewGuid(), amount, "Verified synthetic bank statement")));
    private async Task<Guid> Active(Workspace w)
    { var id = await Draft(w); await Signed(w, id); await Deposit(w, id); await Success<ContractView>(await Post(w.Owner, Path(id, "activate"))); return id; }

    [Fact]
    public async Task T01_T07_RealPersistenceTwoPartySignaturesActivationAndParallelReplay()
    {
        var w = await Setup(); var id = await Draft(w); await Signed(w, id); await Deposit(w, id);
        var key = Guid.NewGuid(); var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Post(w.Owner, Path(id, "activate"), key: key)));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        // Polling again is idempotent, including after activation; it cannot regress the contract.
        await Success<ContractView>(await Post(w.Tenant, Path(id, "signing/sync")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(ContractStatus.Active, (await db.Set<Contract>().SingleAsync(c => c.Id == id)).Status);
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(c => c.Id == w.Room)).Status);
        Assert.Equal(2, await db.Set<ContractSignature>().CountAsync(s => s.ContractId == id));
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == id && a.Event == "ContractActivated"));
        var file = await w.Tenant.Client.GetAsync(Path(id, "document")); Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Contains("TEST ONLY", Encoding.UTF8.GetString(await file.Content.ReadAsByteArrayAsync()));
        var response = await w.Staff.Client.GetAsync(Path(id)); var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("ObjectKey", json); Assert.DoesNotContain("ProviderUserId", json); Assert.DoesNotContain("CertificateChain", json);
    }
    [Fact]
    public async Task T02_T03_T04_T16_UnsignedUnderpaidAndWrongActorAreRejected()
    {
        var w = await Setup(); var id = await Draft(w); await Deposit(w, id, 100);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        await Signed(w, id); Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "activate"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "deposit-verifications"), new DepositInput("SYNTHETIC", 1, "test"))).StatusCode);
        var otherTenant = await User(Roles.Tenant); var otherStaff = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.Client.GetAsync(Path(id))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherStaff.Client.GetAsync(Path(id))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.Client.GetAsync(Path(id, "document"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.Factory.CreateClient().GetAsync(Path(id))).StatusCode);
    }
    [Fact]
    public async Task T05_CompetingActivationsHaveOneWinnerAndNoPartialRoomState()
    {
        var w = await Setup(); var one = await Draft(w); var two = await Draft(w);
        await Signed(w, one); await Signed(w, two); await Deposit(w, one); await Deposit(w, two);
        var replies = await Task.WhenAll(Post(w.Owner, Path(one, "activate")), Post(w.Owner, Path(two, "activate")));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
    }
    [Fact]
    public async Task BankReferenceCannotBeAllocatedToTwoContractsEvenInParallel()
    {
        var a = await Setup(); var b = await Setup(); var one = await Draft(a); var two = await Draft(b);
        var deposit = new DepositInput("SYNTHETIC-SHARED-" + Guid.NewGuid(), 500, "Synthetic owner statement verification");
        var replies = await Task.WhenAll(Post(a.Owner, Path(one, "deposit-verifications"), deposit), Post(b.Owner, Path(two, "deposit-verifications"), deposit));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<DepositVerification>().CountAsync(d => d.BankTransactionReference == deposit.BankTransactionReference));
    }
    [Fact]
    public async Task T08_T09_RenewalPreservesSignedVersionRejectsDuplicateAndWaitsForEffectiveDate()
    {
        var w = await Setup(); var id = await Active(w);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "renewals"), new RenewalInput(Today, 4000000, "TEST"))).StatusCode);
        var next = (await Success<ContractId>(await Post(w.Staff, Path(id, "renewals"), new RenewalInput(Today.AddYears(1), 4000000, "NEW TEST TERMS")))).Id;
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "renewals"), new RenewalInput(Today.AddYears(2), 4000000, "OTHER"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(next, "activate"))).StatusCode);
        await Signed(w, next);
        // Time is a host clock, advanced only in the test host for this request.
        await using var advanced = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddScoped(sp => new ContractService(sp.GetRequiredService<IContractRepository>(), sp.GetRequiredService<ICurrentUser>(),
                sp.GetRequiredService<ResourceAccess>(), sp.GetRequiredService<IContractSigningProvider>(), sp.GetRequiredService<BHome.Application.Storage.IObjectStorage>(),
                sp.GetRequiredService<IContractFileStore>(), sp.GetRequiredService<IContractImageValidator>(), sp.GetRequiredService<IContractSettlementLedger>(),
                sp.GetRequiredService<IContractHoldingLedger>(), new FixedClock(DateTimeOffset.UtcNow.AddDays(31))))));
        var advancedOwner = new Actor(advanced.CreateClient(), w.Owner.Id);
        advancedOwner.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        await Success<ContractView>(await Post(advancedOwner, Path(next, "activate")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var original = await db.Set<Contract>().SingleAsync(c => c.Id == id); var renewal = await db.Set<Contract>().SingleAsync(c => c.Id == next);
        Assert.Equal(ContractStatus.Superseded, original.Status); Assert.Equal(3000000, original.MonthlyRent); Assert.Equal(ContractStatus.Active, renewal.Status);
        Assert.Equal(4000000, renewal.MonthlyRent); Assert.Equal(2, await db.Set<ContractSignature>().CountAsync(s => s.ContractId == id));
    }
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static byte[] Image()
    { using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); return image.ImEncode(".png"); }
    private async Task<Guid> FinalReading(Workspace w, Guid contractId, UtilityType type)
    {
        Guid meter;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>(); var m = new Meter { RoomId = w.Room, Code = "SYNTHETIC-" + type, UtilityType = type, InstalledOn = Today.AddDays(-10) };
            db.Add(m); await db.SaveChangesAsync(); meter = m.Id;
        }
        foreach (var purpose in new[] { ReadingPurpose.Initial, ReadingPurpose.Final })
        {
            var response = await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(meter, purpose, purpose == ReadingPurpose.Initial ? Today.AddDays(-10) : Today, null, purpose == ReadingPurpose.Final ? contractId : null));
            var task = (await Success<IdResult>(response)).Id;
            using var binary = new ByteArrayContent(Image()); binary.Headers.ContentType = new("image/png");
            var evidence = (await Success<IdResult>(await w.Staff.Client.PutAsync($"/api/v1/capture/meter-tasks/{task}/evidence", binary))).Id;
            var reading = await Success<ConfirmedReading>(await w.Staff.Client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task}/confirm", new MeterConfirmation(true, purpose == ReadingPurpose.Initial ? 100 : 120, evidence)));
            if (purpose == ReadingPurpose.Final) return reading.Id;
        }
        throw new InvalidOperationException();
    }
    [Fact]
    public async Task T10_T11_T12_T13_T14_InspectionFinalMetersPendingSettlementAndCompletedMoveOut()
    {
        var w = await Setup(); var id = await Active(w); var termination = new TerminationInput(Today, "SYNTHETIC EARLY TERMINATION");
        var request = await Success<MoveOutView>(await Post(w.Tenant, Path(id, "termination-requests"), termination)); Assert.Equal("Requested", request.Status);
        Assert.Equal("Active", (await w.Tenant.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "move-out/approve"))).StatusCode);
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve")));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today))).StatusCode);
        await Success<MoveOutView>(await Post(w.Staff, Path(id, "move-out/schedule"), new InspectionScheduleInput(DateTimeOffset.UtcNow.AddMinutes(5))));
        var electricity = await FinalReading(w, id, UtilityType.Electricity); var water = await FinalReading(w, id, UtilityType.Water);
        using var photo = new ByteArrayContent(Image()); photo.Headers.ContentType = new("image/png");
        var evidence = (await Success<ContractId>(await w.Staff.Client.PostAsync(Path(id, "move-out/evidence"), photo))).Id;
        var inspect = new InspectionInput(electricity, water, "Synthetic room and asset condition", [evidence]);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Staff, Path(id, "move-out/inspection"), inspect with { WaterReadingId = electricity })).StatusCode);
        await Success<MoveOutView>(await Post(w.Staff, Path(id, "move-out/inspection"), inspect));
        var reviewedInspection = (await w.Owner.Client.GetFromJsonAsync<MoveOutView>(Path(id, "move-out")))!;
        Assert.Equal(inspect.Notes, reviewedInspection.InspectionNotes); Assert.Contains(evidence, reviewedInspection.EvidenceIds!);
        var pending = await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/settlement"), new SettlementInput("Pending approved financial module")));
        Assert.Equal("PendingSettlement", pending.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today))).StatusCode);
        fixture.Ledger.Resolved[id] = true; // TEST ONLY: authoritative ledger boundary, never a production switch.
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/settlement"), new SettlementInput("Synthetic verified settlement evidence")));
        fixture.Ledger.Resolved[id] = false;
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today))).StatusCode);
        var reopened = await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/settlement"), new SettlementInput("Synthetic ledger changed; review again")));
        Assert.Equal("PendingSettlement", reopened.Status);
        fixture.Ledger.Resolved[id] = true;
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/settlement"), new SettlementInput("Synthetic revalidated financial decision")));
        Assert.Equal(4, (await w.Owner.Client.GetFromJsonAsync<SettlementReviewView[]>(Path(id, "move-out/settlement-history")))!.Length);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(Path(id, "move-out/settlement-history"))).StatusCode);
        var key = Guid.NewGuid(); var replies = await Task.WhenAll(Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today), key), Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today), key));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(ContractStatus.Terminated, (await db.Set<Contract>().SingleAsync(c => c.Id == id)).Status);
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.Equal(2, await db.Set<MeterReading>().CountAsync(r => r.Id == electricity || r.Id == water));
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == id && a.Event == "ContractTerminationCompleted"));
    }
    [Fact]
    public async Task T15_UnconfiguredRealProviderKeepsDurablePendingAndCannotActivate()
    {
        var w = await Setup(); var id = await Draft(w);
        await using var unavailable = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddScoped<IContractSigningProvider, UnavailableSigning>()));
        using var client = unavailable.CreateClient(); client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        var response = await Post(new(client, w.Owner.Id), Path(id, "signing"), new SigningInput(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("PendingSigning", (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
    }
    private sealed class UnavailableSigning : IContractSigningProvider
    {
        public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid c, byte[]? p, CancellationToken t) => throw new IntegrationUnavailableException("TEST ONLY unavailable");
        public Task<string> RequestAsync(ContractSignature s, CancellationToken t) => throw new IntegrationUnavailableException("TEST ONLY unavailable");
        public Task<SigningOutcome> PollAsync(ContractSignature s, byte[] p, CancellationToken t) => throw new IntegrationUnavailableException("TEST ONLY unavailable");
    }

    [Fact]
    public async Task SignedEvidenceTamperingRollsBackActivationAndDatabaseRejectsHistoryEdits()
    {
        var w = await Setup(); var id = await Draft(w); await Signed(w, id); await Deposit(w, id);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var signature = await db.Set<ContractSignature>().FirstAsync(s => s.ContractId == id);
        using var altered = new MemoryStream("TEST ONLY altered private object"u8.ToArray());
        await storage.PutAsync(signature.SignedObjectKey!, altered, altered.Length, "application/pdf", default);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Contracts\" SET \"MonthlyRent\" = 1 WHERE \"Id\" = {id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"ContractDepositVerifications\" SET \"Amount\" = 1 WHERE \"ContractId\" = {id}"));
    }

    [Fact]
    public async Task ExpiryAndRenewalCancellationPreserveCurrentContractAndOccupancy()
    {
        var w = await Setup(); var id = await Active(w);
        var next = (await Success<ContractId>(await Post(w.Owner, Path(id, "renewals"), new RenewalInput(Today.AddYears(1), 4000000, "SYNTHETIC renewal")))).Id;
        await Success<ContractView>(await Post(w.Owner, Path(next, "renewal-cancellation")));
        var expiry = await Success<MoveOutView>(await Post(w.Owner, Path(id, "expiry-move-out"), new TerminationInput(Today.AddDays(30), "SYNTHETIC end of term")));
        Assert.Equal("Requested", expiry.Status); Assert.Equal("Active", (await w.Tenant.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.Equal(ContractStatus.Cancelled, (await db.Set<Contract>().SingleAsync(c => c.Id == next)).Status);
    }

    [Fact]
    public async Task InvalidInputAndChangedIdempotencyPayloadReturn400And409()
    {
        var w = await Setup(); var input = Input(w); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.Client.PostAsJsonAsync("/api/v1/contracts", input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Owner, "/api/v1/contracts", input with { Terms = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Owner, "/api/v1/contracts", input with { MonthlyRent = 1.5m })).StatusCode);
        await Success<ContractId>(await Post(w.Owner, "/api/v1/contracts", input, key));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, "/api/v1/contracts", input with { MonthlyRent = 4000000 }, key)).StatusCode);
    }

    [Fact]
    public async Task HoldingAllocationIsPersistedOnceAndCannotFundTwoMainContracts()
    {
        var w = await Setup(); var holding = Guid.NewGuid();
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IContractHoldingLedger, TestHoldingLedger>()));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        var input = Input(w) with { HoldingContractId = holding };
        var id = (await Success<ContractId>(await Post(actor, "/api/v1/contracts", input))).Id;
        var ready = (await actor.Client.GetFromJsonAsync<ActivationReadiness>(Path(id, "activation-readiness")))!;
        Assert.Equal(1000000, ready.VerifiedDeposit); Assert.Equal(2000000, ready.RemainingDeposit);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(actor, "/api/v1/contracts", input)).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<Contract>().CountAsync(c => c.HoldingContractId == holding));
    }
    private sealed class TestHoldingLedger : IContractHoldingLedger
    {
        public Task<HoldingDepositApplication> ApplyAsync(Guid holdingId, Guid mainId, Guid roomId, Guid tenantId, decimal required, CancellationToken t)
            => Task.FromResult(new HoldingDepositApplication(holdingId, roomId, tenantId, 1000000, "TEST-ONLY-HOLDING-" + holdingId));
    }

    [Fact]
    public async Task AmbiguousSigningRequestIsNotResentAndRecoveryDoesNotMeanSigned()
    {
        var w = await Setup(); var id = await Draft(w); var boundary = new AmbiguousSigning();
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IContractSigningProvider>(boundary)));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        var key = Guid.NewGuid(); var input = new SigningInput(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Post(actor, Path(id, "signing"), input, key)).StatusCode);
        var replay = await Success<SignatureView>(await Post(actor, Path(id, "signing"), input, key)); Assert.Equal("ManualReview", replay.Status);
        Assert.Equal(1, boundary.Requests);
        var recovery = await Success<ContractView>(await Post(w.Owner, Path(id, "signing/recover"), new SigningRecoveryInput("TEST-ONLY-RECOVERED-" + Guid.NewGuid())));
        Assert.Equal("PendingSigning", recovery.Status); Assert.Equal("Pending", recovery.Signatures.Single().Status);
        await Success<ContractView>(await Post(w.Owner, Path(id, "signing/sync")));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
    }
    private sealed class AmbiguousSigning : IContractSigningProvider
    {
        private readonly TestOnlySigningProvider inner = new(); public int Requests;
        public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid c, byte[]? p, CancellationToken t) => inner.PrepareAsync(d, c, p, t);
        public Task<string> RequestAsync(ContractSignature s, CancellationToken t) { Interlocked.Increment(ref Requests); throw new IntegrationUnavailableException("TEST ONLY ambiguous response"); }
        public Task<SigningOutcome> PollAsync(ContractSignature s, byte[] p, CancellationToken t) => inner.PollAsync(s, p, t);
    }

    [Fact]
    public async Task FailedSignatureCanBeRetriedWhileRetainingTheFailedAttempt()
    {
        var w = await Setup(); var id = await Draft(w);
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IContractSigningProvider, RejectedSigning>()));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        await Success<SignatureView>(await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid())));
        await Success<ContractView>(await Post(actor, Path(id, "signing/sync")));
        await Success<SignatureView>(await Post(w.Owner, Path(id, "signing"), new SigningInput(Guid.NewGuid())));
        await Success<ContractView>(await Post(w.Owner, Path(id, "signing/sync")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var attempts = await db.Set<ContractSignature>().Where(s => s.ContractId == id).ToArrayAsync();
        Assert.Single(attempts, s => s.Status == SignatureStatus.Failed); Assert.Single(attempts, s => s.Status == SignatureStatus.Signed);
    }
    private sealed class RejectedSigning : IContractSigningProvider
    {
        private readonly TestOnlySigningProvider inner = new();
        public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid c, byte[]? p, CancellationToken t) => inner.PrepareAsync(d, c, p, t);
        public Task<string> RequestAsync(ContractSignature s, CancellationToken t) => inner.RequestAsync(s, t);
        public Task<SigningOutcome> PollAsync(ContractSignature s, byte[] p, CancellationToken t) => Task.FromResult(new SigningOutcome("Failed"));
    }

    [Fact]
    public async Task UploadFailureLeavesDurableCleanupIntentAndNoDanglingSignatureReference()
    {
        var w = await Setup(); var id = await Draft(w);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var realStorage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddScoped<IObjectStorage>(_ => new FailingStorage(realStorage))));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        Assert.Equal(HttpStatusCode.InternalServerError, (await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid()))).StatusCode);
        Assert.Empty(await db.Set<ContractSignature>().Where(s => s.ContractId == id).ToArrayAsync());
        var intent = await db.Set<ContractFileUpload>().SingleAsync(f => f.RoomId == w.Room);
        await realStorage.CopyToAsync(intent.ObjectKey, Stream.Null, default);
        await ContractFileCleanup.CleanupAsync(db, realStorage, DateTimeOffset.UtcNow.AddDays(2), default);
        Assert.False(await db.Set<ContractFileUpload>().AnyAsync(f => f.RoomId == w.Room));
        await Assert.ThrowsAnyAsync<Exception>(() => realStorage.CopyToAsync(intent.ObjectKey, Stream.Null, default));
    }
    private sealed class FailingStorage(IObjectStorage inner) : IObjectStorage
    {
        public async Task PutAsync(string key, Stream data, long length, string contentType, CancellationToken t)
        { await inner.PutAsync(key, data, length, contentType, t); throw new IOException("TEST ONLY interrupted upload"); }
        public Task CopyToAsync(string key, Stream output, CancellationToken t) => inner.CopyToAsync(key, output, t);
        public Task DeleteAsync(string key, CancellationToken t) => inner.DeleteAsync(key, t);
    }

    [Fact]
    public async Task CertificateDirectoryIsPrivateAndActualAdapterRejectsAnotherSignersCertificate()
    {
        var w = await Setup(); var id = await Draft(w); var ownerCert = Guid.NewGuid(); var tenantCert = Guid.NewGuid();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            foreach (var (certId, actorId) in new[] { (ownerCert, w.Owner.Id), (tenantCert, w.Tenant.Id) }) db.Add(new BHome.DigitalSigning.Domain.SigningCertificate
            {
                Id = certId, OwnerUserId = actorId, Provider = "viettel-mysign", ProviderUserId = "SYNTHETIC-SUBSCRIBER-" + certId,
                CredentialId = "SYNTHETIC-CREDENTIAL", SerialNumber = certId.ToString(), Subject = "CN=Synthetic", Issuer = "CN=Synthetic CA",
                ValidFrom = DateTimeOffset.UtcNow.AddDays(-1), ValidTo = DateTimeOffset.UtcNow.AddDays(10), CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }
        const string certificates = "/api/v1/digital-signing/certificates";
        var mine = await w.Owner.Client.GetFromJsonAsync<BHome.DigitalSigning.Application.Contracts.CertificateView[]>(certificates);
        Assert.Equal(ownerCert, Assert.Single(mine!).Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(certificates)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(w.Owner, certificates + $"/{tenantCert}/lock", new { locked = true })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Post(w.Tenant, certificates + $"/{tenantCert}/lock", new { locked = true })).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Post(w.Owner, certificates, new { providerUserId = "SYNTHETIC-UNCONFIGURED", serialNumber = (string?)null })).StatusCode);
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddScoped(typeof(IContractSigningProvider), fixture.ProductionSigningProviderType)));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        Assert.Equal(HttpStatusCode.NotFound, (await Post(actor, Path(id, "signing"), new SigningInput(tenantCert))).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Post(actor, Path(id, "signing"), new SigningInput(ownerCert))).StatusCode);
        Assert.Equal("PendingSigning", (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
    }
}

public sealed class ContractFixture : IAsyncLifetime
{
    private readonly CaptureFixture infrastructure = new();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public TestSettlementLedger Ledger { get; } = new();
    public Type ProductionSigningProviderType { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await infrastructure.InitializeAsync();
        var testSigningKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));
        Factory = infrastructure.Factory.WithWebHostBuilder(b => {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:SigningKey"] = testSigningKey }));
            b.ConfigureTestServices(s =>
        {
            ProductionSigningProviderType = s.Last(d => d.ServiceType == typeof(IContractSigningProvider)).ImplementationType!;
            s.RemoveAll<IContractSigningProvider>(); s.AddSingleton<IContractSigningProvider, TestOnlySigningProvider>();
            s.RemoveAll<IContractSettlementLedger>(); s.AddSingleton<IContractSettlementLedger>(Ledger);
        }); });
    }
    public async Task DisposeAsync() { if (Factory is not null) await Factory.DisposeAsync(); await infrastructure.DisposeAsync(); }
}

// Explicitly a test boundary. These byte arrays are NOT valid electronic signatures or legal PDFs.
internal sealed class TestOnlySigningProvider : IContractSigningProvider
{
    public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid cert, byte[]? previous, CancellationToken t)
    {
        var source = previous ?? Encoding.UTF8.GetBytes("TEST ONLY contract " + d.SnapshotHash);
        return Task.FromResult(new SigningPreparation(source, source.Concat(" TEST ONLY prepared"u8.ToArray()).ToArray(), "test-field", "test-digest", "test-hash", "test-chain", "test-subscriber", "test-credential"));
    }
    public Task<string> RequestAsync(ContractSignature s, CancellationToken t) => Task.FromResult("TEST-ONLY-" + s.Id);
    public Task<SigningOutcome> PollAsync(ContractSignature s, byte[] prepared, CancellationToken t)
        => Task.FromResult(new SigningOutcome("Signed", prepared.Concat(" TEST ONLY verified boundary"u8.ToArray()).ToArray()));
}
public sealed class TestSettlementLedger : IContractSettlementLedger
{
    public ConcurrentDictionary<Guid, bool> Resolved { get; } = new();
    public Task<SettlementLedgerState?> ReadAsync(Guid id, Guid e, Guid w, CancellationToken t) =>
        Task.FromResult<SettlementLedgerState?>(Resolved.GetValueOrDefault(id) ? new(true, true, true, "TEST-ONLY-LEDGER-" + id) : null);
}
