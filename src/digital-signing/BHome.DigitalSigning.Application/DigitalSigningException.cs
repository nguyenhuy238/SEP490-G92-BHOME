namespace BHome.DigitalSigning.Application;

public enum DigitalSigningError
{
    Invalid,
    Unauthenticated,
    Forbidden,
    NotFound,
    Conflict,
    ProviderUnavailable
}

// An expected outcome of a signing use case. The message is Vietnamese and safe to show the user.
public sealed class DigitalSigningException(DigitalSigningError error, string message) : Exception(message)
{
    public DigitalSigningError Error { get; } = error;

    public static DigitalSigningException Invalid(string message) => new(DigitalSigningError.Invalid, message);
    public static DigitalSigningException Forbidden(string message) => new(DigitalSigningError.Forbidden, message);
    public static DigitalSigningException NotFound(string what) => new(DigitalSigningError.NotFound, $"Không tìm thấy {what}.");
    public static DigitalSigningException Conflict(string message) => new(DigitalSigningError.Conflict, message);
    public static DigitalSigningException ProviderUnavailable(string message) => new(DigitalSigningError.ProviderUnavailable, message);
}

// A failure talking to the remote CA. Its message may carry the CA's own error text: log it, do not return it.
public sealed class SigningProviderException : Exception
{
    public SigningProviderException(string message) : base(message) { }
    public SigningProviderException(string message, Exception inner) : base(message, inner) { }
}

// The signature the CA returned does not match the certificate and the prepared document.
public sealed class InvalidSignatureException(string message) : Exception(message);
