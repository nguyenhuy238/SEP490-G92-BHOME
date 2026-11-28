using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BillingInvoiceAutomation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AutomationPlanId",
                table: "Invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BillingRepresentativeSelections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    BillingPeriod = table.Column<DateOnly>(type: "date", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    SelectedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SelectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingRepresentativeSelections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BillingRepresentativeSelections_AspNetUsers_SelectedByUserId",
                        column: x => x.SelectedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillingRepresentativeSelections_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillingRepresentativeSelections_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_AutomationPlanId",
                table: "Invoices",
                column: "AutomationPlanId");

            migrationBuilder.CreateIndex(
                name: "IX_BillingRepresentativeSelections_ContractId",
                table: "BillingRepresentativeSelections",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_BillingRepresentativeSelections_RoomId_BillingPeriod_Version",
                table: "BillingRepresentativeSelections",
                columns: new[] { "RoomId", "BillingPeriod", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BillingRepresentativeSelections_SelectedByUserId",
                table: "BillingRepresentativeSelections",
                column: "SelectedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_BillingAutomationPlans_AutomationPlanId",
                table: "Invoices",
                column: "AutomationPlanId",
                principalTable: "BillingAutomationPlans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("CREATE TRIGGER billing_representative_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON \"BillingRepresentativeSelections\" FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"BillingRepresentativeSelections\") OR EXISTS(SELECT 1 FROM \"Invoices\" WHERE \"AutomationPlanId\" IS NOT NULL) THEN RAISE EXCEPTION 'Preserve automated billing history before rollback'; END IF; END $$; DROP TRIGGER billing_representative_immutable ON \"BillingRepresentativeSelections\";");
            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_BillingAutomationPlans_AutomationPlanId",
                table: "Invoices");

            migrationBuilder.DropTable(
                name: "BillingRepresentativeSelections");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_AutomationPlanId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "AutomationPlanId",
                table: "Invoices");
        }
    }
}
