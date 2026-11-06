using System.ComponentModel.DataAnnotations;

namespace BHome.Application.IdentityAccess;

public static class LoginIdentifier
{
    public const int MaxPhoneLength = 30;

    public static bool IsEmail(string value) => new EmailAddressAttribute().IsValid(value);

    public static string? NormalizePhone(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxPhoneLength) return null;
        var compact = new string(value.Trim().Where(c => c is not (' ' or '-' or '.' or '(' or ')')).ToArray());
        if (compact.Length is < 8 or > 16 || compact[0] == '+' && compact.Length < 9) return null;
        var digits = compact[0] == '+' ? compact.AsSpan(1) : compact.AsSpan();
        return digits.Length is >= 8 and <= 15 && digits.IndexOfAnyExceptInRange('0', '9') < 0 ? compact : null;
    }
}
