using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.IdentityAccess;

public sealed class LoginServiceTests
{
    private readonly ICredentialVerifier credentials = Substitute.For<ICredentialVerifier>();
    private readonly IAuthenticationSessions sessions = Substitute.For<IAuthenticationSessions>();
    private readonly ISecurityAudit audit = Substitute.For<ISecurityAudit>();

    [Fact]
    public async Task VerifiedIdentityIssuesTokenWithOnlyStoredDistinctRoles()
    {
        var id = Guid.NewGuid();
        var expires = DateTimeOffset.UtcNow.AddMinutes(15);
        credentials.VerifyAsync("staff", "test-password", Arg.Any<CancellationToken>())
            .Returns(new VerifiedIdentity(id, [Roles.Staff, Roles.Staff]));
        sessions.CreateAsync(Arg.Any<VerifiedIdentity>(), null, Arg.Any<CancellationToken>()).Returns(new LoginResult(id, [Roles.Staff], "verified-token", expires, Guid.NewGuid(), "test-refresh", expires.AddDays(7)));

        var result = await new LoginService(credentials, sessions, audit).LoginAsync("staff", "test-password");

        Assert.NotNull(result);
        Assert.Equal(id, result.UserId);
        Assert.Equal([Roles.Staff], result.Roles);
        Assert.Equal("verified-token", result.AccessToken);
        Assert.Equal(expires, result.ExpiresAt);
        await sessions.Received(1).CreateAsync(Arg.Is<VerifiedIdentity>(identity => identity.UserId == id && identity.Roles.All(role => role == Roles.Staff)), null, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null, "password")]
    [InlineData("", "password")]
    [InlineData(" ", "password")]
    [InlineData("user", null)]
    [InlineData("user", "")]
    [InlineData("user", " ")]
    public async Task InvalidInputDoesNotVerifyCredentials(string? name, string? password)
    {
        Assert.Null(await new LoginService(credentials, sessions, audit).LoginAsync(name, password));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OversizedInputDoesNotVerifyCredentials(bool oversizedName)
    {
        Assert.Null(await new LoginService(credentials, sessions, audit).LoginAsync(
            oversizedName ? new string('u', LoginService.MaxUserNameLength + 1) : "user",
            oversizedName ? "password" : new string('p', LoginService.MaxPasswordLength + 1)));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
    }

    [Fact]
    public async Task FailedVerificationNeverIssuesToken()
    {
        Assert.Null(await new LoginService(credentials, sessions, audit).LoginAsync("user", "wrong-password"));
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    [Theory]
    [InlineData("empty-id")]
    [InlineData("no-roles")]
    [InlineData("unsupported-role")]
    [InlineData("mixed-roles")]
    public async Task InvalidVerifiedIdentityNeverIssuesToken(string scenario)
    {
        string[] roles = scenario switch
        {
            "no-roles" => [],
            "unsupported-role" => ["Administrator"],
            "mixed-roles" => [Roles.Owner, "Administrator"],
            _ => [Roles.Owner]
        };
        credentials.VerifyAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new VerifiedIdentity(scenario == "empty-id" ? Guid.Empty : Guid.NewGuid(), roles));
        Assert.Null(await new LoginService(credentials, sessions, audit).LoginAsync("user", "password"));
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    [Fact]
    public async Task CancellationBeforeVerificationDoesNotIssueToken()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new LoginService(credentials, sessions, audit).LoginAsync("user", "password", cancellation.Token));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    [Fact]
    public async Task CancellationDuringVerificationDoesNotIssueToken()
    {
        using var cancellation = new CancellationTokenSource();
        credentials.VerifyAsync(Arg.Any<string>(), Arg.Any<string>(), cancellation.Token).Returns(_ =>
        {
            cancellation.Cancel();
            return new VerifiedIdentity(Guid.NewGuid(), [Roles.Owner]);
        });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new LoginService(credentials, sessions, audit).LoginAsync("user", "password", cancellation.Token));
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }
}
