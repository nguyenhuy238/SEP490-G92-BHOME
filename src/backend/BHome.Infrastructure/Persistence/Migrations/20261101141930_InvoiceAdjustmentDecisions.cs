using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InvoiceAdjustmentDecisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "CalculatedAmount",
                table: "InvoiceLines",
                type: "numeric(18,0)",
                precision: 18,
                scale: 0,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CorrectionRequestId",
                table: "InvoiceLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "InvoiceAdjustmentDecisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Outcome = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    InvoiceStatus = table.Column<int>(type: "integer", nullable: false),
                    ChargeCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    BeforeAmount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    CorrectedAmount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: true),
                    Delta = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    EffectiveBefore = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    EffectiveAfter = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    PaidAtDecision = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    SourceFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceAdjustmentDecisions", x => x.Id);
                    table.CheckConstraint("CK_AdjustmentDecision_Values", "\"Outcome\" IN ('Approved','Rejected') AND \"InvoiceStatus\" IN (0,1) AND length(btrim(\"Reason\")) > 0 AND \"EffectiveBefore\" >= 0 AND \"EffectiveAfter\" >= 0 AND \"BeforeAmount\" >= 0 AND (\"CorrectedAmount\" IS NULL OR \"CorrectedAmount\" >= 0) AND \"EffectiveAfter\" = \"EffectiveBefore\" + \"Delta\" AND ((\"Outcome\" = 'Approved' AND \"CorrectedAmount\" IS NOT NULL AND \"Delta\" = \"CorrectedAmount\" - \"BeforeAmount\") OR (\"Outcome\" = 'Rejected' AND \"CorrectedAmount\" IS NULL AND \"Delta\" = 0))");
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentDecisions_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentDecisions_InvoiceAdjustmentRequests_Reques~",
                        column: x => x.RequestId,
                        principalTable: "InvoiceAdjustmentRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentDecisions_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_CorrectionRequestId",
                table: "InvoiceLines",
                column: "CorrectionRequestId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentDecisions_InvoiceId_InvoiceStatus_Outcome",
                table: "InvoiceAdjustmentDecisions",
                columns: new[] { "InvoiceId", "InvoiceStatus", "Outcome" });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentDecisions_OwnerId",
                table: "InvoiceAdjustmentDecisions",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentDecisions_RequestId",
                table: "InvoiceAdjustmentDecisions",
                column: "RequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentDecisions_Sequence",
                table: "InvoiceAdjustmentDecisions",
                column: "Sequence",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_InvoiceLines_InvoiceAdjustmentRequests_CorrectionRequestId",
                table: "InvoiceLines",
                column: "CorrectionRequestId",
                principalTable: "InvoiceAdjustmentRequests",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("""
                CREATE TRIGGER adjustment_decisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "InvoiceAdjustmentDecisions"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE FUNCTION bhome_adjustment_decision_validate() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF NOT EXISTS (SELECT 1 FROM "InvoiceAdjustmentRequests" r WHERE r."Id" = NEW."RequestId" AND r."InvoiceId" = NEW."InvoiceId") THEN
                    RAISE EXCEPTION 'Decision must belong to its request invoice' USING ERRCODE = '23514';
                  END IF;
                  IF NEW."Outcome" = 'Approved' AND NEW."InvoiceStatus" = 0 AND (NEW."ChargeCode" IS NULL OR length(NEW."SourceFingerprint") <> 64) THEN
                    RAISE EXCEPTION 'Draft correction needs a charge and source snapshot' USING ERRCODE = '23514';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER adjustment_decision_validate BEFORE INSERT ON "InvoiceAdjustmentDecisions"
                  FOR EACH ROW EXECUTE FUNCTION bhome_adjustment_decision_validate();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS (SELECT 1 FROM "InvoiceAdjustmentDecisions") THEN
                  RAISE EXCEPTION 'Adjustment decisions exist; destructive rollback refused'; END IF; END $$;
                DROP TRIGGER adjustment_decision_validate ON "InvoiceAdjustmentDecisions";
                DROP FUNCTION bhome_adjustment_decision_validate();
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_InvoiceLines_InvoiceAdjustmentRequests_CorrectionRequestId",
                table: "InvoiceLines");

            migrationBuilder.DropTable(
                name: "InvoiceAdjustmentDecisions");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceLines_CorrectionRequestId",
                table: "InvoiceLines");

            migrationBuilder.DropColumn(
                name: "CalculatedAmount",
                table: "InvoiceLines");

            migrationBuilder.DropColumn(
                name: "CorrectionRequestId",
                table: "InvoiceLines");
        }
    }
}
