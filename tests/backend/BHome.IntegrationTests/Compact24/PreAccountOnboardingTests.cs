using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed class PreAccountOnboardingTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task StaffConfirmsResidentWithUniqueEmailWithoutCreatingLoginAndOtherLocationRemainsHidden()
    {
        using var factory = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["IdentityProtection:ActiveEncryptionVersion"] = "test",
            ["IdentityProtection:ActiveHmacVersion"] = "test",
            ["IdentityProtection:EncryptionKeys:test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            ["IdentityProtection:HmacKeys:test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        })));
        await Compact24SampleSeed.RunAsync(factory.Services, "Development", WorkflowTestUsers.Password);
        using var staff = factory.CreateClient();
        var login = await staff.PostAsJsonAsync("/api/v1/auth/login", new { email = "staff.sample@example.invalid", password = WorkflowTestUsers.Password });
        login.EnsureSuccessStatusCode();
        staff.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        int usersBefore;
        Guid otherRoom;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            usersBefore = await db.Users.CountAsync();
            otherRoom = await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r => r.LocationId == Compact24SampleSeed.Id(11)).Select(r => r.Id).FirstAsync();
        }
        var email = $"new-{Guid.NewGuid():N}@example.invalid";
        var input = new ResidentInput(Compact24SampleSeed.Id(40), "Synthetic new occupant", ResidentType.Representative, email);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/capture/residents", input with { Email = null })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/capture/residents", input with { Email = "invalid" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.PostAsJsonAsync("/api/v1/capture/residents", input with { RoomId = otherRoom })).StatusCode);
        var created = await staff.PostAsJsonAsync("/api/v1/capture/residents", input);
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<IdResult>())!.Id;
        Assert.Equal(HttpStatusCode.Conflict, (await staff.PostAsJsonAsync("/api/v1/capture/residents", input with { Email = email.ToUpperInvariant() })).StatusCode);
        var confirmed = await staff.PostAsJsonAsync($"/api/v1/capture/residents/{id}/confirm",
            new IdentityConfirmation(true, "000000000001", "SYNTHETIC PERSON", new(2000, 1, 1), "Synthetic address", null, null, null, new(2020, 1, 1), null));
        confirmed.EnsureSuccessStatusCode();
        await using var read = factory.Services.CreateAsyncScope();
        var context = read.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var resident = await context.Set<Resident>().AsNoTracking().SingleAsync(r => r.Id == id);
        Assert.Equal(email, resident.ContactEmail);
        Assert.Equal(IdentityVerificationStatus.Verified, resident.VerificationStatus);
        Assert.Null(resident.TenantUserId);
        Assert.DoesNotContain("SYNTHETIC PERSON", resident.IdentityData);
        Assert.Equal(usersBefore, await context.Users.CountAsync());
    }
}
