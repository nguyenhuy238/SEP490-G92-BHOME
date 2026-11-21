using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class GlobalOwnerLocationScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AspNetUsers_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers");

            migrationBuilder.DropForeignKey(
                name: "FK_Locations_AspNetUsers_OwnerUserId",
                table: "Locations");

            migrationBuilder.DropIndex(
                name: "IX_Locations_OwnerUserId_Name",
                table: "Locations");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers");

            migrationBuilder.RenameColumn(
                name: "OwnerUserId",
                table: "Locations",
                newName: "LegacyOwnerUserId");

            migrationBuilder.RenameColumn(
                name: "ManagedByOwnerUserId",
                table: "AspNetUsers",
                newName: "LegacyManagedByOwnerUserId");

            migrationBuilder.AlterColumn<Guid>(
                name: "LegacyOwnerUserId",
                table: "Locations",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.CreateIndex(
                name: "IX_Locations_Name",
                table: "Locations",
                column: "Name");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Locations_Name",
                table: "Locations");

            migrationBuilder.AlterColumn<Guid>(
                name: "LegacyOwnerUserId",
                table: "Locations",
                type: "uuid",
                nullable: false,
                defaultValue: Guid.Empty,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.RenameColumn(
                name: "LegacyOwnerUserId",
                table: "Locations",
                newName: "OwnerUserId");

            migrationBuilder.RenameColumn(
                name: "LegacyManagedByOwnerUserId",
                table: "AspNetUsers",
                newName: "ManagedByOwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Locations_OwnerUserId_Name",
                table: "Locations",
                columns: new[] { "OwnerUserId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers",
                column: "ManagedByOwnerUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_AspNetUsers_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers",
                column: "ManagedByOwnerUserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Locations_AspNetUsers_OwnerUserId",
                table: "Locations",
                column: "OwnerUserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
