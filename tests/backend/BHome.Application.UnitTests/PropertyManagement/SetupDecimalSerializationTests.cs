using System.Text.Json;
using BHome.Application.PropertyManagement;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class SetupDecimalSerializationTests
{
    [Fact]
    public void SetupDataPreservesExactDecimalsWithoutChangingOrdinaryIntegerCounts()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var document = new SetupDocument(Guid.NewGuid(), Guid.NewGuid(), "Synthetic", "Draft", 1,
            JsonSerializer.SerializeToElement(new { quantity = 2, amount = 9007199254740993m, rate = 3000.1250m, nested = new[] { new { rate = 0.0001m } } }, options));
        var restored = JsonSerializer.Deserialize<SetupDocument>(JsonSerializer.Serialize(document, options), options)!;
        Assert.Equal(2, restored.Data.GetProperty("quantity").GetInt32());
        Assert.Equal("9007199254740993", restored.Data.GetProperty("amount").GetString());
        Assert.Equal("3000.1250", restored.Data.GetProperty("rate").GetString());
        Assert.Equal("0.0001", restored.Data.GetProperty("nested")[0].GetProperty("rate").GetString());
        Assert.Equal(9007199254740993m, restored.Data.Deserialize<Amounts>(options)!.Amount);
    }
    private sealed record Amounts(decimal Amount, decimal Rate);

    [Fact]
    public void ReconciliationPreviewAndAssetMetadataUseExactDecimalStrings()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var view = UtilityReconciliationView.From(new(Guid.NewGuid(), 0.0001m, 0, 0, 0.0001m, 0, "NeedsReview", "Synthetic", "hash"));
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(view, options));
        Assert.Equal("0.0001", json.RootElement.GetProperty("variance").GetString());
        using var metadata = JsonDocument.Parse(JsonSerializer.Serialize(new AssetMetadata("Serialized", 1, 9007199254740993m, null, null), options));
        Assert.Equal("9007199254740993", metadata.RootElement.GetProperty("purchaseCost").GetString());
    }
}
