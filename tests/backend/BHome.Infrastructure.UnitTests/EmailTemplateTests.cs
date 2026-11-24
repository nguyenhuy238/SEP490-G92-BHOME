using System.Net;
using System.Text.RegularExpressions;
using BHome.Application.Notifications;
using BHome.Infrastructure.Branding;
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
        Assert.Contains(">BHome</p>", html);
        Assert.Contains("BHome — Hệ thống quản lý và vận hành nhà trọ.", mime.TextBody);
        Assert.Single(Regex.Matches(html, "<img", RegexOptions.IgnoreCase));
        Assert.Contains("src=\"cid:" + EmailTemplate.BrandContentId + "\"", html);
        using var wire = new MemoryStream();
        mime.WriteTo(wire);
        wire.Position = 0;
        using var decoded = MimeMessage.Load(wire);
        var alternatives = Assert.IsType<MultipartAlternative>(decoded.Body);
        var related = Assert.Single(alternatives.OfType<MultipartRelated>());
        Assert.True(related.ContentType.IsMimeType("multipart", "related"));
        var logo = Assert.Single(decoded.BodyParts.OfType<MimePart>(), part => part.ContentType.IsMimeType("image", "png"));
        Assert.Equal(EmailTemplate.BrandContentId, logo.ContentId);
        Assert.Equal(ContentDisposition.Inline, Assert.IsType<ContentDisposition>(logo.ContentDisposition).Disposition);
        Assert.False(logo.IsAttachment);
        using var png = new MemoryStream();
        Assert.NotNull(logo.Content);
        logo.Content.DecodeTo(png);
        Assert.Equal(BrandAssets.MarkPng, png.ToArray());
        Assert.Empty(decoded.Attachments);
        Assert.Contains("cid:" + logo.ContentId, decoded.HtmlBody);
    }

    [Fact]
    public void InlineBrandPreservesBothExistingPdfAttachmentsExactly()
    {
        var signed = "%PDF-synthetic signed document"u8.ToArray();
        var receipt = "%PDF-synthetic payment receipt"u8.ToArray();
        var message = Invitation with
        {
            Attachments = [new("signed.pdf", "application/pdf", signed), new("receipt.pdf", "application/pdf", receipt)]
        };
        using var mime = new MimeMessage { Body = MailKitEmailSender.BuildBody(message) };
        using var wire = new MemoryStream();
        mime.WriteTo(wire);
        wire.Position = 0;
        using var decoded = MimeMessage.Load(wire);
        var attachments = decoded.Attachments.OfType<MimePart>().ToArray();
        Assert.Equal(2, attachments.Length);
        foreach (var (name, expected) in new[] { ("signed.pdf", signed), ("receipt.pdf", receipt) })
        {
            var attachment = Assert.Single(attachments, part => part.FileName == name);
            Assert.True(attachment.ContentType.IsMimeType("application", "pdf"));
            using var bytes = new MemoryStream();
            attachment.Content!.DecodeTo(bytes);
            Assert.Equal(expected, bytes.ToArray());
        }
        var logo = Assert.Single(decoded.BodyParts.OfType<MimePart>(), part => part.ContentId == EmailTemplate.BrandContentId);
        Assert.False(logo.IsAttachment);
    }

    [Fact]
    public void MissingBrandResourceKeepsReadableEmailAndExactActionsWithoutBrokenImage()
    {
        Assert.Null(BrandAssets.ReadMark(() => null));
        Assert.Null(BrandAssets.ReadMark(() => new MemoryStream("invalid"u8.ToArray())));
        using var mime = new MimeMessage { Body = MailKitEmailSender.BuildBody(Invitation, null) };
        Assert.DoesNotContain("<img", mime.HtmlBody, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(">BHome</p>", mime.HtmlBody);
        Assert.Contains(Invitation.ActionUrl!, mime.TextBody);
        Assert.Contains(Invitation.MobileActionUrl!, mime.TextBody);
        Assert.Empty(mime.Attachments);
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
        Assert.Single(Regex.Matches(Assert.IsType<string>(mime.HtmlBody), "<img", RegexOptions.IgnoreCase));
        Assert.Contains("src=\"cid:" + EmailTemplate.BrandContentId + "\"", mime.HtmlBody);
        Assert.DoesNotContain("<img src=x>", mime.HtmlBody);
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
