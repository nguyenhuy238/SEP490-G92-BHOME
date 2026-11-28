using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FinalInspectionSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ContractFinalInspections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    BaselineContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    BaselineVersion = table.Column<int>(type: "integer", nullable: false),
                    BaselineSnapshot = table.Column<string>(type: "jsonb", nullable: false),
                    ObservedSnapshot = table.Column<string>(type: "jsonb", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    InspectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    OwnerDecision = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    OwnerReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReviewedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractFinalInspections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractFinalInspections_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractFinalInspections_AspNetUsers_StaffId",
                        column: x => x.StaffId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractFinalInspections_Contracts_BaselineContractId",
                        column: x => x.BaselineContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractFinalInspections_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContractFinalInspections_BaselineContractId",
                table: "ContractFinalInspections",
                column: "BaselineContractId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractFinalInspections_ContractId_Version",
                table: "ContractFinalInspections",
                columns: new[] { "ContractId", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractFinalInspections_OwnerId",
                table: "ContractFinalInspections",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractFinalInspections_StaffId",
                table: "ContractFinalInspections",
                column: "StaffId");
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_final_inspection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_OP='DELETE' OR OLD."OwnerDecision" IS NOT NULL OR NEW."ContractId"<>OLD."ContractId" OR NEW."Version"<>OLD."Version"
                     OR NEW."BaselineContractId"<>OLD."BaselineContractId" OR NEW."BaselineVersion"<>OLD."BaselineVersion" OR NEW."BaselineSnapshot"<>OLD."BaselineSnapshot"
                     OR NEW."ObservedSnapshot"<>OLD."ObservedSnapshot" OR NEW."StaffId"<>OLD."StaffId" OR NEW."InspectedAt"<>OLD."InspectedAt"
                     OR NEW."OwnerDecision" NOT IN ('Confirmed','Reinspection') OR NEW."OwnerId" IS NULL OR NEW."ReviewedAt" IS NULL THEN
                    RAISE EXCEPTION 'Inspection snapshot is immutable; only one Owner review permitted' USING ERRCODE='23514';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER final_inspection_guard BEFORE UPDATE OR DELETE ON "ContractFinalInspections" FOR EACH ROW EXECUTE FUNCTION bhome_final_inspection_guard();
                CREATE TRIGGER final_inspection_no_truncate BEFORE TRUNCATE ON "ContractFinalInspections" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"ContractFinalInspections\") THEN RAISE EXCEPTION 'Inspection history exists; rollback refused'; END IF; END $$; DROP TRIGGER final_inspection_guard ON \"ContractFinalInspections\"; DROP FUNCTION bhome_final_inspection_guard();");
            migrationBuilder.DropTable(
                name: "ContractFinalInspections");
        }
    }
}
