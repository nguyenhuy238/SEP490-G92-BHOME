using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.PropertyManagement;

namespace BHome.Api.Configuration;

// Shared application records retain the archived schema's optional RoomTypeId for offline
// regression tests. The current HTTP contract rejects that retired field, including null.
public sealed class RetiredRoomTypeJsonConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert == typeof(RoomWrite) || typeToConvert == typeof(PolicyWrite);

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
        typeToConvert == typeof(RoomWrite) ? new InputConverter<RoomWrite>() : new InputConverter<PolicyWrite>();

    private sealed class InputConverter<T> : JsonConverter<T>
    {
        public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            using var document = JsonDocument.ParseValue(ref reader);
            if (document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.EnumerateObject()
                .Any(p => p.Name.Equals("roomTypeId", StringComparison.OrdinalIgnoreCase)))
                throw new JsonException("roomTypeId is retired; use Location or Room scope.");
            return document.RootElement.Deserialize<T>(WithoutThisConverter(options));
        }

        public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) =>
            JsonSerializer.Serialize(writer, value, WithoutThisConverter(options));

        private static JsonSerializerOptions WithoutThisConverter(JsonSerializerOptions options)
        {
            var copy = new JsonSerializerOptions(options);
            for (var i = copy.Converters.Count - 1; i >= 0; i--)
                if (copy.Converters[i] is RetiredRoomTypeJsonConverterFactory) copy.Converters.RemoveAt(i);
            return copy;
        }
    }
}
