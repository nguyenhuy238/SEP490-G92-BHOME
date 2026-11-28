using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261120000100_SharedMainInitialPayment")]
public sealed class SharedMainInitialPaymentMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(SharedMainInitialPaymentMigration).Assembly.GetManifestResourceStream("BHome.Compact24.SharedMainInitialPayment.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Initial payment orders and allocation evidence must be retained.");
}
