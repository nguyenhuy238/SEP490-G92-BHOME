using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractHandoverReadingReferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ElectricityReadingId",
                table: "ContractHandovers",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "WaterReadingId",
                table: "ContractHandovers",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "ElectricityReadingId",
                table: "ContractHandoverHistory",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "WaterReadingId",
                table: "ContractHandoverHistory",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandovers_ElectricityReadingId",
                table: "ContractHandovers",
                column: "ElectricityReadingId");

            // Metadata-only backfill from the existing immutable snapshot, inside the migration transaction.
            // ALTER TABLE holds the table locks until the evidence triggers have been restored.
            migrationBuilder.Sql("""
                ALTER TABLE "ContractHandovers" DISABLE TRIGGER handover_confirmed_immutable;
                ALTER TABLE "ContractHandoverHistory" DISABLE TRIGGER handover_history_immutable;
                UPDATE "ContractHandovers" SET
                  "ElectricityReadingId" = ("Snapshot"->'Electricity'->>'Id')::uuid,
                  "WaterReadingId" = ("Snapshot"->'Water'->>'Id')::uuid;
                UPDATE "ContractHandoverHistory" SET
                  "ElectricityReadingId" = ("Snapshot"->'Electricity'->>'Id')::uuid,
                  "WaterReadingId" = ("Snapshot"->'Water'->>'Id')::uuid;
                ALTER TABLE "ContractHandoverHistory" ENABLE TRIGGER handover_history_immutable;
                ALTER TABLE "ContractHandovers" ENABLE TRIGGER handover_confirmed_immutable;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandovers_WaterReadingId",
                table: "ContractHandovers",
                column: "WaterReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandoverHistory_ElectricityReadingId",
                table: "ContractHandoverHistory",
                column: "ElectricityReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandoverHistory_WaterReadingId",
                table: "ContractHandoverHistory",
                column: "WaterReadingId");

            migrationBuilder.AddForeignKey(
                name: "FK_ContractHandoverHistory_MeterReadings_ElectricityReadingId",
                table: "ContractHandoverHistory",
                column: "ElectricityReadingId",
                principalTable: "MeterReadings",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ContractHandoverHistory_MeterReadings_WaterReadingId",
                table: "ContractHandoverHistory",
                column: "WaterReadingId",
                principalTable: "MeterReadings",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ContractHandovers_MeterReadings_ElectricityReadingId",
                table: "ContractHandovers",
                column: "ElectricityReadingId",
                principalTable: "MeterReadings",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ContractHandovers_MeterReadings_WaterReadingId",
                table: "ContractHandovers",
                column: "WaterReadingId",
                principalTable: "MeterReadings",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ContractHandoverHistory_MeterReadings_ElectricityReadingId",
                table: "ContractHandoverHistory");

            migrationBuilder.DropForeignKey(
                name: "FK_ContractHandoverHistory_MeterReadings_WaterReadingId",
                table: "ContractHandoverHistory");

            migrationBuilder.DropForeignKey(
                name: "FK_ContractHandovers_MeterReadings_ElectricityReadingId",
                table: "ContractHandovers");

            migrationBuilder.DropForeignKey(
                name: "FK_ContractHandovers_MeterReadings_WaterReadingId",
                table: "ContractHandovers");

            migrationBuilder.DropIndex(
                name: "IX_ContractHandovers_ElectricityReadingId",
                table: "ContractHandovers");

            migrationBuilder.DropIndex(
                name: "IX_ContractHandovers_WaterReadingId",
                table: "ContractHandovers");

            migrationBuilder.DropIndex(
                name: "IX_ContractHandoverHistory_ElectricityReadingId",
                table: "ContractHandoverHistory");

            migrationBuilder.DropIndex(
                name: "IX_ContractHandoverHistory_WaterReadingId",
                table: "ContractHandoverHistory");

            migrationBuilder.DropColumn(
                name: "ElectricityReadingId",
                table: "ContractHandovers");

            migrationBuilder.DropColumn(
                name: "WaterReadingId",
                table: "ContractHandovers");

            migrationBuilder.DropColumn(
                name: "ElectricityReadingId",
                table: "ContractHandoverHistory");

            migrationBuilder.DropColumn(
                name: "WaterReadingId",
                table: "ContractHandoverHistory");
        }
    }
}
