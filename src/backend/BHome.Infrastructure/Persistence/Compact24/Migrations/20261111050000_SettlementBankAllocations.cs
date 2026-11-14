using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

// SQL guards only; the CLR projection and model snapshot are unchanged.
[DbContext(typeof(Compact24DbContext)), Migration("20261111050000_SettlementBankAllocations")]
public sealed class SettlementBankAllocations : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(SettlementBankAllocations).Assembly.GetManifestResourceStream("BHome.Compact24.SettlementBankAllocations.sql")!;
        using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Verified financial allocations must be retained.");
}
