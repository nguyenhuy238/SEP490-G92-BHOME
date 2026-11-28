using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace BHome.IntegrationTests.Compact24;

public sealed class Compact24EntityNamingTests
{
    [Fact]
    public void PhysicalEntityNamesFollowDatabaseDesign()
    {
        var runtimeAssembly = typeof(Compact24DbContext).Assembly;
        Assert.Null(runtimeAssembly.GetType("BHome.Infrastructure.Persistence.BHomeDbContext"));
        Assert.Null(runtimeAssembly.GetType("BHome.Infrastructure.Persistence.Compact24.Compact24ArchiveContext"));
        Assert.DoesNotContain(runtimeAssembly.GetReferencedAssemblies(), reference => reference.Name == "BHome.LegacyPersistence");
        using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=offline_native_model;Username=unconfigured").Options);
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["users"] = "User",
            ["refresh_tokens"] = "RefreshToken",
            ["staff_employments"] = "StaffEmployment",
            ["locations"] = "Location",
            ["rooms"] = "Room",
            ["assets"] = "Asset",
            ["residents"] = "Resident",
            ["contracts"] = "Contract",
            ["contract_signings"] = "ContractSigning",
            ["contract_residents"] = "ContractResident",
            ["incident_reports"] = "IncidentReport",
            ["operational_tasks"] = "OperationalTask",
            ["meters"] = "Meter",
            ["meter_readings"] = "MeterReading",
            ["billing_policies"] = "BillingPolicy",
            ["invoices"] = "Invoice",
            ["invoice_items"] = "InvoiceItem",
            ["invoice_adjustments"] = "InvoiceAdjustment",
            ["payments"] = "Payment",
            ["payment_allocations"] = "PaymentAllocation",
            ["refund_requests"] = "RefundRequest",
            ["expenses"] = "Expense",
            ["financial_scenarios"] = "FinancialScenario",
            ["notifications"] = "Notification"
        };
        var entities = db.Model.GetEntityTypes().ToArray();
        Assert.Equal(expected.OrderBy(x => x.Key), entities.ToDictionary(e => e.GetTableName()!, e => e.ClrType.Name).OrderBy(x => x.Key));

        // ASP.NET Core Identity owns these inherited member names. The shadow fields
        // retain their exact SQL names, which are part of the native Identity store.
        var identityNames = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["username"] = "UserName",
            ["normalized_username"] = "NormalizedUserName",
            ["phone"] = "PhoneNumber",
            ["phone_confirmed"] = "PhoneNumberConfirmed",
            ["full_name"] = "full_name",
            ["roles"] = "roles",
            ["reset_token_hash"] = "reset_token_hash",
            ["reset_expires_at"] = "reset_expires_at",
            ["reset_consumed_at"] = "reset_consumed_at",
            ["business_profile"] = "business_profile",
            ["signing_credentials"] = "signing_credentials",
            ["history"] = "history"
        };
        var mismatches = new List<string>();
        foreach (var entity in entities)
        {
            var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
            foreach (var property in entity.GetProperties())
            {
                var column = property.GetColumnName(table)!;
                var name = table.Name == "users" && identityNames.TryGetValue(column, out var identityName)
                    ? identityName
                    : string.Concat(column.Split('_').Select(part => char.ToUpperInvariant(part[0]) + part[1..]));
                if (name != property.Name) mismatches.Add($"{table.Name}.{column}: expected {name}, mapped {property.Name}");
            }
        }
        Assert.True(mismatches.Count == 0, string.Join(Environment.NewLine, mismatches));
    }
}
