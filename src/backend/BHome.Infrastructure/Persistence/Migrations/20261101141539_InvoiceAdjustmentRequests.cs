using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InvoiceAdjustmentRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InvoiceAdjustmentRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequesterId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    ChargeCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CurrentAmount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    ProposedAmount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: true),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    InvoiceSnapshot = table.Column<string>(type: "jsonb", nullable: false),
                    InvoiceStatus = table.Column<int>(type: "integer", nullable: false),
                    InvoiceVersion = table.Column<int>(type: "integer", nullable: false),
                    FinancialVersion = table.Column<int>(type: "integer", nullable: false),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceAdjustmentRequests", x => x.Id);
                    table.CheckConstraint("CK_AdjustmentRequest_Values", "\"CurrentAmount\" >= 0 AND (\"ProposedAmount\" IS NULL OR \"ProposedAmount\" >= 0) AND length(btrim(\"Reason\")) > 0 AND \"InvoiceVersion\" > 0 AND \"InvoiceStatus\" IN (0,1)");
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentRequests_AspNetUsers_RequesterId",
                        column: x => x.RequesterId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentRequests_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceAdjustmentCommands",
                columns: table => new
                {
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<Guid>(type: "uuid", nullable: false),
                    Operation = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceAdjustmentCommands", x => new { x.ActorId, x.Key, x.Operation });
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentCommands_InvoiceAdjustmentRequests_Request~",
                        column: x => x.RequestId,
                        principalTable: "InvoiceAdjustmentRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceAdjustmentEvents",
                columns: table => new
                {
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequesterId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceAdjustmentEvents", x => new { x.RequestId, x.Name });
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentEvents_AspNetUsers_RequesterId",
                        column: x => x.RequesterId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentEvents_InvoiceAdjustmentRequests_RequestId",
                        column: x => x.RequestId,
                        principalTable: "InvoiceAdjustmentRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentEvents_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceAdjustmentEvidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    UploaderId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: true),
                    ObjectKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    Uploaded = table.Column<bool>(type: "boolean", nullable: false),
                    CleanupAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceAdjustmentEvidence", x => x.Id);
                    table.CheckConstraint("CK_AdjustmentEvidence_Values", "\"Length\" > 0 AND \"Length\" <= 5242880 AND \"ContentType\" IN ('image/png','image/jpeg')");
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentEvidence_AspNetUsers_UploaderId",
                        column: x => x.UploaderId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentEvidence_InvoiceAdjustmentRequests_Request~",
                        column: x => x.RequestId,
                        principalTable: "InvoiceAdjustmentRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceAdjustmentEvidence_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentCommands_RequestId",
                table: "InvoiceAdjustmentCommands",
                column: "RequestId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentEvents_InvoiceId",
                table: "InvoiceAdjustmentEvents",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentEvents_RequesterId",
                table: "InvoiceAdjustmentEvents",
                column: "RequesterId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentEvidence_InvoiceId",
                table: "InvoiceAdjustmentEvidence",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentEvidence_ObjectKey",
                table: "InvoiceAdjustmentEvidence",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentEvidence_RequestId_CleanupAfter",
                table: "InvoiceAdjustmentEvidence",
                columns: new[] { "RequestId", "CleanupAfter" });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentEvidence_UploaderId",
                table: "InvoiceAdjustmentEvidence",
                column: "UploaderId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentRequests_InvoiceId_SubmittedAt",
                table: "InvoiceAdjustmentRequests",
                columns: new[] { "InvoiceId", "SubmittedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceAdjustmentRequests_RequesterId_SubmittedAt",
                table: "InvoiceAdjustmentRequests",
                columns: new[] { "RequesterId", "SubmittedAt" });
            migrationBuilder.Sql("""
                CREATE TRIGGER adjustment_requests_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "InvoiceAdjustmentRequests"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER adjustment_commands_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "InvoiceAdjustmentCommands"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER adjustment_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "InvoiceAdjustmentEvents"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE FUNCTION bhome_adjustment_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF OLD."RequestId" IS NOT NULL THEN
                    RAISE EXCEPTION 'Linked adjustment evidence is immutable' USING ERRCODE = '23514';
                  END IF;
                  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                  IF NEW."InvoiceId" <> OLD."InvoiceId" OR NEW."UploaderId" <> OLD."UploaderId" OR NEW."ObjectKey" <> OLD."ObjectKey"
                    OR NEW."ContentType" <> OLD."ContentType" OR NEW."Length" <> OLD."Length" OR NEW."CleanupAfter" <> OLD."CleanupAfter"
                    OR OLD."Uploaded" AND NOT NEW."Uploaded" THEN
                    RAISE EXCEPTION 'Evidence identity cannot change' USING ERRCODE = '23514';
                  END IF;
                  IF NEW."RequestId" IS NOT NULL AND (NOT NEW."Uploaded" OR NOT EXISTS
                    (SELECT 1 FROM "InvoiceAdjustmentRequests" r WHERE r."Id" = NEW."RequestId" AND r."InvoiceId" = NEW."InvoiceId" AND r."RequesterId" = NEW."UploaderId")
                    OR (SELECT COUNT(*) FROM "InvoiceAdjustmentEvidence" WHERE "RequestId" = NEW."RequestId") >= 5) THEN
                    RAISE EXCEPTION 'Invalid adjustment evidence link' USING ERRCODE = '23514';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER adjustment_evidence_guard BEFORE UPDATE OR DELETE ON "InvoiceAdjustmentEvidence"
                  FOR EACH ROW EXECUTE FUNCTION bhome_adjustment_evidence_guard();
                CREATE TRIGGER adjustment_evidence_no_truncate BEFORE TRUNCATE ON "InvoiceAdjustmentEvidence"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "InvoiceAdjustmentRequests") OR EXISTS (SELECT 1 FROM "InvoiceAdjustmentEvidence") THEN
                    RAISE EXCEPTION 'Adjustment evidence/history exists; destructive rollback refused';
                  END IF;
                END $$;
                DROP TRIGGER adjustment_evidence_guard ON "InvoiceAdjustmentEvidence";
                DROP FUNCTION bhome_adjustment_evidence_guard();
                """);
            migrationBuilder.DropTable(
                name: "InvoiceAdjustmentCommands");

            migrationBuilder.DropTable(
                name: "InvoiceAdjustmentEvents");

            migrationBuilder.DropTable(
                name: "InvoiceAdjustmentEvidence");

            migrationBuilder.DropTable(
                name: "InvoiceAdjustmentRequests");
        }
    }
}
