namespace BHome.Application.Common;

/// <summary>Safe field messages only; never include rejected values in this exception.</summary>
public sealed class InputValidationException(IReadOnlyDictionary<string, string[]> errors) : Exception("validation_error")
{
    public IReadOnlyDictionary<string, string[]> Errors { get; } = errors;
}
