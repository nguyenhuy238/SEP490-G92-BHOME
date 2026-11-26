using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261126000200_MainInitialPaymentNoFees")]
public sealed class MainInitialPaymentNoFeesMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(MainInitialPaymentNoFeesMigration).Assembly.GetManifestResourceStream("BHome.Compact24.MainInitialPaymentNoFees.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Verified initial payment and allocation evidence must be retained.");
}
