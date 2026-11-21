namespace BHome.IntegrationTests.Compact24;

// Explicit opt-in only: this test sends real emails to the single operator-authorized
// recipient. Never run it as part of the normal suite without that authorization.
public sealed class LiveStep6SmtpFactAttribute : FactAttribute
{
    public LiveStep6SmtpFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")) ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_SIGNING_LIVE_RECIPIENT")))
            Skip = "Requires disposable local PostgreSQL, configured SMTP and an explicitly authorized live recipient.";
    }
}

public sealed class LiveStep6SigningTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [LiveStep6SmtpFact]
    public Task HoldingAndMainInvitationAndOwnerOtpUseRealSmtp()
        => new AnonymousSigningTests(fixture)
        {
            LiveRecipient = Environment.GetEnvironmentVariable("BHOME_SIGNING_LIVE_RECIPIENT")
        }.AnonymousHoldingWorkflow();
}
