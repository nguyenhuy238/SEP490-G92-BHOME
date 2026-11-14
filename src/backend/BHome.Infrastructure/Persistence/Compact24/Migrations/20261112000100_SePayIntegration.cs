using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261112000100_SePayIntegration")]
public sealed class SePayIntegrationMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(SePayIntegrationMigration).Assembly.GetManifestResourceStream("BHome.Compact24.SePayIntegration.sql")!;
        using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Provider evidence and issued payment codes must be retained.");
}
