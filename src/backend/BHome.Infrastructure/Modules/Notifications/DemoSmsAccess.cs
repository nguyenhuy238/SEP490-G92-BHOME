using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class DemoSmsAccess(DemoSmsInbox inbox, ICurrentUser actor, Compact24DbContext db, IOptions<SmsOptions> options) : IDemoSmsInbox
{
    public async Task<IReadOnlyList<DemoSmsView>> ListAsync(Guid? recipient, string? template, CancellationToken token)
    {
        if (!inbox.Available || actor.UserId is not { } id || !options.Value.DemoAccounts.ContainsKey(id.ToString()))
            throw new NotificationException(404, "sms_demo_unavailable");
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == id && u.IsActive, token);
        if (user?.Email?.EndsWith("@sms-demo.example.invalid", StringComparison.OrdinalIgnoreCase) != true ||
            user.UserName?.EndsWith(".sms-demo", StringComparison.Ordinal) != true) throw new NotificationException(404, "sms_demo_unavailable");
        if (template is not null && !SmsTemplates.Contains(template)) throw new NotificationException(400, "sms_template_unknown");
        if (!actor.IsInRole("Owner"))
        {
            if (recipient is not null && recipient != id) throw new NotificationException(404, "sms_demo_unavailable");
            recipient = id;
        }
        if (recipient is { } target && !options.Value.DemoAccounts.ContainsKey(target.ToString())) throw new NotificationException(404, "sms_demo_unavailable");
        return inbox.List(recipient, template).Where(m => options.Value.DemoAccounts.ContainsKey(m.RecipientId.ToString())).Take(100).ToArray();
    }
}

internal sealed class DemoSmsCleanup(DemoSmsInbox inbox) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!inbox.Available) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try { while (await timer.WaitForNextTickAsync(stoppingToken)) inbox.Expire(); }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
