using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.LocalDevelopment;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class OwnerResidentAdministrationTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    [CompactPostgresFact]
    public async Task OwnerAndSuccessiveStaffCreatorsShareIdentityScopeAndRetainCreatorAudit()
    {
        await Compact24SampleSeed.RunAsync(fixture.Capture.Factory.Services, "Development", WorkflowTestUsers.Password);
        using var owner = await Login("owner.sample@example.invalid");
        using var first = await Login("staff.sample@example.invalid");
        var email = $"{Guid.NewGuid():N}@example.invalid";
        Guid secondId;
        await using (var scope = fixture.Capture.Factory.Services.CreateAsyncScope())
        {
            secondId = (await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { Id = Guid.NewGuid(), UserName = email, Email = email }, "Staff", WorkflowTestUsers.Password)).Id;
        }
        using var second = await Login(email);
        var ids = new[] { await Create(owner, "Owner label"), await Create(first, "First staff label"), Guid.Empty };
        var location = await owner.GetFromJsonAsync<BHome.Application.PropertyManagement.LocationDto>($"/api/v1/locations/{Compact24SampleSeed.Id(10)}");
        var changed = await owner.PutAsJsonAsync($"/api/v1/staff-location-assignments/{location!.Id}",
            new { staffUserId = secondId, effectiveFrom = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime), locationVersion = location.Version, reason = "Synthetic replacement" });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        ids[2] = await Create(second, "Second staff label");
        await using (var scope = fixture.Capture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var people = await db.Set<Resident>().Where(r => ids.Contains(r.Id)).ToArrayAsync();
            Assert.Equal(3, people.Length);
            Assert.All(people, p => Assert.Equal(Compact24SampleSeed.Id(1), p.OwnerUserId));
            Assert.Equal(3, await db.SecurityAudit.CountAsync(a => a.Event == "ResidentCreated" && ids.Contains(a.TargetId!.Value)));
        }
        var input = new IdentityConfirmation(true, "000000000000", "Synthetic Person", new DateOnly(2000, 1, 1), null, null, null, null, null, null);
        Assert.Equal(HttpStatusCode.OK, (await second.PostAsJsonAsync($"/api/v1/capture/residents/{ids[0]}/confirm", input)).StatusCode);
        // A previously confirmed Staff-scoped envelope must remain readable without a data migration.
        await using (var scope = fixture.Capture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var protection = scope.ServiceProvider.GetRequiredService<IIdentityProtection>();
            var legacy = await db.Set<Resident>().SingleAsync(r => r.Id == ids[0]);
            legacy.OwnerUserId = Compact24SampleSeed.Id(2);
            var index = protection.CreateMatchIndex(input.CitizenIdentityNumber, legacy.OwnerUserId);
            legacy.IdentityHmac = index.Digest; legacy.HmacKeyVersion = index.KeyVersion;
            legacy.IdentityData = JsonSerializer.Serialize(protection.Encrypt(JsonSerializer.SerializeToUtf8Bytes(input), new(legacy.OwnerUserId, legacy.Id)));
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.OK, (await second.PostAsJsonAsync($"/api/v1/capture/residents/{ids[0]}/confirm", input)).StatusCode);
        foreach (var id in ids.Skip(1)) Assert.Equal(HttpStatusCode.Conflict, (await second.PostAsJsonAsync($"/api/v1/capture/residents/{id}/confirm", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync($"/api/v1/capture/residents/{ids[1]}/confirm", input)).StatusCode);
    }

    [CompactPostgresFact]
    public async Task OwnerAdministrationIsPrivatePaginatedVersionedAndDoesNotChangeIdentity()
    {
        await Compact24SampleSeed.RunAsync(fixture.Capture.Factory.Services, "Development", WorkflowTestUsers.Password);
        using var owner = await Login("owner.sample@example.invalid");
        using var staff = await Login("staff.sample@example.invalid");
        var id = await Create(owner, "Independent administration " + Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/residents")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"/api/v1/residents/{id}")).StatusCode);
        var response = await owner.GetAsync($"/api/v1/residents/{id}");
        response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("identityData", text); Assert.DoesNotContain("citizenIdentityNumber", text);
        var value = (await response.Content.ReadFromJsonAsync<BHome.Application.Operations.ResidentAdministrationView>())!;
        var input = new BHome.Application.Operations.ResidentLabelUpdate("Updated workspace label", value.Version, "Synthetic correction");
        var updated = await owner.PutAsJsonAsync($"/api/v1/residents/{id}/workspace-label", input);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/residents/{id}/workspace-label", input)).StatusCode);
        var page = await owner.GetFromJsonAsync<BHome.Application.Operations.OperationsPage<BHome.Application.Operations.ResidentAdministrationView>>($"/api/v1/residents?roomId={Compact24SampleSeed.Id(40)}&search=Updated%20workspace%20label&page=1&pageSize=1");
        Assert.Equal(id, Assert.Single(page!.Items).Id);
        Assert.Equal("Pending", page.Items[0].VerificationStatus);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/v1/residents?pageSize=101")).StatusCode);
    }

    private async Task<HttpClient> Login(string email)
    {
        var client = fixture.Capture.Factory.CreateClient();
        var result = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password });
        result.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await result.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return client;
    }
    private static async Task<Guid> Create(HttpClient client, string label)
    {
        var result = await client.PostAsJsonAsync("/api/v1/capture/residents", new ResidentInput(Compact24SampleSeed.Id(40), label, ResidentType.CoOccupant, $"capture-{Guid.NewGuid():N}@example.invalid"));
        result.EnsureSuccessStatusCode(); return (await result.Content.ReadFromJsonAsync<IdResult>())!.Id;
    }
}
