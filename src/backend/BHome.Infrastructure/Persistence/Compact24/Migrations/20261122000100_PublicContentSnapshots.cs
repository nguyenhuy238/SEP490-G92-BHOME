using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

[DbContext(typeof(Compact24DbContext)), Migration("20261122000100_PublicContentSnapshots")]
public sealed class PublicContentSnapshots : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Preserve the exact currently approved profile. Hidden/draft rows stay private.
        foreach (var table in new[] { "locations", "rooms" })
            migrationBuilder.Sql($$"""
                UPDATE {{table}} SET public_profile=jsonb_set(public_profile,'{published}',public_profile - 'published')
                WHERE published_at IS NOT NULL AND NOT public_profile ? 'published';
                """);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Approved public snapshots must be retained; roll forward instead.");
}
