using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MoveOutAssignments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "InspectionStaffId",
                table: "ContractMoveOuts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "ContractMoveOuts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "ContractMoveOutHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractMoveOutHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractMoveOutHistory_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractMoveOutHistory_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContractMoveOuts_InspectionStaffId_InspectionScheduledAt",
                table: "ContractMoveOuts",
                columns: new[] { "InspectionStaffId", "InspectionScheduledAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ContractMoveOutHistory_ActorId",
                table: "ContractMoveOutHistory",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractMoveOutHistory_ContractId_Version",
                table: "ContractMoveOutHistory",
                columns: new[] { "ContractId", "Version" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ContractMoveOuts_AspNetUsers_InspectionStaffId",
                table: "ContractMoveOuts",
                column: "InspectionStaffId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("""
                CREATE TRIGGER moveout_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "ContractMoveOutHistory"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"ContractMoveOutHistory\") THEN RAISE EXCEPTION 'Move-out history exists; rollback refused'; END IF; END $$;");
            migrationBuilder.DropForeignKey(
                name: "FK_ContractMoveOuts_AspNetUsers_InspectionStaffId",
                table: "ContractMoveOuts");

            migrationBuilder.DropTable(
                name: "ContractMoveOutHistory");

            migrationBuilder.DropIndex(
                name: "IX_ContractMoveOuts_InspectionStaffId_InspectionScheduledAt",
                table: "ContractMoveOuts");

            migrationBuilder.DropColumn(
                name: "InspectionStaffId",
                table: "ContractMoveOuts");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "ContractMoveOuts");
        }
    }
}
