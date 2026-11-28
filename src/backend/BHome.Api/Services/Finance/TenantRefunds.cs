using System.Text.Json.Serialization;

namespace BHome.Application.Finance;

[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record TenantRefundView(Guid Id, decimal Amount, string SourceKind, string Status,
    DateTimeOffset RequestedAt, DateTimeOffset? DecidedAt, DateTimeOffset? ExecutedAt, bool IsDevelopmentDemo);
