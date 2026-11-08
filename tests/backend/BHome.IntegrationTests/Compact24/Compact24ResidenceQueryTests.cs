using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

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
            await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
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
                Assert.Equal(0, page.TotalCount);
                Assert.Empty(page.Items);
            }
        }
        using var staff = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/residence-tasks")).StatusCode);
    }
}
