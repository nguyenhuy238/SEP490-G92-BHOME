using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Application.PropertyManagement;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedRoomDefaults([property: JsonRequired] int Capacity, [property: JsonRequired] decimal Area, string[] Amenities, decimal? ReferenceRent);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedCatalogData(string Category, string Unit, [property: JsonRequired] decimal ReferencePrice);

public sealed partial class SharedDataValidator(ISharedConfigurationStore store) : ISharedDataValidator
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString, Converters = { new JsonStringEnumConverter() } };
    public bool Supports(string resource) => resource is "room-type-templates" or "asset-catalog" or "asset-templates" or "fee-templates" or "policy-templates";
    internal static string Text(string? text, int max) => !string.IsNullOrWhiteSpace(text) && text.Trim().Length <= max ? text.Trim() : throw new PropertyException(400, "invalid_shared_data");
    internal static decimal Money(decimal value) => value >= 0 && value <= 99999999999999.9999m && decimal.Round(value, 4) == value ? value : throw new PropertyException(400, "invalid_shared_rate");
    internal static T Read<T>(JsonElement data)
    {
        try { return data.Deserialize<T>(Json) ?? throw new PropertyException(400, "invalid_shared_data"); }
        catch (JsonException) { throw new PropertyException(400, "invalid_shared_data"); }
    }
    public async Task<JsonElement> ValidateAsync(string resource, JsonElement data, CancellationToken t)
    {
        _ = store; _ = t;
        object value = resource switch
        {
            "room-type-templates" => Room(Read<SharedRoomDefaults>(data)),
            "asset-catalog" => Catalog(Read<SharedCatalogData>(data)),
            "asset-templates" => await AssetsAsync(Read<SharedAssetData>(data), t),
            "fee-templates" => Fee(Read<SharedFeeData>(data)),
            "policy-templates" => Policy(Read<SharedPolicyData>(data)),
            _ => throw new PropertyException(404, "shared_resource_not_found")
        };
        return JsonSerializer.SerializeToElement(value, Json);
    }
    private static SharedRoomDefaults Room(SharedRoomDefaults input)
    {
        if (input.Capacity is < 1 or > 32767 || input.Area is <= 0 or > 1000000 || decimal.Round(input.Area, 4) != input.Area || input.Amenities is null || input.Amenities.Length > 100) throw new PropertyException(400, "invalid_room_defaults");
        var amenities = input.Amenities.Select(x => Text(x, 200)).ToArray();
        if (amenities.Distinct(StringComparer.OrdinalIgnoreCase).Count() != amenities.Length) throw new PropertyException(400, "duplicate_amenity");
        return input with { Amenities = amenities, ReferenceRent = input.ReferenceRent.HasValue ? Money(input.ReferenceRent.Value) : null };
    }
    private static SharedCatalogData Catalog(SharedCatalogData input) => new(Text(input.Category, 80), Text(input.Unit, 80), Money(input.ReferencePrice));
}
