using BHome.Application.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

public sealed record DemoSmsView(Guid Id, Guid RecipientId, string MaskedPhone, string TemplateId, string Content,
    DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, string Mode = "Mock", string Status = "Simulated");

// Deliberately ephemeral, bounded, and isolated from the durable notification/audit store.
// Deduplication metadata survives content expiry, without retaining OTPs or phone numbers.
internal sealed class DemoSmsInbox(IOptions<SmsOptions> options, IHostEnvironment environment, TimeProvider clock)
{
    private readonly object gate = new();
    private readonly Dictionary<string, (DateTimeOffset Until, Guid Id)> keys = [];
    private readonly List<DemoSmsView> messages = [];
    internal bool Available => options.Value.MockAllowed(environment.EnvironmentName);
    internal SmsReceipt Add(SmsMessage message, string content)
    {
        if (!Available || !options.Value.DemoAccounts.TryGetValue(message.RecipientId, out var configured) ||
            VietnameseSmsPhone.Normalize(configured) != message.Phone) throw new ChannelDeliveryException("sms_demo_recipient_required");
        lock (gate)
        {
            Prune();
            var key = SmsGateway.RequestId(message.IdempotencyKey);
            if (keys.TryGetValue(key, out var existing)) return new("Simulated", "mock:" + existing.Id.ToString("N"));
            if (keys.Count >= 5000) throw new ChannelDeliveryException("sms_demo_capacity");
            var now = clock.GetUtcNow(); var id = Guid.NewGuid();
            var expires = message.ExpiresAt ?? now.AddMinutes(15);
            if (expires <= now) throw new ChannelDeliveryException("sms_expired");
            expires = expires < now.AddMinutes(15) ? expires : now.AddMinutes(15);
            messages.Add(new(id, message.RecipientId, VietnameseSmsPhone.Mask(message.Phone), message.TemplateId, content, now, expires));
            if (messages.Count > 500) messages.RemoveAt(0);
            keys.Add(key, (now.AddHours(24), id));
            return new("Simulated", "mock:" + id.ToString("N"));
        }
    }
    internal IReadOnlyList<DemoSmsView> List(Guid? recipient = null, string? template = null)
    {
        if (!Available) return [];
        lock (gate)
        {
            Prune(); return messages.Where(m => (recipient is null || m.RecipientId == recipient) &&
            (template is null || m.TemplateId == template)).OrderByDescending(m => m.CreatedAt).ToArray();
        }
    }
    private void Prune()
    {
        var now = clock.GetUtcNow(); messages.RemoveAll(m => m.ExpiresAt <= now);
        foreach (var key in keys.Where(k => k.Value.Until <= now).Select(k => k.Key).ToArray()) keys.Remove(key);
    }
}

internal sealed class MockSmsSender(DemoSmsInbox inbox, Compact24DbContext db)
{
    internal async Task<SmsReceipt> SendAsync(SmsMessage message, string content, CancellationToken token)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == message.RecipientId && u.IsActive, token);
        if (user?.Email?.EndsWith("@sms-demo.example.invalid", StringComparison.OrdinalIgnoreCase) != true ||
            user.UserName?.EndsWith(".sms-demo", StringComparison.Ordinal) != true ||
            VietnameseSmsPhone.Normalize(user.PhoneNumber) != message.Phone)
            throw new ChannelDeliveryException("sms_demo_recipient_required");
        return inbox.Add(message, content);
    }
}
