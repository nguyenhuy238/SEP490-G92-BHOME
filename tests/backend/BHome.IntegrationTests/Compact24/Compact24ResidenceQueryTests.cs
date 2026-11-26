using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24ResidenceQueryTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task RepresentativeUpdatesChildWithoutIdentityAndSharedEvidenceIsAtomicAndPrivate()
    {
        using var tenant = await User(Roles.Tenant); using var owner = await User(Roles.Owner);
        using var outsider = await User(Roles.Tenant); using var staff = await User(Roles.Staff);
        var tenantId = (await tenant.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!.UserId;
        var ownerId = (await owner.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!.UserId;
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var chain = new Chain { Name = "Synthetic family residence" };
        var location = new Location("Synthetic family residence") { ChainId = chain.Id };
        var room = new Room { LocationId = location.Id, RoomNumber = "FAMILY-SYN", Capacity = 3, Status = RoomStatus.Occupied };
        var adult = new Resident { RoomId = room.Id, OwnerUserId = ownerId, TenantUserId = tenantId, DisplayLabel = "Synthetic representative" };
        var child = new Resident { RoomId = room.Id, OwnerUserId = ownerId, ResidentType = ResidentType.CoOccupant, DisplayLabel = "Synthetic child" };
        var from = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-10);
        var contract = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = ownerId,
            TenantUserId = tenantId,
            RepresentativeResidentId = adult.Id,
            StartDate = from.AddMonths(-1),
            EndDate = from.AddMonths(12),
            Status = ContractStatus.Active,
            Terms = "Synthetic family",
            SnapshotHash = new string('0', 64),
            ActivatedByUserId = ownerId,
            ActivatedAt = DateTimeOffset.UtcNow,
            Residents = [new() { ResidentId = adult.Id, Role = ResidentType.Representative, ResidenceFrom = from }, new() { ResidentId = child.Id, Role = ResidentType.CoOccupant, ResidenceFrom = from }]
        };
        foreach (var member in contract.Residents) member.ContractId = contract.Id;
        db.AddRange(chain, location, room, adult, child, contract); await db.SaveChangesAsync();
        var childRoute = $"/api/v1/residence-tasks/{contract.Id}/{child.Id}";
        var adultRoute = $"/api/v1/residence-tasks/{contract.Id}/{adult.Id}";
        var expires = from.AddMonths(6);
        var update = await tenant.PutAsJsonAsync(childRoute, new ResidenceUpdate(from, "InProgress", null, "Synthetic representative update", RegistrationExpiresOn: expires));
        Assert.True(update.IsSuccessStatusCode, await update.Content.ReadAsStringAsync());
        Assert.Equal(expires, (await update.Content.ReadFromJsonAsync<ResidenceTaskView>())!.RegistrationExpiresOn);
        (await tenant.PutAsJsonAsync(adultRoute, new ResidenceUpdate(from, "InProgress", null, "Synthetic update"))).EnsureSuccessStatusCode();
        var list = (await tenant.GetFromJsonAsync<OperationsPage<ResidenceTaskView>>("/api/v1/residence-tasks"))!;
        Assert.Contains(list.Items, r => r.ResidentId == child.Id);
        Assert.False(list.Items.Single(r => r.ResidentId == adult.Id).HouseholdCompleted);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(childRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PutAsJsonAsync(childRoute, new ResidenceUpdate(from, "InProgress", null, null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(childRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(childRoute + "/evidence")).StatusCode);
        var repository = scope.ServiceProvider.GetRequiredService<IOperationsRepository>();
        var a = (await repository.ResidenceAsync(contract.Id, adult.Id, tenantId, default))!;
        var b = (await repository.ResidenceAsync(contract.Id, child.Id, tenantId, default))!;
        var targets = new[] { new ResidenceEvidenceTarget(a.ResidentId, a.Reference!), new ResidenceEvidenceTarget(b.ResidentId, b.Reference!) };
        var shared = await repository.AttachHouseholdEvidenceAsync(tenantId, contract.Id, targets, new("synthetic-shared-key", "image/png", 128), DateTimeOffset.UtcNow, default);
        Assert.Equal(2, shared.Count); Assert.All(shared, r => Assert.True(r.HasEvidence));
        await Assert.ThrowsAsync<OperationsException>(() => repository.AttachHouseholdEvidenceAsync(tenantId, contract.Id,
            [new(adult.Id, shared.Single(r => r.ResidentId == adult.Id).Reference!), new(child.Id, "stale")], new("must-rollback-key", "image/png", 128), DateTimeOffset.UtcNow, default));
        Assert.Equal("synthetic-shared-key", (await repository.ResidenceEvidenceAsync(contract.Id, adult.Id, tenantId, default))!.ObjectKey);
        foreach (var route in new[] { adultRoute, childRoute })
        {
            (await tenant.PutAsJsonAsync(route, new ResidenceUpdate(from, "Completed", DateTimeOffset.UtcNow.AddMinutes(-1), "Synthetic result"))).EnsureSuccessStatusCode();
            (await owner.PostAsJsonAsync(route + "/owner-confirmation", new ResidenceOwnerConfirmation("Synthetic reviewed result"))).EnsureSuccessStatusCode();
        }
        var completed = (await tenant.GetFromJsonAsync<ResidenceTaskView>(childRoute))!;
        Assert.True(completed.HouseholdCompleted);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PutAsJsonAsync(childRoute + "/tracking-settings", new ResidenceTrackingSettings(false, null, completed.Reference!, "Denied"))).StatusCode);
        var configured = await owner.PutAsJsonAsync(childRoute + "/tracking-settings", new ResidenceTrackingSettings(false, null, completed.Reference!, "Synthetic exemption reviewed by Owner"));
        Assert.True(configured.IsSuccessStatusCode, await configured.Content.ReadAsStringAsync());
        Assert.False((await configured.Content.ReadFromJsonAsync<ResidenceTaskView>())!.RegistrationRequired);
        var configuredView = (await owner.GetFromJsonAsync<ResidenceTaskView>(childRoute))!;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        (await owner.PutAsJsonAsync(childRoute + "/tracking-settings", new ResidenceTrackingSettings(true, today.AddDays(16), configuredView.Reference!, "Synthetic expiry boundary"))).EnsureSuccessStatusCode();
        var publisher = scope.ServiceProvider.GetRequiredService<BHome.Application.Notifications.INotificationEventPublisher>();
        await publisher.PublishPendingAsync(default);
        Assert.Equal(0, await db.Set<BHome.Domain.Notifications.UserNotification>().CountAsync(n => n.RelatedObjectId == child.Id && n.Title == "Tạm trú sắp hết hạn"));
        configuredView = (await owner.GetFromJsonAsync<ResidenceTaskView>(childRoute))!;
        (await owner.PutAsJsonAsync(childRoute + "/tracking-settings", new ResidenceTrackingSettings(true, today.AddDays(15), configuredView.Reference!, "Synthetic 15-day alert"))).EnsureSuccessStatusCode();
        await publisher.PublishPendingAsync(default); await publisher.PublishPendingAsync(default);
        Assert.Equal(2, await db.Set<BHome.Domain.Notifications.UserNotification>().CountAsync(n => n.RelatedObjectId == child.Id && n.Title == "Tạm trú sắp hết hạn"));
        var contracts = (await owner.GetFromJsonAsync<BHome.Application.Contracts.ContractPage>("/api/v1/contracts?kind=Main"))!;
        Assert.Contains(contracts.Items, c => c.Id == contract.Id);
        Assert.All(contracts.Items, c => Assert.Equal("Main", c.Kind));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/v1/contracts?kind=UnknownKind")).StatusCode);
        var staffId = (await staff.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!.UserId;
        db.Add(new StaffLocationAssignment(location.Id, staffId, ownerId, from, from.AddMonths(12))); await db.SaveChangesAsync();
        var tracking = await staff.GetAsync("/api/v1/residence-tasks/tracking");
        Assert.True(tracking.IsSuccessStatusCode, await tracking.Content.ReadAsStringAsync());
        Assert.Contains((await tracking.Content.ReadFromJsonAsync<OperationsPage<ResidenceTrackingSummary>>())!.Items, r => r.ResidentId == child.Id);
        Assert.DoesNotContain("hasEvidence", await tracking.Content.ReadAsStringAsync());
        Assert.DoesNotContain("history", await tracking.Content.ReadAsStringAsync());
        using var unassigned = await User(Roles.Staff);
        Assert.Empty((await unassigned.GetFromJsonAsync<OperationsPage<ResidenceTrackingSummary>>("/api/v1/residence-tasks/tracking"))!.Items);
        // An arrival in a later month reuses the already active Room obligation;
        // it must not collect another rent/deposit or person fee.
        var arrivalUser = (await outsider.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!.UserId;
        var arrival = new Resident { RoomId = room.Id, OwnerUserId = ownerId, TenantUserId = arrivalUser, DisplayLabel = "Synthetic arrival" };
        var joining = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = ownerId,
            TenantUserId = arrivalUser,
            RepresentativeResidentId = arrival.Id,
            StartDate = today,
            EndDate = today.AddMonths(6),
            MonthlyRent = 3000000,
            RequiredDeposit = 3000000,
            InitialPaymentRequired = true,
            Status = ContractStatus.PendingActivation,
            Terms = "Synthetic joining contract",
            Residents = [new() { ResidentId = arrival.Id, Role = ResidentType.Representative, ResidenceFrom = today }]
        };
        joining.Residents[0].ContractId = joining.Id;
        joining.SnapshotHash = BHome.Application.Contracts.ContractDocumentSnapshot.Hash(new(joining.Id, room.Id, ownerId, arrivalUser,
            arrival.Id, [arrival.Id], joining.StartDate, joining.EndDate, joining.MonthlyRent, joining.RequiredDeposit, null, 0, joining.Terms, ""));
        foreach (var signer in new[] { ownerId, arrivalUser }) joining.Signatures.Add(new()
        {
            ContractId = joining.Id,
            SignerUserId = signer,
            Status = SignatureStatus.Signed,
            SignedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            SnapshotHash = joining.SnapshotHash,
            SignedObjectKey = "synthetic-only",
            ProviderReference = "synthetic-reference-" + signer
        });
        db.AddRange(arrival, joining); await db.SaveChangesAsync();
        var paymentResponse = await owner.GetAsync($"/api/v1/contracts/{joining.Id}/initial-payment");
        Assert.True(paymentResponse.IsSuccessStatusCode, await paymentResponse.Content.ReadAsStringAsync());
        var payment = (await paymentResponse.Content.ReadFromJsonAsync<BHome.Application.PaymentsDebt.MainInitialPaymentView>())!;
        Assert.Equal(0, payment.OutstandingAmount); Assert.True(payment.Paid); Assert.Equal("Settled", payment.Availability);
        Assert.All(payment.Charges, charge => Assert.Equal(0, charge.Amount)); Assert.Null(payment.TransferReference);
    }

    private async Task<HttpClient> User(string role)
    {
        const string password = "Synthetic-Residence!874";
        var email = $"{Guid.NewGuid():N}@example.invalid";
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var existingOwner = role == Roles.Owner ? await db.Users.FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner)) : null;
            if (existingOwner is not null) email = existingOwner.Email!;
            else await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { Id = Guid.NewGuid(), UserName = email, Email = email }, role, password);
        }
        var client = fixture.Factory!.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        return client;
    }

    [CompactPostgresFact]
    public async Task TenantCanUpdateStatusAndAttachEvidenceWithoutAmbiguousJoinedHistory()
    {
        using var client = await User(Roles.Tenant);
        var identity = (await client.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!;
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var owner = await db.Users.FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner));
        if (owner is null)
        {
            using var ownerClient = await User(Roles.Owner);
            var ownerIdentity = (await ownerClient.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!;
            owner = await db.Users.SingleAsync(u => u.Id == ownerIdentity.UserId);
        }
        var chain = await db.Set<Chain>().FirstOrDefaultAsync();
        if (chain is null) { chain = new Chain { Name = "Synthetic residence chain" }; db.Add(chain); }
        var location = new Location("Synthetic residence mutation test") { ChainId = chain.Id };
        var room = new Room { LocationId = location.Id, RoomNumber = "RES-TEST", Capacity = 1, Status = RoomStatus.Occupied };
        var resident = new Resident { RoomId = room.Id, TenantUserId = identity.UserId, OwnerUserId = owner.Id, DisplayLabel = "Synthetic resident" };
        var from = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-10);
        var contract = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = owner.Id,
            TenantUserId = identity.UserId,
            RepresentativeResidentId = resident.Id,
            StartDate = from,
            EndDate = from.AddMonths(12),
            Status = ContractStatus.Active,
            IsDevelopmentDemo = true,
            Terms = "Synthetic SQL regression fixture",
            SnapshotHash = new string('0', 64),
            ActivatedByUserId = owner.Id,
            ActivatedAt = DateTimeOffset.UtcNow,
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = from }]
        };
        contract.Residents[0].ContractId = contract.Id;
        db.AddRange(location, room, resident, contract);
        await db.SaveChangesAsync();
        var route = $"/api/v1/residence-tasks/{contract.Id}/{resident.Id}";
        var update = await client.PutAsJsonAsync(route, new ResidenceUpdate(from, "InProgress", null, "Synthetic status update"));
        Assert.True(update.IsSuccessStatusCode, await update.Content.ReadAsStringAsync());
        var record = (await update.Content.ReadFromJsonAsync<ResidenceTaskView>())!;
        Assert.Equal("InProgress", record.Status);
        Assert.True(record.TrackingActive); Assert.NotNull(record.Reference);
        using var ownerReview = await User(Roles.Owner);
        var confirmation = await ownerReview.PostAsJsonAsync(route + "/accommodation-confirmation",
            new ResidenceAccommodationConfirmation("Synthetic official-channel accommodation confirmation", record.Reference!, from.AddDays(20)));
        Assert.True(confirmation.IsSuccessStatusCode, await confirmation.Content.ReadAsStringAsync());
        var confirmed = (await confirmation.Content.ReadFromJsonAsync<ResidenceTaskView>())!;
        Assert.True(confirmed.AccommodationConfirmed); Assert.False(confirmed.OwnerConfirmed);
        Assert.Equal("InProgress", confirmed.Status); Assert.Equal(from.AddDays(20), confirmed.RegistrationDeadline);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(route,
            new ResidenceUpdate(from, "InProgress", null, "Stale synthetic edit", record.Reference))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await ownerReview.PostAsJsonAsync(route + "/accommodation-confirmation",
            new ResidenceAccommodationConfirmation("Repeated confirmation", confirmed.Reference!))).StatusCode);
        using var staffClient = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.Forbidden, (await staffClient.PostAsJsonAsync(route + "/accommodation-confirmation",
            new ResidenceAccommodationConfirmation("Denied", confirmed.Reference!))).StatusCode);
        var repository = scope.ServiceProvider.GetRequiredService<IOperationsRepository>();
        var attached = await repository.AttachResidenceEvidenceAsync(identity.UserId, contract.Id, resident.Id,
            new OperationsFile("synthetic-regression-only.png", "image/png", 128), DateTimeOffset.UtcNow, default);
        Assert.Contains(attached.History, h => h.Action == "TenantStatusUpdated");
        Assert.Contains(attached.History, h => h.Action == "EvidenceUploaded");
        using var otherTenant = await User(Roles.Tenant);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.PutAsJsonAsync(route,
            new ResidenceUpdate(from, "InProgress", null, "Must not overwrite"))).StatusCode);
    }

    [CompactPostgresFact]
    public async Task ActiveContractListsResidenceTaskBeforeTenantRecordsActualResidenceDate()
    {
        using var tenant = await User(Roles.Tenant);
        var tenantId = (await tenant.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!.UserId;
        Guid ownerId;
        using (var owner = await User(Roles.Owner))
            ownerId = (await owner.GetFromJsonAsync<SessionIdentity>("/api/v1/auth/me"))!.UserId;

        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var chain = new Chain { Name = "Synthetic residence onboarding" };
        var location = new Location("Synthetic residence onboarding") { ChainId = chain.Id };
        var room = new Room { LocationId = location.Id, RoomNumber = "RES-START", Capacity = 1, Status = RoomStatus.Occupied };
        var resident = new Resident { RoomId = room.Id, TenantUserId = tenantId, OwnerUserId = ownerId, DisplayLabel = "Synthetic residence tenant" };
        var start = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime).AddDays(-1);
        var contract = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = ownerId,
            TenantUserId = tenantId,
            RepresentativeResidentId = resident.Id,
            StartDate = start,
            EndDate = start.AddMonths(12),
            Status = ContractStatus.Active,
            Terms = "Synthetic active residence contract",
            SnapshotHash = new string('0', 64),
            ActivatedByUserId = ownerId,
            ActivatedAt = DateTimeOffset.UtcNow,
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = start }]
        };
        contract.Residents[0].ContractId = contract.Id;
        db.AddRange(chain, location, room, resident, contract);
        await db.SaveChangesAsync();

        var route = $"/api/v1/residence-tasks/{contract.Id}/{resident.Id}";
        var initialPage = (await tenant.GetFromJsonAsync<OperationsPage<ResidenceTaskView>>("/api/v1/residence-tasks"))!;
        var initial = Assert.Single(initialPage.Items, item => item.ContractId == contract.Id && item.ResidentId == resident.Id);
        Assert.Null(initial.ActualResidenceFrom);
        Assert.Equal("Pending", initial.Status);

        var update = await tenant.PutAsJsonAsync(route, new ResidenceUpdate(start, "InProgress", null, "Synthetic residence tracking started"));
        Assert.True(update.IsSuccessStatusCode, await update.Content.ReadAsStringAsync());
        var updated = (await update.Content.ReadFromJsonAsync<ResidenceTaskView>())!;
        Assert.Equal(start, updated.ActualResidenceFrom);
        Assert.Equal("InProgress", updated.Status);
    }

    [CompactPostgresFact]
    public async Task OmittedAndExplicitStatusFiltersExecuteOnPostgresForOwnerAndTenant()
    {
        foreach (var role in new[] { Roles.Owner, Roles.Tenant })
        {
            using var client = await User(role);
            // Even an empty database must bind a typed NULL before PostgreSQL evaluates IS NULL.
            foreach (var status in new string?[] { null, "Pending", "InProgress", "Completed" })
            {
                var suffix = status is null ? "" : "&status=" + status;
                var response = await client.GetAsync("/api/v1/residence-tasks?page=1&pageSize=20" + suffix);
                Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
                var page = (await response.Content.ReadFromJsonAsync<OperationsPage<ResidenceTaskView>>())!;
                Assert.Equal(1, page.Page);
                Assert.Equal(20, page.PageSize);
                Assert.True(page.TotalCount >= 0);
                if (status is not null) Assert.All(page.Items, item => Assert.Equal(status, item.Status));
            }
        }
        using var staff = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/residence-tasks")).StatusCode);
    }
}
