using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class DevelopmentEmailTest(IHostEnvironment environment, ICurrentUser user, IOptions<EmailOptions> options,
    INotificationChannelProvider provider, MailKitEmailSender sender) : IDevelopmentEmailTest
{
    public async Task<EmailTestResult> SendAsync(CancellationToken t)
    {
        if (!environment.IsDevelopment() || !options.Value.TestEnabled) throw new NotificationException(404, "email_test_disabled");
        if (user.UserId is null) throw new NotificationException(401, "authentication_required");
        if (!user.IsInRole("Owner")) throw new NotificationException(403, "email_test_forbidden");
        if (!sender.IsConfigured || !EmailOptions.ValidAddress(options.Value.TestRecipient)) throw new NotificationException(503, "email_test_configuration_invalid");
        try
        {
            var receipt = await provider.SendAsync(new("development-email-test/" + Guid.NewGuid().ToString("N"), "EMAIL", options.Value.TestRecipient,
                "DEVELOPMENT_SMTP_TEST", "Kiểm tra kết nối Gmail SMTP", "Đây là email kiểm tra tích hợp Gmail SMTP của BHOME trong môi trường Development.\nEmail không chứa dữ liệu Tenant hoặc thông tin nghiệp vụ."), t);
            return new("SmtpAccepted", receipt, false);
        }
        catch (ChannelDeliveryException e) { throw new NotificationException(503, e.Code); }
    }
}
