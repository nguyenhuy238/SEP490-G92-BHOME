using System.ComponentModel.DataAnnotations;

namespace BHome.Application.IdentityAccess;

public static class LoginIdentifier
{
    public const int MaxPhoneLength = 30;

    public static bool IsEmail(string value) => !value.Any(char.IsWhiteSpace) && new EmailAddressAttribute().IsValid(value);

    public static string? NormalizePhone(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxPhoneLength) return null;
        var compact = new string(value.Trim().Where(c => c is not (' ' or '-' or '.' or '(' or ')')).ToArray());
        if (compact.Length is < 8 or > 16 || compact[0] == '+' && compact.Length < 9) return null;
        var digits = compact[0] == '+' ? compact.AsSpan(1) : compact.AsSpan();
        if (digits.Length is < 8 or > 15 || digits.IndexOfAnyExceptInRange('0', '9') >= 0) return null;
        return compact.StartsWith('0') && compact.Length is 10 or 11 ? "+84" + compact[1..] : compact;
    }
}
