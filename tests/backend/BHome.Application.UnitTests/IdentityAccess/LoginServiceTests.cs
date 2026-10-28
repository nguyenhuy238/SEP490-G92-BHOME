using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.IdentityAccess;

public sealed class LoginServiceTests
{
    private readonly ICredentialVerifier credentials = Substitute.For<ICredentialVerifier>();
    private readonly IAccessTokenIssuer tokens = Substitute.For<IAccessTokenIssuer>();

    [Fact]
    public async Task VerifiedIdentityIssuesTokenWithOnlyStoredDistinctRoles()
    {
        var id = Guid.NewGuid();
        var expires = DateTimeOffset.UtcNow.AddMinutes(15);
        credentials.VerifyAsync("staff", "test-password", Arg.Any<CancellationToken>())
            .Returns(new VerifiedIdentity(id, [Roles.Staff, Roles.Staff]));
        tokens.Issue(id, Arg.Any<IReadOnlyCollection<string>>()).Returns(new AccessToken("verified-token", expires));

        var result = await new LoginService(credentials, tokens).LoginAsync("staff", "test-password");

        Assert.NotNull(result);
        Assert.Equal(id, result.UserId);
        Assert.Equal([Roles.Staff], result.Roles);
        Assert.Equal("verified-token", result.AccessToken);
        Assert.Equal(expires, result.ExpiresAt);
        tokens.Received(1).Issue(id, Arg.Is<IReadOnlyCollection<string>>(roles => roles.SequenceEqual(new[] { Roles.Staff })));
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
        Assert.Null(await new LoginService(credentials, tokens).LoginAsync(name, password));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
        tokens.DidNotReceiveWithAnyArgs().Issue(default, default!);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OversizedInputDoesNotVerifyCredentials(bool oversizedName)
    {
        Assert.Null(await new LoginService(credentials, tokens).LoginAsync(
            oversizedName ? new string('u', LoginService.MaxUserNameLength + 1) : "user",
            oversizedName ? "password" : new string('p', LoginService.MaxPasswordLength + 1)));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
    }

    [Fact]
    public async Task FailedVerificationNeverIssuesToken()
    {
        Assert.Null(await new LoginService(credentials, tokens).LoginAsync("user", "wrong-password"));
        tokens.DidNotReceiveWithAnyArgs().Issue(default, default!);
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
        Assert.Null(await new LoginService(credentials, tokens).LoginAsync("user", "password"));
        tokens.DidNotReceiveWithAnyArgs().Issue(default, default!);
    }

    [Fact]
    public async Task CancellationBeforeVerificationDoesNotIssueToken()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new LoginService(credentials, tokens).LoginAsync("user", "password", cancellation.Token));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
        tokens.DidNotReceiveWithAnyArgs().Issue(default, default!);
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
            new LoginService(credentials, tokens).LoginAsync("user", "password", cancellation.Token));
        tokens.DidNotReceiveWithAnyArgs().Issue(default, default!);
    }
}
