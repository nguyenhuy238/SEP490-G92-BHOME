using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed class Compact24LoginValidationTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Password = "Synthetic!Login-795";
    private async Task<ApplicationUser> User(string? phone = null)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        return await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser
        { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.invalid", EmailConfirmed = true, PhoneNumber = phone }, "Tenant", Password);
    }

    [CompactPostgresTheory]
    [InlineData(null, null, null, "identifier")]
    [InlineData(" ", null, " ", "password")]
    [InlineData("bad@@example.invalid", null, "valid", "email")]
    [InlineData("bad email@example.invalid", null, "valid", "email")]
    [InlineData(null, "+84abc12345", "valid", "phone")]
    [InlineData(null, "123", "valid", "phone")]
    [InlineData("one@example.invalid", "0901234567", "valid", "identifier")]
    public async Task LoginReturnsSafeVietnameseFieldErrors(string? email, string? phone, string? password, string field)
    {
        using var client = fixture.Factory!.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, phone, password });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("errors").TryGetProperty(field, out var errors));
        Assert.NotEmpty(errors.EnumerateArray());
        Assert.DoesNotContain("Exception", body.ToString());
        if (email is null && phone is null && password is null)
            Assert.Equal("Vui lòng nhập mật khẩu.", body.GetProperty("errors").GetProperty("password")[0].GetString());
    }

    [CompactPostgresFact]
    public async Task DomesticAndInternationalPhoneAliasesFindOneIdentityAndRejectAmbiguity()
    {
        var user = await User("090-123 4567"); using var client = fixture.Factory!.CreateClient();
        foreach (var phone in new[] { "0901234567", "+84 (90) 123-4567" })
        {
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { phone, password = Password });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            Assert.Equal(user.Id, (await TestAuthResponse.ReadAsync(login.Content)).UserId);
        }
        await User("+84901234567");
        foreach (var phone in new[] { "0901234567", "+84901234567" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { phone, password = Password })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task UnknownWrongPasswordAndInactiveAccountsHaveTheSamePublicFailureAndBoundaryValidation()
    {
        var user = await User(); using var client = fixture.Factory!.CreateClient();
        var wrong = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "Wrong!Password-795" });
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        foreach (var response in new[] { wrong,
            await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password }),
            await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "unknown@example.invalid", password = Password }) })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(LoginService.InvalidCredentialsMessage, body.GetProperty("title").GetString());
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = new string('a', 257) + "@example.invalid", password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = new string('x', 1025) })).StatusCode);
    }
}
