using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Application.PropertyManagement;

// JavaScript clients must not round fractional decimals or integers beyond their
// exact range. Keep ordinary integer identifiers/counts as numbers for compatibility.
public sealed class ExactSetupDataConverter : JsonConverter<JsonElement>
{
    private const long MaximumExactJavaScriptInteger = 9_007_199_254_740_991;
    public override JsonElement Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        return document.RootElement.Clone();
    }
    public override void Write(Utf8JsonWriter writer, JsonElement value, JsonSerializerOptions options)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject()) { writer.WritePropertyName(property.Name); Write(writer, property.Value, options); }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray(); foreach (var item in value.EnumerateArray()) Write(writer, item, options); writer.WriteEndArray();
        }
        else if (value.ValueKind == JsonValueKind.Number &&
            (!value.TryGetInt64(out var integer) || integer < -MaximumExactJavaScriptInteger || integer > MaximumExactJavaScriptInteger))
            writer.WriteStringValue(value.GetRawText());
        else value.WriteTo(writer);
    }
}
