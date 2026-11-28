using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

// The existing varchar(30) column and immutable history can store the new
// method. No historical price rows or contract snapshots need rewriting.
[DbContext(typeof(Compact24DbContext)), Migration("20261113000100_PersonMonthlyServiceFees")]
public sealed class PersonMonthlyServiceFees : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(PersonMonthlyServiceFees).Assembly.GetManifestResourceStream("BHome.Compact24.PersonMonthlyServiceFees.sql")!;
        using var reader = new StreamReader(stream);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    // The previous application interprets unknown methods as per-room fees;
    // downgrading without a reviewed data migration can undercharge tenants.
    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Person-based service fees must retain their agreed calculation method.");
}
