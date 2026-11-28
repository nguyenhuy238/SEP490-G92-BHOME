using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261115000400_TenantRefundPetitions")]
public sealed class TenantRefundPetitionsMigration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(TenantRefundPetitionsMigration).Assembly.GetManifestResourceStream(
            "BHome.Compact24.TenantRefundPetitions.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Tenant refund requests and evidence history must be retained.");
}
