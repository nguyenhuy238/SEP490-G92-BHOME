using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractSettlementSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FinancialSnapshot",
                table: "ContractSettlementReviews",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.AddColumn<bool>(
                name: "NoAdditionalCharges",
                table: "ContractFinalInspections",
                type: "boolean",
                nullable: false,
                defaultValue: false);
            migrationBuilder.Sql("CREATE TRIGGER contract_settlement_reviews_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON \"ContractSettlementReviews\" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"ContractSettlementReviews\" WHERE \"FinancialSnapshot\" <> '{}'::jsonb) THEN RAISE EXCEPTION 'Financial settlement history exists; rollback refused'; END IF; END $$; DROP TRIGGER contract_settlement_reviews_immutable ON \"ContractSettlementReviews\";");
            migrationBuilder.DropColumn(
                name: "FinancialSnapshot",
                table: "ContractSettlementReviews");

            migrationBuilder.DropColumn(
                name: "NoAdditionalCharges",
                table: "ContractFinalInspections");
        }
    }
}
