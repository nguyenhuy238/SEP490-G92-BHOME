using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BillingMeterAutomation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AutomationPlanId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BillingRoomId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BillingUtilityType",
                table: "OperationalTasks",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BillingAutomationExecutions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    BillingPeriod = table.Column<DateOnly>(type: "date", nullable: false),
                    Phase = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    CreatedCount = table.Column<int>(type: "integer", nullable: false),
                    ExistingCount = table.Column<int>(type: "integer", nullable: false),
                    ExceptionsJson = table.Column<string>(type: "jsonb", nullable: false),
                    LastErrorCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LastStartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LockedUntil = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LockToken = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingAutomationExecutions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BillingAutomationExecutions_BillingAutomationPlans_PlanId",
                        column: x => x.PlanId,
                        principalTable: "BillingAutomationPlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BillingAutomationAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExecutionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    SummaryJson = table.Column<string>(type: "jsonb", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingAutomationAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BillingAutomationAttempts_BillingAutomationExecutions_Execu~",
                        column: x => x.ExecutionId,
                        principalTable: "BillingAutomationExecutions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_AutomationPlanId",
                table: "OperationalTasks",
                column: "AutomationPlanId");
            migrationBuilder.Sql("""
                UPDATE "OperationalTasks" t SET "BillingRoomId"=m."RoomId", "BillingUtilityType"=m."UtilityType"
                FROM "Meters" m WHERE t."MeterId"=m."Id" AND t."Kind"=0 AND t."Purpose"=1;
                DO $$ BEGIN IF EXISTS (SELECT 1 FROM "OperationalTasks" WHERE "Kind"=0 AND "Purpose"=1
                  GROUP BY "BillingRoomId","BillingUtilityType","BillingPeriod" HAVING count(*)>1)
                  THEN RAISE EXCEPTION 'Existing duplicate room/type/period tasks require history review'; END IF; END $$;
                CREATE FUNCTION bhome_meter_period_identity() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF NEW."Kind"=0 AND NEW."Purpose"=1 THEN
                    IF TG_OP='UPDATE' AND OLD."Purpose"=1 AND OLD."MeterId"<>NEW."MeterId" THEN
                      RAISE EXCEPTION 'Periodic meter replacement requires review'; END IF;
                    SELECT "RoomId","UtilityType" INTO NEW."BillingRoomId",NEW."BillingUtilityType" FROM "Meters" WHERE "Id"=NEW."MeterId";
                  ELSE NEW."BillingRoomId"=NULL; NEW."BillingUtilityType"=NULL; END IF;
                  RETURN NEW;
                END; $$;
                CREATE TRIGGER meter_period_identity BEFORE INSERT OR UPDATE ON "OperationalTasks" FOR EACH ROW EXECUTE FUNCTION bhome_meter_period_identity();
                CREATE FUNCTION bhome_meter_history_identity() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF (OLD."RoomId"<>NEW."RoomId" OR OLD."UtilityType"<>NEW."UtilityType") AND EXISTS(SELECT 1 FROM "OperationalTasks" WHERE "MeterId"=OLD."Id")
                  THEN RAISE EXCEPTION 'Meter history identity is immutable'; END IF; RETURN NEW; END; $$;
                CREATE TRIGGER meter_history_identity BEFORE UPDATE OF "RoomId","UtilityType" ON "Meters" FOR EACH ROW EXECUTE FUNCTION bhome_meter_history_identity();
                CREATE TRIGGER billing_attempt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "BillingAutomationAttempts" FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();
                """);

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_BillingRoomId_BillingUtilityType_BillingPe~",
                table: "OperationalTasks",
                columns: new[] { "BillingRoomId", "BillingUtilityType", "BillingPeriod" },
                unique: true,
                filter: "\"Kind\"=0 AND \"Purpose\"=1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_RoomPeriod",
                table: "OperationalTasks",
                sql: "(\"Kind\"<>0 OR \"Purpose\"<>1 OR (\"BillingRoomId\" IS NOT NULL AND \"BillingUtilityType\" IN (0,1))) AND (\"AutomationPlanId\" IS NULL OR (\"Kind\"=0 AND \"Purpose\"=1))");

            migrationBuilder.CreateIndex(
                name: "IX_BillingAutomationAttempts_ExecutionId_Sequence",
                table: "BillingAutomationAttempts",
                columns: new[] { "ExecutionId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BillingAutomationExecutions_LocationId_LastStartedAt",
                table: "BillingAutomationExecutions",
                columns: new[] { "LocationId", "LastStartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_BillingAutomationExecutions_PlanId_BillingPeriod_Phase",
                table: "BillingAutomationExecutions",
                columns: new[] { "PlanId", "BillingPeriod", "Phase" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_OperationalTasks_BillingAutomationPlans_AutomationPlanId",
                table: "OperationalTasks",
                column: "AutomationPlanId",
                principalTable: "BillingAutomationPlans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS(SELECT 1 FROM "BillingAutomationExecutions") OR EXISTS(SELECT 1 FROM "OperationalTasks" WHERE "AutomationPlanId" IS NOT NULL)
                THEN RAISE EXCEPTION 'Preserve billing automation execution history before rollback'; END IF; END $$;
                DROP TRIGGER billing_attempt_immutable ON "BillingAutomationAttempts";
                DROP TRIGGER meter_period_identity ON "OperationalTasks"; DROP FUNCTION bhome_meter_period_identity();
                DROP TRIGGER meter_history_identity ON "Meters"; DROP FUNCTION bhome_meter_history_identity();
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_OperationalTasks_BillingAutomationPlans_AutomationPlanId",
                table: "OperationalTasks");

            migrationBuilder.DropTable(
                name: "BillingAutomationAttempts");

            migrationBuilder.DropTable(
                name: "BillingAutomationExecutions");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_AutomationPlanId",
                table: "OperationalTasks");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_BillingRoomId_BillingUtilityType_BillingPe~",
                table: "OperationalTasks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_RoomPeriod",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "AutomationPlanId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "BillingRoomId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "BillingUtilityType",
                table: "OperationalTasks");
        }
    }
}
