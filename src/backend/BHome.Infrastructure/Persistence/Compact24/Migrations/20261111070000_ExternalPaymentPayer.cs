using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace BHome.Infrastructure.Persistence.Compact24.Migrations;
[DbContext(typeof(Compact24DbContext)), Migration("20261111070000_ExternalPaymentPayer")]
public sealed class ExternalPaymentPayerMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(ExternalPaymentPayerMigration).Assembly.GetManifestResourceStream("BHome.Compact24.ExternalPaymentPayer.sql")!;
        using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("External payer identities and refund history must be retained.");
}
