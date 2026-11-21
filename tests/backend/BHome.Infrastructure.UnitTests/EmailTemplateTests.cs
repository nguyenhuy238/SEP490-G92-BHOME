using System.Net;
using System.Text.RegularExpressions;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using MimeKit;

namespace BHome.Infrastructure.UnitTests;

public sealed class EmailTemplateTests
{
    private static ChannelMessage Invitation => new("synthetic-email", "EMAIL", "demo@example.invalid", "ACCOUNT_INVITATION",
        "Thiết lập tài khoản BHOME", "Xin chào bạn,\n\nHãy thiết lập mật khẩu trước khi đăng nhập.",
        "https://owner-staging.103.146.23.157.sslip.io/accept-invitation#userName=demo&token=SYNTHETIC_TOKEN",
        MobileActionUrl: "bhome://accept-invitation?userName=demo&token=SYNTHETIC_TOKEN");

    [Fact]
    public void InvitationMimeKeepsExactWebAndNativeActionsWithoutDisplayingTheirCredentials()
    {
        var message = Invitation;
        using var mime = new MimeMessage { Body = MailKitEmailSender.BuildBody(message) };
        var html = Assert.IsType<string>(mime.HtmlBody);
        var visible = WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]*>", ""));
        Assert.Contains("Thiết lập tài khoản", visible);
        Assert.Contains("liên kết dự phòng", visible);
        Assert.Contains("Mở trong ứng dụng", visible);
        Assert.DoesNotContain("SYNTHETIC_TOKEN", visible);
        Assert.DoesNotContain("bhome://", visible);
        Assert.Contains("href=\"" + WebUtility.HtmlEncode(message.ActionUrl) + "\"", html);
        Assert.Contains("href=\"" + WebUtility.HtmlEncode(message.MobileActionUrl) + "\"", html);
        Assert.Contains(message.ActionUrl!, mime.TextBody);
        Assert.Contains(message.MobileActionUrl!, mime.TextBody);
        Assert.True(visible.IndexOf("Xin chào", StringComparison.Ordinal) < visible.IndexOf("liên kết dự phòng", StringComparison.Ordinal));
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<link", html, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max-width:580px", html);
    }

    [Fact]
    public void CredentialMimeEncodesEveryVariableAndContainsOnePasswordAndCorrectInstructions()
    {
        var message = Invitation with
        {
            EventType = "STAFF_PASSWORD_ISSUED",
            Title = "Tài khoản <BHOME>",
            Body = "Xin chào <img src=x>,\n\nMật khẩu vừa được cấp.",
            ActionUrl = null,
            MobileActionUrl = null,
            Credentials = new("staff&demo@example.invalid", "Demo<&>Only!2")
        };
        using var mime = new MimeMessage { Body = MailKitEmailSender.BuildBody(message) };
        Assert.Contains("&lt;BHOME&gt;", mime.HtmlBody);
        Assert.Contains("&lt;img src=x&gt;", mime.HtmlBody);
        Assert.DoesNotContain("<img", mime.HtmlBody);
        Assert.Contains("Demo&lt;&amp;&gt;Only!2", mime.HtmlBody);
        Assert.Contains("staff&amp;demo@example.invalid", mime.HtmlBody);
        Assert.Single(Regex.Matches(Assert.IsType<string>(mime.TextBody), Regex.Escape(message.Credentials.Password)));
        Assert.Contains("Nhân viên vận hành", mime.TextBody);
        Assert.Contains("Hồ sơ cá nhân", mime.TextBody);
        Assert.DoesNotContain("href=", mime.HtmlBody);
        Assert.DoesNotContain(message.Credentials.Password, message.ToString());
        Assert.Equal("BHOME | Thông tin tài khoản nhân viên", EmailTemplate.Subject(message.Title, message.EventType));
    }

    [Theory]
    [InlineData("", "Nội dung")]
    [InlineData("Tiêu đề", "")]
    [InlineData(" ", "Nội dung")]
    public void MissingRequiredContentFailsWithOnlyASafeCode(string title, string body)
    {
        var error = Assert.Throws<ChannelDeliveryException>(() => MailKitEmailSender.BuildBody(Invitation with { Title = title, Body = body }));
        Assert.Equal("email_template_variables_missing", error.Code);
        Assert.DoesNotContain("SYNTHETIC_TOKEN", error.ToString());
    }

    [Fact]
    public void AlreadyBrandedSubjectsAreNotPrefixedTwiceAndHeadersRemainSingleLine()
    {
        Assert.Equal("BHOME — Lời mời ký hợp đồng", EmailTemplate.Subject("BHOME — Lời mời ký hợp đồng"));
        Assert.Equal("BHOME  injected", EmailTemplate.Subject("BHOME\r\ninjected"));
        Assert.Equal("[BHOME] Hóa đơn", EmailTemplate.Subject("Hóa đơn"));
    }

    [Fact]
    public void MissingCredentialDoesNotSendAnIncompleteAccountEmail()
    {
        Assert.Throws<ChannelDeliveryException>(() => MailKitEmailSender.BuildBody(Invitation with { Credentials = new("staff@example.invalid", "") }));
        Assert.Throws<ChannelDeliveryException>(() => MailKitEmailSender.BuildBody(Invitation with { Credentials = new("", "SYNTHETIC_ONLY") }));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,unsafe")]
    [InlineData("//foreign.example.invalid")]
    [InlineData("http://foreign.example.invalid")]
    [InlineData("https://user:secret@example.invalid/path")]
    [InlineData("bhome://unknown-path")]
    public void UnsafeActionSchemesAndCredentialUrlsFailBeforeSmtp(string url)
    {
        var error = Assert.Throws<ChannelDeliveryException>(() => MailKitEmailSender.BuildBody(Invitation with { ActionUrl = url }));
        Assert.Equal("email_action_url_invalid", error.Code);
        Assert.DoesNotContain(url, error.ToString());
    }

    [Theory]
    [InlineData("https://owner-staging.103.146.23.157.sslip.io/accept-invitation")]
    [InlineData("https://owner.103.146.23.157.sslip.io/reset-password")]
    [InlineData("http://localhost:5173/confirm-email")]
    public void RenderingDoesNotRewriteConfiguredEnvironment(string callback)
    {
        var url = callback + "#token=SYNTHETIC_ONLY";
        using var mime = new MimeMessage { Body = MailKitEmailSender.BuildBody(Invitation with { ActionUrl = url }) };
        Assert.Contains("href=\"" + WebUtility.HtmlEncode(url) + "\"", mime.HtmlBody);
        Assert.Contains(url, mime.TextBody);
    }
}
