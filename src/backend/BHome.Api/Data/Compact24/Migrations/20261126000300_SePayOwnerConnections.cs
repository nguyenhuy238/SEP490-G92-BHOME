using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261126000300_SePayOwnerConnections")]
public sealed class SePayOwnerConnectionsMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(SePayOwnerConnectionsMigration).Assembly.GetManifestResourceStream("BHome.Compact24.SePayOwnerConnections.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Owner credentials and issued payment evidence must be retained.");
}
