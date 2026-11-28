using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RoomInvoiceDrafts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_shared_room_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE room_id uuid; capacity integer;
                BEGIN
                  IF TG_TABLE_NAME = 'Contracts' THEN room_id := NEW."RoomId";
                  ELSE SELECT "RoomId" INTO room_id FROM "Contracts" WHERE "Id" = NEW."ContractId";
                  END IF;
                  SELECT "Capacity" INTO capacity FROM "Rooms" WHERE "Id" = room_id FOR UPDATE;
                  IF EXISTS (
                    SELECT 1 FROM "Contracts" a JOIN "Contracts" b ON a."RoomId" = b."RoomId" AND a."Id" < b."Id"
                    WHERE a."RoomId" = room_id AND a."Status" = 3 AND b."Status" = 3
                      AND a."StartDate" <= b."EndDate" AND b."StartDate" <= a."EndDate"
                      AND (a."TenantUserId" = b."TenantUserId" OR EXISTS (
                        SELECT 1 FROM "ContractResidents" ar JOIN "ContractResidents" br ON ar."ResidentId" = br."ResidentId"
                        WHERE ar."ContractId" = a."Id" AND br."ContractId" = b."Id"))) THEN
                    RAISE EXCEPTION 'Overlapping occupant contracts' USING ERRCODE = '23514';
                  END IF;
                  IF EXISTS (
                    SELECT 1 FROM "Contracts" boundary JOIN "Contracts" active ON active."RoomId" = boundary."RoomId"
                      AND active."Status" = 3 AND active."StartDate" <= boundary."StartDate" AND active."EndDate" >= boundary."StartDate"
                    JOIN "ContractResidents" occupants ON occupants."ContractId" = active."Id"
                    WHERE boundary."RoomId" = room_id AND boundary."Status" = 3
                    GROUP BY boundary."Id" HAVING COUNT(DISTINCT occupants."ResidentId") > capacity) THEN
                    RAISE EXCEPTION 'Room capacity exceeded' USING ERRCODE = '23514';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE CONSTRAINT TRIGGER shared_room_occupancy_contract AFTER INSERT OR UPDATE ON "Contracts"
                  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bhome_shared_room_occupancy();
                CREATE CONSTRAINT TRIGGER shared_room_occupancy_resident AFTER INSERT OR UPDATE ON "ContractResidents"
                  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bhome_shared_room_occupancy();
                """);
            migrationBuilder.DropIndex(
                name: "UX_Contract_ActiveRoom",
                table: "Contracts");

            migrationBuilder.CreateTable(
                name: "BillingSchedules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RateDate = table.Column<int>(type: "integer", nullable: false),
                    RentSource = table.Column<int>(type: "integer", nullable: false),
                    PartialMonth = table.Column<int>(type: "integer", nullable: false),
                    Rounding = table.Column<int>(type: "integer", nullable: false),
                    DraftDay = table.Column<int>(type: "integer", nullable: false),
                    DraftMonthOffset = table.Column<int>(type: "integer", nullable: false),
                    FinalDay = table.Column<int>(type: "integer", nullable: false),
                    FinalMonthOffset = table.Column<int>(type: "integer", nullable: false),
                    DueDay = table.Column<int>(type: "integer", nullable: false),
                    DueMonthOffset = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingSchedules", x => x.Id);
                    table.CheckConstraint("CK_BillingSchedule_Settings", "\"RateDate\" IN (0,1) AND \"RentSource\" IN (0,1) AND \"PartialMonth\" IN (0,1) AND \"Rounding\" IN (0,1) AND \"DraftDay\" BETWEEN 1 AND 31 AND \"FinalDay\" BETWEEN 1 AND 31 AND \"DueDay\" BETWEEN 1 AND 31 AND \"DraftMonthOffset\" BETWEEN 0 AND 2 AND \"FinalMonthOffset\" BETWEEN 0 AND 2 AND \"DueMonthOffset\" BETWEEN 0 AND 2 AND \"Version\" > 0");
                    table.ForeignKey(
                        name: "FK_BillingSchedules_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Invoices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    LocationName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    BillingPeriod = table.Column<DateOnly>(type: "date", nullable: false),
                    RepresentativeContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    RepresentativeTenantUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    MissingInputs = table.Column<string[]>(type: "text[]", nullable: false),
                    ScheduleSnapshot = table.Column<string>(type: "jsonb", nullable: false),
                    ScheduledFinalDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    FinalizedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    FinalizedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Invoices", x => x.Id);
                    table.CheckConstraint("CK_Invoice_Final", "\"Status\" = 0 OR (\"FinalizedAt\" IS NOT NULL AND \"FinalizedByUserId\" IS NOT NULL AND cardinality(\"MissingInputs\") = 0 AND \"DueDate\" >= \"ScheduledFinalDate\")");
                    table.CheckConstraint("CK_Invoice_State", "\"Status\" IN (0,1) AND \"Version\" > 0 AND \"Total\" >= 0 AND EXTRACT(DAY FROM \"BillingPeriod\") = 1");
                    table.ForeignKey(
                        name: "FK_Invoices_AspNetUsers_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_AspNetUsers_FinalizedByUserId",
                        column: x => x.FinalizedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_AspNetUsers_RepresentativeTenantUserId",
                        column: x => x.RepresentativeTenantUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_Contracts_RepresentativeContractId",
                        column: x => x.RepresentativeContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    ChargeCode = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    PolicyId = table.Column<Guid>(type: "uuid", nullable: true),
                    PolicyVersion = table.Column<int>(type: "integer", nullable: true),
                    RateDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Rate = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    OccupiedDays = table.Column<int>(type: "integer", nullable: false),
                    PeriodDays = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    MeterReadingId = table.Column<Guid>(type: "uuid", nullable: true),
                    PreviousReading = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: true),
                    ConfirmedReading = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceLines", x => x.Id);
                    table.CheckConstraint("CK_InvoiceLine_Amounts", "\"Rate\" >= 0 AND \"Quantity\" >= 0 AND \"Amount\" >= 0 AND \"OccupiedDays\" BETWEEN 1 AND \"PeriodDays\" AND \"PeriodDays\" BETWEEN 28 AND 31");
                    table.ForeignKey(
                        name: "FK_InvoiceLines_BillingPolicies_PolicyId",
                        column: x => x.PolicyId,
                        principalTable: "BillingPolicies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceLines_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceLines_MeterReadings_MeterReadingId",
                        column: x => x.MeterReadingId,
                        principalTable: "MeterReadings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceRecipients",
                columns: table => new
                {
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceRecipients", x => new { x.InvoiceId, x.TenantUserId });
                    table.ForeignKey(
                        name: "FK_InvoiceRecipients_AspNetUsers_TenantUserId",
                        column: x => x.TenantUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvoiceRecipients_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Contract_ActiveRoom",
                table: "Contracts",
                column: "RoomId",
                filter: "\"Status\" = 3");

            migrationBuilder.CreateIndex(
                name: "IX_BillingSchedules_LocationId",
                table: "BillingSchedules",
                column: "LocationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_InvoiceId_ChargeCode",
                table: "InvoiceLines",
                columns: new[] { "InvoiceId", "ChargeCode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_MeterReadingId",
                table: "InvoiceLines",
                column: "MeterReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_PolicyId",
                table: "InvoiceLines",
                column: "PolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceRecipients_TenantUserId",
                table: "InvoiceRecipients",
                column: "TenantUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CreatedByUserId",
                table: "Invoices",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_FinalizedByUserId",
                table: "Invoices",
                column: "FinalizedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_LocationId",
                table: "Invoices",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_RepresentativeContractId",
                table: "Invoices",
                column: "RepresentativeContractId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_RepresentativeTenantUserId",
                table: "Invoices",
                column: "RepresentativeTenantUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_RoomId_BillingPeriod",
                table: "Invoices",
                columns: new[] { "RoomId", "BillingPeriod" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "Invoices") OR EXISTS (SELECT 1 FROM "BillingSchedules") OR
                     EXISTS (SELECT 1 FROM "Contracts" WHERE "Status" = 3 GROUP BY "RoomId" HAVING COUNT(*) > 1) THEN
                    RAISE EXCEPTION 'Rollback would discard billing data or shared tenancies; resolve them first';
                  END IF;
                END $$;
                DROP TRIGGER shared_room_occupancy_contract ON "Contracts";
                DROP TRIGGER shared_room_occupancy_resident ON "ContractResidents";
                DROP FUNCTION bhome_shared_room_occupancy();
                """);
            migrationBuilder.DropTable(
                name: "BillingSchedules");

            migrationBuilder.DropTable(
                name: "InvoiceLines");

            migrationBuilder.DropTable(
                name: "InvoiceRecipients");

            migrationBuilder.DropTable(
                name: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Contract_ActiveRoom",
                table: "Contracts");

            migrationBuilder.CreateIndex(
                name: "UX_Contract_ActiveRoom",
                table: "Contracts",
                column: "RoomId",
                unique: true,
                filter: "\"Status\" = 3");
        }
    }
}
