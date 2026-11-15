using BHome.Application.Notifications;
using BHome.LocalDevelopment;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests.Notifications;

public sealed class SmsConfigurationTests
{
    private static Dictionary<string, string?> Ready() => new()
    {
        ["Sms:Enabled"] = "true",
        ["Sms:Mode"] = "Production",
        ["Sms:ProductionEnabled"] = "true",
        ["Sms:ApiKey"] = "synthetic-api",
        ["Sms:SecretKey"] = "synthetic-secret",
        ["Sms:Brandname"] = "BHOME",
        ["Sms:EnabledTemplates:0"] = "SMS-01",
        ["Sms:ApprovedTemplates:0"] = "SMS-01",
        ["SmsRecovery:Enabled"] = "true",
        ["SmsRecovery:HashKey"] = Convert.ToBase64String(new byte[32]),
        ["Jobs:Enabled"] = "true"
    };

    [Fact]
    public void ConfiguredOtpAndWorkerPassLocalReadinessChecks()
    {
        var checks = SmsProviderProbe.RecoveryConfigurationChecks(new ConfigurationBuilder().AddInMemoryCollection(Ready()).Build());
        Assert.All(checks, check => Assert.True(check.Value, check.Key));
    }

    [Theory]
    [InlineData("Sms:Enabled", "false", "Sms:Enabled")]
    [InlineData("Sms:Mode", "Sandbox", "Sms:Mode=Production")]
    [InlineData("Sms:Mode", "Mock", "Sms:Mode=Production")]
    [InlineData("Sms:ProductionEnabled", "false", "Sms:ProductionEnabled")]
    [InlineData("Sms:ApiKey", "", "Sms:ApiKey")]
    [InlineData("Sms:SecretKey", "", "Sms:SecretKey")]
    [InlineData("Sms:Brandname", "", "Sms:Brandname")]
    [InlineData("Sms:EnabledTemplates:0", "SMS-03", "Sms:EnabledTemplates includes SMS-01")]
    [InlineData("Sms:ApprovedTemplates:0", "SMS-03", "Sms:ApprovedTemplates includes SMS-01")]
    [InlineData("Sms:BaseUrl", "http://example.invalid", "Sms configuration validation")]
    [InlineData("SmsRecovery:Enabled", "false", "SmsRecovery:Enabled")]
    [InlineData("SmsRecovery:HashKey", "invalid", "SmsRecovery key and limits validation")]
    [InlineData("SmsRecovery:HashKey", "YQ==", "SmsRecovery key and limits validation")]
    [InlineData("SmsRecovery:OtpMinutes", "11", "SmsRecovery key and limits validation")]
    [InlineData("Jobs:Enabled", "false", "Jobs:Enabled")]
    public void MissingConfigurationIdentifiesTheSettingWithoutExposingItsValue(string key, string value, string failedCheck)
    {
        var values = Ready();
        values[key] = value;
        var checks = SmsProviderProbe.RecoveryConfigurationChecks(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
        Assert.False(checks[failedCheck]);
        Assert.DoesNotContain("synthetic-api", string.Join(",", checks.Keys));
        Assert.DoesNotContain("synthetic-secret", string.Join(",", checks.Keys));
    }

    [Fact]
    public void EmptyConfigurationFailsLocalReadinessChecks()
    {
        var checks = SmsProviderProbe.RecoveryConfigurationChecks(new ConfigurationBuilder().Build());
        Assert.False(checks["Sms:Enabled"]);
        Assert.False(checks["SmsRecovery:Enabled"]);
        Assert.False(checks["Jobs:Enabled"]);
    }

    [Fact]
    public void OtpProbeUsesTheRecoveryTemplateAndUniqueSubmissionKeys()
    {
        var first = SmsProviderProbe.CreateMessage("84900000001", otp: true);
        var second = SmsProviderProbe.CreateMessage("84900000001", otp: true);
        Assert.Equal("SMS-01", first.TemplateId);
        Assert.Matches("^[0-9]{6}$", first.Variables["OTP"]);
        Assert.Equal("5", first.Variables["MINUTES"]);
        Assert.Contains(first.Variables["OTP"], SmsTemplates.Render(first.TemplateId, first.Variables));
        Assert.NotEqual(first.IdempotencyKey, second.IdempotencyKey);
        Assert.DoesNotContain(first.Variables["OTP"], first.ToString());
    }

    [Fact]
    public void ExistingProbeKeepsTheInvoiceTemplate()
    {
        var message = SmsProviderProbe.CreateMessage("84900000001", otp: false);
        Assert.Equal("SMS-03", message.TemplateId);
        Assert.Equal("BHOME-TEST", message.Variables["ROOM"]);
        Assert.Contains("BHOME-TEST", SmsTemplates.Render(message.TemplateId, message.Variables));
    }
}
