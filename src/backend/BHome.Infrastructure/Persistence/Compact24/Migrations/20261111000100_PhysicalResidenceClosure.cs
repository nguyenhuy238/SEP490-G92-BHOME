using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

public partial class PhysicalResidenceClosure : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(PhysicalResidenceClosure).Assembly.GetManifestResourceStream("BHome.Compact24.PhysicalResidenceClosure.sql")!;
        using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
    }
    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Known move-out history must be retained; use a reviewed recovery plan.");
}
