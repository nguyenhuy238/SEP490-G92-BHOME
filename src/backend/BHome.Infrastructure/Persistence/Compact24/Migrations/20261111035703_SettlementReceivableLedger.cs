using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Compact24.Migrations
{
    /// <inheritdoc />
    public partial class SettlementReceivableLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            using var stream = typeof(SettlementReceivableLedger).Assembly.GetManifestResourceStream("BHome.Compact24.SettlementReceivableLedger.sql")!;
            using var reader = new StreamReader(stream); migrationBuilder.Sql(reader.ReadToEnd());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Financial allocations must be preserved; use a reviewed recovery plan.");
        }
    }
}
