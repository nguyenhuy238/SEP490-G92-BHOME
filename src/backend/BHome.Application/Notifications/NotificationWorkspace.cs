using System.ComponentModel.DataAnnotations;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Notifications;

public sealed record NotificationAudience(string Type, Guid[]? LocationIds = null, Guid[]? RoomIds = null, Guid[]? UserIds = null);
public sealed record AnnouncementWrite([Required, StringLength(150)] string Title, [Required, StringLength(1000)] string Body,
    NotificationAudience Audience, string[] Channels, string Priority = "P2");
public sealed record AnnouncementView(Guid Id, string Title, string Body, NotificationAudience Audience, string[] Channels,
    string Priority, string Status, int RecipientCount, DateTimeOffset? SentAt);
public sealed record RecipientPreview(int RecipientCount, int MissingEmailCount);
public sealed record NotificationChannelStatus(string Channel, string Status, int AttemptCount, DateTimeOffset? NextRetryAt);
public sealed record NotificationChannelSummary(string Channel, string Status, int Count);
public sealed record NotificationChannelOverview(bool Enabled, bool AutomationEnabled, string Mode, IReadOnlyList<NotificationChannelSummary> Deliveries);
public sealed record PushDeviceWrite([Required, StringLength(4096, MinimumLength = 8)] string PushToken, string Platform);
public sealed record PushDeviceView(Guid Id, string Platform, bool IsActive, DateTimeOffset LastSeenAt);
public sealed record TenantRoomView(Guid Id, Guid LocationId, string LocationName, string RoomNumber, string Status, int Capacity);
// No implicit cadence or SLA: Owner must explicitly configure every enabled reminder.
public sealed record NotificationReminderPolicy(bool DebtEnabled = false, int? DebtWindowDays = null,
    bool TaskEnabled = false, int? TaskWindowHours = null, bool ResidenceEnabled = false, string? ResidenceFrequency = null,
    int? LocalSendHour = null, bool EmergencyEnabled = false, int? EmergencyFirstEscalationMinutes = null, int? EmergencyOverdueMinutes = null,
    int? InvoiceDueSoonDays = null);

public interface INotificationWorkspace
{
    Task<RecipientPreview> PreviewAsync(NotificationScope scope, NotificationAudience audience, CancellationToken t);
    Task<AnnouncementView> CreateAsync(NotificationScope scope, AnnouncementWrite input, CancellationToken t, Guid? key = null);
    Task<AnnouncementView> SendAsync(NotificationScope scope, Guid id, CancellationToken t);
    Task<IReadOnlyList<AnnouncementView>> SentAsync(NotificationScope scope, int page, int pageSize, CancellationToken t);
    Task<IReadOnlyList<AnnouncementView>> DraftsAsync(NotificationScope scope, int page, int pageSize, CancellationToken t);
    Task<PushDeviceView> RegisterDeviceAsync(Guid actor, PushDeviceWrite input, CancellationToken t);
    Task RemoveDeviceAsync(Guid actor, Guid id, CancellationToken t);
    Task<NotificationReminderPolicy> PolicyAsync(Guid location, CancellationToken t);
    Task<NotificationReminderPolicy> SavePolicyAsync(Guid actor, Guid location, NotificationReminderPolicy input, CancellationToken t);
    Task<IReadOnlyList<TenantRoomView>> RoomsAsync(Guid actor, DateOnly today, Guid? id, CancellationToken t);
    Task<IReadOnlyList<NotificationChannelStatus>> DeliveriesAsync(Guid actor, Guid id, CancellationToken t);
    Task<NotificationChannelOverview> ChannelOverviewAsync(CancellationToken t);
}

public sealed class NotificationWorkspaceService(INotificationWorkspace repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new NotificationException(401, "authentication_required");
    private NotificationScope Scope => new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Staff), user.IsInRole(Roles.Tenant), BillingAutomationDates.BusinessDate(clock.GetUtcNow()));
    private NotificationScope Sender() { var s = Scope; if (!s.Owner && !s.Staff) throw new NotificationException(403, "announcement_forbidden"); return s; }
    private Guid Owner() { var id = Actor; if (!user.IsInRole(Roles.Owner)) throw new NotificationException(403, "notification_owner_required"); return id; }
    public Task<RecipientPreview> PreviewAsync(NotificationAudience input, CancellationToken t) => repository.PreviewAsync(Sender(), input, t);
    public Task<AnnouncementView> CreateAsync(AnnouncementWrite input, CancellationToken t, Guid? key = null)
    {
        var scope = Sender();
        if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Length > 150 || string.IsNullOrWhiteSpace(input.Body) || input.Body.Length > 1000 ||
            input.Priority is not ("P1" or "P2") || input.Channels is null || input.Channels.Length is < 1 or > 3 ||
            !input.Channels.Contains("IN_APP") || input.Channels.Any(c => c is not ("IN_APP" or "EMAIL" or "PUSH"))) throw new NotificationException(400, "invalid_announcement");
        if (key == Guid.Empty) throw new NotificationException(400, "invalid_idempotency_key");
        return repository.CreateAsync(scope, input with { Title = input.Title.Trim(), Body = input.Body.Trim(), Channels = input.Channels.Distinct().ToArray() }, t, key);
    }
    public Task<AnnouncementView> SendAsync(Guid id, CancellationToken t) => repository.SendAsync(Sender(), id, t);
    public Task<IReadOnlyList<AnnouncementView>> SentAsync(int page, int size, CancellationToken t)
    {
        var scope = Sender(); if (page < 1 || size is < 1 or > 100 || page > int.MaxValue / size) throw new NotificationException(400, "invalid_page");
        return repository.SentAsync(scope, page, size, t);
    }
    public Task<IReadOnlyList<AnnouncementView>> DraftsAsync(int page, int size, CancellationToken t)
    {
        Owner(); var scope = Scope; if (page < 1 || size is < 1 or > 100 || page > int.MaxValue / size) throw new NotificationException(400, "invalid_page");
        return repository.DraftsAsync(scope, page, size, t);
    }
    public Task<PushDeviceView> RegisterDeviceAsync(PushDeviceWrite input, CancellationToken t)
    {
        var actor = Actor;
        if (string.IsNullOrWhiteSpace(input.PushToken) || input.PushToken.Length is < 8 or > 4096 || input.Platform is not ("Android" or "iOS" or "Web")) throw new NotificationException(400, "invalid_push_device");
        return repository.RegisterDeviceAsync(actor, input, t);
    }
    public Task RemoveDeviceAsync(Guid id, CancellationToken t) => repository.RemoveDeviceAsync(Actor, id, t);
    public Task<IReadOnlyList<NotificationChannelStatus>> DeliveriesAsync(Guid id, CancellationToken t) => repository.DeliveriesAsync(Actor, id, t);
    public Task<NotificationChannelOverview> ChannelOverviewAsync(CancellationToken t) { Owner(); return repository.ChannelOverviewAsync(t); }
    public Task<NotificationReminderPolicy> PolicyAsync(Guid location, CancellationToken t) { Owner(); return repository.PolicyAsync(location, t); }
    public Task<NotificationReminderPolicy> SavePolicyAsync(Guid location, NotificationReminderPolicy input, CancellationToken t)
    {
        var actor = Owner();
        if (input.InvoiceDueSoonDays is not (null or >= 1 and <= 30) || input.DebtEnabled && input.DebtWindowDays is not (>= 1 and <= 365) || input.TaskEnabled && input.TaskWindowHours is not (>= 1 and <= 8760) ||
            input.ResidenceEnabled && (input.ResidenceFrequency is not ("WEEKLY" or "MONTHLY") || input.LocalSendHour is not (>= 0 and <= 23)) ||
            input.EmergencyEnabled && (input.EmergencyFirstEscalationMinutes is not (>= 1 and <= 10080) || input.EmergencyOverdueMinutes <= input.EmergencyFirstEscalationMinutes || input.EmergencyOverdueMinutes is not (>= 2 and <= 20160)))
            throw new NotificationException(400, "invalid_reminder_policy");
        return repository.SavePolicyAsync(actor, location, input, t);
    }
    public Task<IReadOnlyList<TenantRoomView>> RoomsAsync(Guid? id, CancellationToken t)
    {
        var s = Scope; if (!s.Tenant) throw new NotificationException(403, "tenant_required");
        return repository.RoomsAsync(s.Actor, s.Today, id, t);
    }
}
