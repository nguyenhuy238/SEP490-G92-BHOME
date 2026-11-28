namespace BHome.Infrastructure.Persistence.Compact24;

public sealed class Compact24MigrationException(string code) : InvalidOperationException("Compact fixture migration rejected.")
{ public string Code { get; } = code; }
