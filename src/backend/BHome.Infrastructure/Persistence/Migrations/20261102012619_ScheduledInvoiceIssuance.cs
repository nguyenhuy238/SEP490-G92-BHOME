using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ScheduledInvoiceIssuance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AutomationFinalizationPlanId",
                table: "Invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "InvoiceIssuedEvents",
                columns: table => new
                {
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AutomationPlanId = table.Column<Guid>(type: "uuid", nullable: true),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceIssuedEvents", x => x.InvoiceId);
                    table.ForeignKey(
                        name: "FK_InvoiceIssuedEvents_AspNetUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceIssuedEvents_BillingAutomationPlans_AutomationPlanId",
                        column: x => x.AutomationPlanId,
                        principalTable: "BillingAutomationPlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceIssuedEvents_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_AutomationFinalizationPlanId",
                table: "Invoices",
                column: "AutomationFinalizationPlanId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceIssuedEvents_AutomationPlanId",
                table: "InvoiceIssuedEvents",
                column: "AutomationPlanId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceIssuedEvents_OccurredAt",
                table: "InvoiceIssuedEvents",
                column: "OccurredAt");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceIssuedEvents_OwnerUserId",
                table: "InvoiceIssuedEvents",
                column: "OwnerUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_BillingAutomationPlans_AutomationFinalizationPlanId",
                table: "Invoices",
                column: "AutomationFinalizationPlanId",
                principalTable: "BillingAutomationPlans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("CREATE TRIGGER invoice_issued_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON \"InvoiceIssuedEvents\" FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"InvoiceIssuedEvents\") OR EXISTS(SELECT 1 FROM \"Invoices\" WHERE \"AutomationFinalizationPlanId\" IS NOT NULL) THEN RAISE EXCEPTION 'Preserve invoice issuance history before rollback'; END IF; END $$; DROP TRIGGER invoice_issued_event_immutable ON \"InvoiceIssuedEvents\";");
            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_BillingAutomationPlans_AutomationFinalizationPlanId",
                table: "Invoices");

            migrationBuilder.DropTable(
                name: "InvoiceIssuedEvents");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_AutomationFinalizationPlanId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "AutomationFinalizationPlanId",
                table: "Invoices");
        }
    }
}
