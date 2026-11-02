using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BillingAutomationPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BillingAutomationPlans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    AuthorizeAutomaticFinalization = table.Column<bool>(type: "boolean", nullable: false),
                    MeterDay = table.Column<int>(type: "integer", nullable: false),
                    MeterDueDay = table.Column<int>(type: "integer", nullable: false),
                    MeterDueMonthOffset = table.Column<int>(type: "integer", nullable: false),
                    TimeZone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    BillingScheduleVersion = table.Column<int>(type: "integer", nullable: false),
                    BillingSnapshot = table.Column<string>(type: "jsonb", nullable: false),
                    AuthorizedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingAutomationPlans", x => x.Id);
                    table.CheckConstraint("CK_BillingAutomationPlan_Calendar", "\"Version\">0 AND \"BillingScheduleVersion\">0 AND \"MeterDay\" BETWEEN 1 AND 31 AND \"MeterDueDay\" BETWEEN 1 AND 31 AND \"MeterDueMonthOffset\" BETWEEN 0 AND 2 AND \"TimeZone\"='Asia/Ho_Chi_Minh' AND (NOT \"AuthorizeAutomaticFinalization\" OR \"Enabled\") AND EXTRACT(DAY FROM \"EffectiveFrom\")=1");
                    table.ForeignKey(
                        name: "FK_BillingAutomationPlans_AspNetUsers_AuthorizedByUserId",
                        column: x => x.AuthorizedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillingAutomationPlans_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BillingAutomationPlans_AuthorizedByUserId",
                table: "BillingAutomationPlans",
                column: "AuthorizedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_BillingAutomationPlans_LocationId_EffectiveFrom_Version",
                table: "BillingAutomationPlans",
                columns: new[] { "LocationId", "EffectiveFrom", "Version" });

            migrationBuilder.CreateIndex(
                name: "IX_BillingAutomationPlans_LocationId_Version",
                table: "BillingAutomationPlans",
                columns: new[] { "LocationId", "Version" },
                unique: true);
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_billing_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Billing automation plans are append-only'; END; $$;
                CREATE TRIGGER billing_plan_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "BillingAutomationPlans"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"BillingAutomationPlans\") THEN RAISE EXCEPTION 'Preserve billing automation history before rollback'; END IF; END $$;");
            migrationBuilder.Sql("DROP TRIGGER billing_plan_immutable ON \"BillingAutomationPlans\"; DROP FUNCTION bhome_billing_plan_immutable();");
            migrationBuilder.DropTable(
                name: "BillingAutomationPlans");
        }
    }
}
