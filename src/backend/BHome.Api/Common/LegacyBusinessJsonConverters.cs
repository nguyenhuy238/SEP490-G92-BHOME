using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.Common;

// Physical fields retain database nullability and storage types. The existing
// business JSON continues to expose the former non-nullable/typed accessor values.
internal sealed class LegacyDecimalJsonConverter : JsonConverter<decimal?>
{
    public override bool HandleNull => true;
    public override decimal? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        JsonSerializer.Deserialize<decimal>(ref reader, options);
    public override void Write(Utf8JsonWriter writer, decimal? value, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, value.GetValueOrDefault(), options);
}

internal sealed class LegacyGuidJsonConverter : JsonConverter<Guid?>
{
    public override bool HandleNull => true;
    public override Guid? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        JsonSerializer.Deserialize<Guid>(ref reader, options);
    public override void Write(Utf8JsonWriter writer, Guid? value, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, value.GetValueOrDefault(), options);
}

internal sealed class LegacyStringJsonConverter : JsonConverter<string?>
{
    public override bool HandleNull => true;
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.GetString();
    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value ?? "");
}

internal sealed class LegacyNumericEnumJsonConverter<T> : JsonConverter<string?> where T : struct, Enum
{
    public override bool HandleNull => true;
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        Convert.ToInt32(JsonSerializer.Deserialize<T>(ref reader, options), CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture);
    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, (T)Enum.ToObject(typeof(T), int.Parse(value ?? "0", CultureInfo.InvariantCulture)), options);
}
