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
        var expires = DateTimeOffset.UtcNow.AddMinutes(30);
        credentials.VerifyAsync("staff@example.invalid", "test-password", Arg.Any<CancellationToken>())
            .Returns(new VerifiedIdentity(id, [Roles.Staff, Roles.Staff]));
        sessions.CreateAsync(Arg.Any<VerifiedIdentity>(), null, Arg.Any<CancellationToken>()).Returns(new LoginResult(id, [Roles.Staff], "verified-token", expires, Guid.NewGuid(), "test-refresh", expires.AddDays(7)));

        var result = await new LoginService(credentials, sessions, audit).LoginAsync("staff@example.invalid", "test-password");

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
    [InlineData("username-only", "password")]
    [InlineData("0900000000", "password")]
    [InlineData("invalid@@example.invalid", "password")]
    [InlineData("user@example.invalid", null)]
    [InlineData("user@example.invalid", "")]
    [InlineData("user@example.invalid", " ")]
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
            oversizedName ? new string('u', LoginService.MaxEmailLength + 1) : "user@example.invalid",
            oversizedName ? "password" : new string('p', LoginService.MaxPasswordLength + 1)));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
    }

    [Fact]
    public async Task FailedVerificationNeverIssuesToken()
    {
        Assert.Null(await new LoginService(credentials, sessions, audit).LoginAsync("user@example.invalid", "wrong-password"));
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    [Fact]
    public async Task EmailIsTrimmedWithoutChangingThePassword()
    {
        await new LoginService(credentials, sessions, audit).LoginAsync("  User@example.invalid  ", " password ");
        await credentials.Received(1).VerifyAsync("User@example.invalid", " password ", Arg.Any<CancellationToken>());
        await audit.Received(1).LoginFailedAsync(Arg.Any<CancellationToken>());
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
        Assert.Null(await new LoginService(credentials, sessions, audit).LoginAsync("user@example.invalid", "password"));
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    [Fact]
    public async Task CancellationBeforeVerificationDoesNotIssueToken()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new LoginService(credentials, sessions, audit).LoginAsync("user@example.invalid", "password", cancellation.Token));
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
            new LoginService(credentials, sessions, audit).LoginAsync("user@example.invalid", "password", cancellation.Token));
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }
}
