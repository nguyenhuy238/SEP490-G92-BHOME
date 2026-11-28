namespace BHome.Application.Notifications;

public sealed record DemoSmsView(Guid Id, Guid RecipientId, string MaskedPhone, string TemplateId, string Content,
    DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, string Mode = "Mock", string Status = "Simulated");
public interface IDemoSmsInbox
{
    Task<IReadOnlyList<DemoSmsView>> ListAsync(Guid? recipient, string? template, CancellationToken token);
}
