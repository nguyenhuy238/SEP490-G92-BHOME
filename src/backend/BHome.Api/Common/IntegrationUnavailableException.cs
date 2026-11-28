namespace BHome.Application.Common;

public sealed class IntegrationUnavailableException(string capability)
    : Exception($"The {capability} capability is not configured.");
