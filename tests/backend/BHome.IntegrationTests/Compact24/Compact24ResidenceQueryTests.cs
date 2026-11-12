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
