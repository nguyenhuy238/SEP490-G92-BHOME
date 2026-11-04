using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24ApiAuditTests
{
    private const string Password = "Synthetic!Audit-493Password";

    [CompactPostgresFact]
    public async Task EveryRegisteredBusinessRouteRequiresAuthenticationAndEveryGetExecutesWithoutLegacySchema()
    {
        var fixture = new Compact24Fixture(); await fixture.InitializeAsync();
        try
        {
            var factory = fixture.Factory!;
            await Compact24SampleSeed.RunAsync(factory.Services, "Development", Password);
            using var client = factory.CreateClient();
            var actions = factory.Services.GetRequiredService<IActionDescriptorCollectionProvider>().ActionDescriptors.Items
                .OfType<ControllerActionDescriptor>().Where(a => a.ControllerTypeInfo.Assembly == typeof(BHome.Api.Controllers.ContractsController).Assembly)
                .OrderBy(a => a.AttributeRouteInfo!.Template).ThenBy(a => a.ActionName).ToArray();
            Assert.NotEmpty(actions);
            var manifest = new List<object>();
            foreach (var action in actions)
            {
                var route = "/" + action.AttributeRouteInfo!.Template!.TrimStart('/');
                var anonymous = action.EndpointMetadata.OfType<IAllowAnonymous>().Any();
                var authorization = action.EndpointMetadata.OfType<IAuthorizeData>().ToArray();
                Assert.True(anonymous || authorization.Length > 0, "Missing authorization: " + route);
                var methods = action.EndpointMetadata.OfType<HttpMethodMetadata>().SelectMany(x => x.HttpMethods).ToArray();
                if (methods.Length == 0) methods = action.ActionConstraints!.OfType<Microsoft.AspNetCore.Mvc.ActionConstraints.HttpMethodActionConstraint>().SelectMany(x => x.HttpMethods).ToArray();
                foreach (var method in methods)
                {
                    var concrete = Regex.Replace(route, "\\{[^}]+\\}", Guid.NewGuid().ToString());
                    using var request = new HttpRequestMessage(new HttpMethod(method), concrete);
                    if (method is not ("GET" or "HEAD")) request.Content = JsonContent.Create(new { });
                    using var response = await client.SendAsync(request);
                    if (!anonymous) Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{method} {route}: expected 401, got {(int)response.StatusCode}");
                    manifest.Add(new
                    {
                        Method = method,
                        Route = route,
                        Controller = action.ControllerName,
                        Action = action.ActionName,
                        Anonymous = anonymous,
                        Authorization = authorization.Select(a => new { a.Policy, a.Roles }).ToArray(),
                        Parameters = action.Parameters.Select(p => new { p.Name, Type = p.ParameterType.Name, Source = p.BindingInfo?.BindingSource?.DisplayName }).ToArray(),
                        ReturnType = action.MethodInfo.ReturnType.ToString(),
                        AnonymousStatus = (int)response.StatusCode
                    });
                }
            }
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "owner.sample@example.invalid", password = Password });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
            var sampleLocation = Compact24SampleSeed.Id(10);
            foreach (var path in new[]
            {
                "/api/v1/chain", "/api/v1/locations?pageSize=100", "/api/v1/rooms?pageSize=100",
                $"/api/v1/room-types?locationId={sampleLocation}", $"/api/v1/assets?locationId={sampleLocation}",
                $"/api/v1/billing-policies?locationId={sampleLocation}", "/api/v1/capture/meter-tasks",
                $"/api/v1/capture/locations/{sampleLocation}/residents", "/api/v1/operational-tasks",
                "/api/v1/contracts", "/api/v1/invoices", "/api/v1/notifications"
            })
            {
                using var response = await client.GetAsync(path);
                Assert.True(response.StatusCode == HttpStatusCode.OK, $"Seeded Owner GET {path}: {(int)response.StatusCode}");
            }
            var gets = new List<object>();
            foreach (var action in actions.Where(a => a.ActionConstraints!.OfType<Microsoft.AspNetCore.Mvc.ActionConstraints.HttpMethodActionConstraint>().Any(c => c.HttpMethods.Contains("GET"))))
            {
                var route = "/" + action.AttributeRouteInfo!.Template;
                if (!route.StartsWith("/api/v1/", StringComparison.Ordinal)) continue;
                var concrete = Regex.Replace(route, "\\{[^}]+\\}", Guid.NewGuid().ToString());
                using var response = await client.GetAsync(concrete);
                Assert.True((int)response.StatusCode < 500, $"Owner GET {route}: {(int)response.StatusCode}");
                gets.Add(new { Route = route, Status = (int)response.StatusCode });
            }
            var directory = Environment.GetEnvironmentVariable("BHOME_COMPACT24_EVIDENCE_DIRECTORY");
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
                await File.WriteAllTextAsync(Path.Combine(directory, "api-route-audit.json"), JsonSerializer.Serialize(new
                { SchemaVersion = Compact24Schema.Version, Endpoints = manifest, OwnerGetProbes = gets }, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task SampleSeedIsRepeatablePreservesEditsAndSessionsUnlessPasswordResetIsExplicitAndKeepsStaffScope()
    {
        var fixture = new Compact24Fixture(); await fixture.InitializeAsync();
        try
        {
            var services = fixture.Factory!.Services;
            Assert.True(await Compact24SampleSeed.RunAsync(services, "Development", Password));
            using var client = fixture.Factory.CreateClient();
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "staff.sample@example.invalid", password = Password });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
            client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken);
            await using (var scope = services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
                var room = await db.Set<Room>().SingleAsync(r => r.Id == Compact24SampleSeed.Id(40));
                room.RoomNumber = "S101-EDITED"; room.Version++; await db.SaveChangesAsync();
            }
            Assert.False(await Compact24SampleSeed.RunAsync(services, "Development", "Different!Password-493"));
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
            var rooms = await client.GetAsync("/api/v1/rooms?pageSize=100"); Assert.Equal(HttpStatusCode.OK, rooms.StatusCode);
            using var body = JsonDocument.Parse(await rooms.Content.ReadAsStringAsync());
            Assert.Equal(3, body.RootElement.GetProperty("totalCount").GetInt32());
            Assert.Contains("S101-EDITED", await rooms.Content.ReadAsStringAsync());
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/locations/{Compact24SampleSeed.Id(11)}")).StatusCode);
            // Match the standalone CLI composition, not just the richer ASP.NET host.
            var cliConfig = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["ConnectionStrings:Database"] = fixture.Connection }).Build();
            var cliServices = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(cliConfig);
            cliServices.AddInfrastructure(cliConfig);
            await using var cli = cliServices.BuildServiceProvider();
            Assert.False(await Compact24SampleSeed.RunAsync(cli, "Development", "Different!Password-493", setSamplePasswords: true));
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
            await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
            await using var count = new NpgsqlCommand("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'", connection);
            Assert.Equal(24L, await count.ExecuteScalarAsync());
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task InvalidSamplePasswordRollsBackAllUsersAndBusinessData()
    {
        var fixture = new Compact24Fixture(); await fixture.InitializeAsync();
        try
        {
            await Assert.ThrowsAsync<LocalTestAccountException>(() => Compact24SampleSeed.RunAsync(fixture.Factory!.Services, "Development", "bad"));
            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(0, await db.Users.CountAsync()); Assert.Equal(0, await db.Locations.CountAsync());
            var existing = new BHome.Infrastructure.Persistence.ApplicationUser { Id = Guid.NewGuid(), UserName = "existing-owner", Email = "existing-owner@example.invalid", IsActive = true };
            db.PrepareUserRole(existing, "Owner");
            Assert.True((await scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<BHome.Infrastructure.Persistence.ApplicationUser>>()
                .CreateAsync(existing, Password)).Succeeded);
            await Assert.ThrowsAsync<LocalTestAccountException>(() => Compact24SampleSeed.RunAsync(fixture.Factory.Services, "Development", Password));
            Assert.Equal(1, await db.Users.CountAsync()); Assert.Equal(0, await db.Locations.CountAsync());
        }
        finally { await fixture.DisposeAsync(); }
    }

    [Theory]
    [InlineData("Production", "Host=localhost;Database=bhome")]
    [InlineData("Development", "Host=example.invalid;Database=bhome")]
    [InlineData("Development", "Host=localhost;Database=postgres")]
    public void SampleSeedRejectsOtherEnvironmentsAndTargets(string environment, string connection) =>
        Assert.Throws<LocalTestAccountException>(() => Compact24SampleSeed.ValidateTarget(environment, connection));
}
