namespace BHome.Application.Integrations;

// Template parameters must exclude sensitive identity and unnecessary financial data.
public sealed record NotificationDelivery(string IdempotencyKey, string RecipientReference,
    string Template, IReadOnlyDictionary<string, string> Parameters);

public interface INotificationProvider
{
    Task<string> DeliverAsync(NotificationDelivery delivery, CancellationToken cancellationToken);
}
