using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261126000100_SharedInvoiceDepositOffsets")]
public sealed class SharedInvoiceDepositOffsetsMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(SharedInvoiceDepositOffsetsMigration).Assembly
            .GetManifestResourceStream("BHome.Compact24.SharedInvoiceDepositOffsets.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Shared invoice deposit allocations must remain verifiable; use a reviewed recovery plan.");
}
