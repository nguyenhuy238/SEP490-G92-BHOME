using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

// The runtime contains SQL projections and a typed writer, so scaffolding only the
// two native Identity mappings would omit most physical tables and invariants.
public partial class InitialCompact24 : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql(Compact24Baseline.MigrationSql);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Compact24 baseline rollback is destructive. Use a separately reviewed recovery plan.");
}
