using BHome.Infrastructure.Persistence.Compact24;

namespace BHome.IntegrationTests.Compact24;

// Offline tests only: these cases never open a connection or create a database.
public sealed class Compact24CompatibilityTests
{
    [Theory]
    [InlineData("Development", true, "Host=localhost;Database=bhome", true)]
    [InlineData("Development", true, "Host=127.0.0.1;Database=bhome_compact24_dev_0123456789abcdef0123456789abcdef", true)]
    [InlineData("Development", false, "Host=localhost;Database=bhome", false)]
    [InlineData("Production", true, "Host=localhost;Database=bhome", false)]
    [InlineData("Testing", true, "Host=localhost;Database=bhome", false)]
    [InlineData("Development", true, "Host=example.com;Database=bhome", false)]
    [InlineData("Development", true, "Host=localhost;Database=customer", false)]
    [InlineData("Development", true, "not-a-connection-string", false)]
    public void CompatibilityRequiresOptInDevelopmentAndRecognizedLocalTarget(
        string environment, bool configured, string connection, bool expected)
    {
        Assert.Equal(expected, Compact24Compatibility.Resolve(environment, configured, connection).AllowPreviousPropertySchema);
    }

    [Fact]
    public void PreviousReferencePreservesTheThreeRetiredColumnsWithTheirActualTypes()
    {
        var columns = Compact24Schema.ExpectedColumns(Compact24Schema.PreviousPropertyReference);
        Assert.Equal(386, columns.Length);
        Assert.Contains("locations.room_types:jsonb:True", columns);
        Assert.Contains("rooms.room_type_id:uuid:False", columns);
        Assert.Contains("billing_policies.room_type_id:uuid:False", columns);
        Assert.Equal(24, columns.Select(column => column.Split('.')[0]).Distinct().Count());
    }
}
