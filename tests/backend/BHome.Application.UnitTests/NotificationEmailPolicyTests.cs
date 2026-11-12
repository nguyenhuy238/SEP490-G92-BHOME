using BHome.Application.Notifications;

namespace BHome.Application.UnitTests;

public sealed class NotificationEmailPolicyTests
{
    [Theory]
    [InlineData("INVOICE_FINALIZED")]
    [InlineData("INVOICE_OVERDUE")]
    [InlineData("INVOICE_DUE_SOON")]
    [InlineData("INVOICE_FULLY_PAID")]
    [InlineData("PAYMENT_PARTIALLY_CONFIRMED")]
    [InlineData("CONTRACT_EXPIRY_REMINDER")]
    public void SupportedEventsAddOneEmailWithoutRemovingExistingChannels(string eventType)
    {
        var channels = NotificationEmailPolicy.Channels(eventType, "Tenant", ["IN_APP", "PUSH", "EMAIL"]);
        Assert.Equal(new[] { "IN_APP", "PUSH", "EMAIL" }, channels);
        Assert.Contains("EMAIL", NotificationEmailPolicy.Channels(eventType, "Tenant", ["IN_APP", "PUSH"]));
    }

    [Theory]
    [InlineData("Owner", true)]
    [InlineData("Staff", true)]
    [InlineData("Tenant", false)]
    public void EmergencyEmailOnlyExtendsOperationalRecipients(string role, bool email) => Assert.Equal(email,
        NotificationEmailPolicy.Channels("INCIDENT_EMERGENCY_SUBMITTED", role, ["IN_APP", "PUSH"]).Contains("EMAIL"));

    [Fact]
    public void OtherEventsAndExplicitAnnouncementChannelsRemainUnchanged()
    {
        foreach (var eventType in new[] { "INVOICE_DRAFT_READY", "PAYMENT_PENDING", "ANNOUNCEMENT_SENT", "TEMPORARY_RESIDENCE_ACTION" })
            Assert.Equal(new[] { "IN_APP" }, NotificationEmailPolicy.Channels(eventType, "Tenant", ["IN_APP"]));
    }

    [Fact]
    public void RetryDelaysAreBoundedAndMatchRequestedSchedule()
    {
        var policy = new NotificationChannelOptions();
        Assert.Equal(4, policy.MaxAttempts);
        Assert.Equal(TimeSpan.FromMinutes(1), policy.RetryDelay(1));
        Assert.Equal(TimeSpan.FromMinutes(5), policy.RetryDelay(2));
        Assert.Equal(TimeSpan.FromMinutes(15), policy.RetryDelay(3));
        policy.RetrySeconds = 3600;
        Assert.Equal(TimeSpan.FromHours(1), policy.RetryDelay(10));
    }
}
