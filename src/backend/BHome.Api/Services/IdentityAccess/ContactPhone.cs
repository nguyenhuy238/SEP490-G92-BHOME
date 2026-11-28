using System.Text.RegularExpressions;

namespace BHome.Application.IdentityAccess;

// New contact writes use a canonical number; login aliases remain backward compatible.
public static class ContactPhone
{
    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 30) return null;
        var compact = new string(value.Trim().Where(c => c is not (' ' or '-' or '.' or '(' or ')')).ToArray());
        if (Regex.IsMatch(compact, @"\A0(?:[35789][0-9]{8}|2[0-9]{9})\z")) return "+84" + compact[1..];
        if (compact.StartsWith("+84", StringComparison.Ordinal))
            return Regex.IsMatch(compact, @"\A\+84(?:[35789][0-9]{8}|2[0-9]{9})\z") ? compact : null;
        return Regex.IsMatch(compact, @"\A\+[1-9][0-9]{7,14}\z") ? compact : null;
    }
}
