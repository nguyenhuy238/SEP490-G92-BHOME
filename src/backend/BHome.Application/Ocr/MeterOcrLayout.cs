using System.Text.RegularExpressions;

namespace BHome.Application.Ocr;

// Shared geometry/unit rules for parsing and local image refinement, not billing policy.
public static class MeterOcrLayout
{
    public const string UnitPattern = @"(?:k\s*w\s*h|m\s*(?:\^\s*)?[3³]|㎥)";
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);
    private const string NonBillingUnitPattern = @"(?:(?:m\s*(?:\^\s*)?[3³]|㎥|l)\s*/\s*(?:s|min|h)|/\s*(?:s|min|h)|(?:m\s*[3³]|l)\s*(?:s|min|h)\s*[-−]\s*1|v|a|hz|w|kw|kva|kvarh?|kva\s*h|°\s*c|ppm|gal(?:lon)?s?|lit(?:er|re)s?)";

    public static bool IsUnit(string text) => Match(text, $@"^{UnitPattern}$");
    // A separate OCR box can contain a rate/electrical parameter rather than
    // the accumulated quantity. Never silently drop that unit and accept digits.
    public static bool IsNonBillingUnit(string text) => Match(text, $@"^{NonBillingUnitPattern}$");
    public static bool IsNonBillingQuantity(string text) => Match(text,
        $@"^(?:(?:total|reading|index|chi\s+so)\s*:?\s*)?(?:[0-9]+(?:[.,][0-9]+)?\s*{NonBillingUnitPattern}|{NonBillingUnitPattern}\s*:?\s*[0-9]+(?:[.,][0-9]+)?)$");
    public static bool IsCorrectUnit(string text, OcrDocumentKind kind) => kind switch
    {
        OcrDocumentKind.MechanicalElectricity or OcrDocumentKind.DigitalElectricity => Match(text, @"^k\s*w\s*h$"),
        OcrDocumentKind.MechanicalWater or OcrDocumentKind.DigitalWater => Match(text, @"^(?:m\s*(?:\^\s*)?[3³]|㎥)$"),
        _ => false
    };

    public static bool Nearby(OcrBounds quantity, OcrBounds unit)
    {
        var height = Math.Max(quantity.Height, unit.Height);
        var sameRow = Math.Abs(quantity.Y + quantity.Height / 2 - unit.Y - unit.Height / 2) <= height * .6f &&
            unit.X >= quantity.X + quantity.Width * .7f && unit.X - quantity.X - quantity.Width <= height * 4;
        if (sameRow) return true;
        var horizontalOverlap = Math.Min(quantity.X + quantity.Width, unit.X + unit.Width) - Math.Max(quantity.X, unit.X);
        if (horizontalOverlap < Math.Min(quantity.Width, unit.Width) * .5f) return false;
        var below = unit.Y >= quantity.Y + quantity.Height * .8f && unit.Y - quantity.Y - quantity.Height <= height;
        var above = quantity.Y >= unit.Y + unit.Height * .8f && quantity.Y - unit.Y - unit.Height <= height;
        return below || above;
    }

    private static bool Match(string text, string pattern) => Regex.IsMatch(text.Trim(), pattern,
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
}
