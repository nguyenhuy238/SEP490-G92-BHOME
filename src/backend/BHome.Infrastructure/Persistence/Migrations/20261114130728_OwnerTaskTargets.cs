using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OwnerTaskTargets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TargetAssetId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetCommonArea",
                table: "OperationalTasks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetLabel",
                table: "OperationalTasks",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TargetRoomId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TargetAssetId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "TargetCommonArea",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "TargetLabel",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "TargetRoomId",
                table: "OperationalTasks");
        }
    }
}
