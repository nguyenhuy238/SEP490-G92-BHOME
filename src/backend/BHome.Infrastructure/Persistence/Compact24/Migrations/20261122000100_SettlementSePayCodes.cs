using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261122000100_SettlementSePayCodes")]
public sealed class SettlementSePayCodesMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(SettlementSePayCodesMigration).Assembly
            .GetManifestResourceStream("BHome.Compact24.SettlementSePayCodes.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Immutable SePay payment codes and receipt history must remain verifiable.");
}
