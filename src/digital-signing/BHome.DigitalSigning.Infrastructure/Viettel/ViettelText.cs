using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace BHome.DigitalSigning.Infrastructure.Viettel;

internal static partial class ViettelText
{
    // Viettel allows fewer than 100 characters in what the signer reads on the phone.
    private const int MaxDescription = 99;

    // Viettel accepts only a-z, A-Z, 0-9, underscore, hyphen and space: Vietnamese diacritics are dropped (đ becomes d)
    // and anything else becomes a space.
    public static string Plain(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var decomposed = value.Replace('đ', 'd').Replace('Đ', 'D').Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark) builder.Append(character);
        }
        var cleaned = Spaces().Replace(Disallowed().Replace(builder.ToString(), " "), " ").Trim();
        return cleaned.Length <= MaxDescription ? cleaned : cleaned[..MaxDescription].Trim();
    }

    public static string Base64(string value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(value));

    public static string Tail(string? value) => value is null || value.Length <= 4 ? "" : value[^4..];

    public static bool SameSerial(string left, string right) => NormalizeSerial(left) == NormalizeSerial(right);

    private static string NormalizeSerial(string serial)
    {
        var lower = serial.ToLowerInvariant().Replace(":", "").Replace(" ", "");
        var trimmed = lower.TrimStart('0');
        return trimmed.Length == 0 ? "0" : trimmed;
    }

    [GeneratedRegex("[^A-Za-z0-9_\\- ]")]
    private static partial Regex Disallowed();

    [GeneratedRegex(" {2,}")]
    private static partial Regex Spaces();
}
