using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace BHome.Infrastructure.Persistence.Compact24.Migrations;
[DbContext(typeof(Compact24DbContext)), Migration("20261111080000_DepositReceiptAllocation")]
public sealed class DepositReceiptAllocationMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(DepositReceiptAllocationMigration).Assembly.GetManifestResourceStream("BHome.Compact24.DepositReceiptAllocation.sql")!;
        using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Deposit receipt and payer evidence must be retained.");
}
