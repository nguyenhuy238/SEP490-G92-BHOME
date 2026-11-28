using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261111060000_ReceiptExcessDisposition")]
public sealed class ReceiptExcessDispositionGuard : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(ReceiptExcessDispositionGuard).Assembly.GetManifestResourceStream("BHome.Compact24.ReceiptExcessDisposition.sql")!;
        using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Refundable bank receipt claims must be retained.");
}
