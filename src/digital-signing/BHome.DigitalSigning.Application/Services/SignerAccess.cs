using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.DigitalSigning.Application.Services;

internal static class SignerAccess
{
    // Every fixed role may hold and use its own certificate; a certificate signs only for the user who declared it.
    public static Guid RequireSigner(ICurrentUser user)
    {
        if (user.UserId is not { } id || id == Guid.Empty)
            throw new DigitalSigningException(DigitalSigningError.Unauthenticated, "Bạn cần đăng nhập.");
        if (!Roles.All.Any(user.IsInRole))
            throw DigitalSigningException.Forbidden("Vai trò của bạn không được ký số.");
        return id;
    }

    public static string Tail(string? value) => value is null || value.Length <= 4 ? "" : value[^4..];
}
