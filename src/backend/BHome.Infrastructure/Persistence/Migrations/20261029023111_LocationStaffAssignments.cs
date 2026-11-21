using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LocationStaffAssignments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ManagedByOwnerUserId",
                table: "AspNetUsers",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Locations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Locations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Locations_AspNetUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StaffLocationAssignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffLocationAssignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StaffLocationAssignments_AspNetUsers_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffLocationAssignments_AspNetUsers_StaffUserId",
                        column: x => x.StaffUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffLocationAssignments_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers",
                column: "ManagedByOwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Locations_OwnerUserId_Name",
                table: "Locations",
                columns: new[] { "OwnerUserId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_StaffLocationAssignments_CreatedByUserId",
                table: "StaffLocationAssignments",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffLocationAssignments_LocationId",
                table: "StaffLocationAssignments",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffLocationAssignments_StaffUserId_StartDate_EndDate",
                table: "StaffLocationAssignments",
                columns: new[] { "StaffUserId", "StartDate", "EndDate" });

            migrationBuilder.AddForeignKey(
                name: "FK_AspNetUsers_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers",
                column: "ManagedByOwnerUserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql("""
                ALTER TABLE "StaffLocationAssignments"
                ADD CONSTRAINT "CK_StaffLocationAssignments_DateRange"
                CHECK ("StartDate" <= "EndDate");

                CREATE EXTENSION IF NOT EXISTS btree_gist;
                ALTER TABLE "StaffLocationAssignments"
                ADD CONSTRAINT "EX_StaffLocationAssignments_Location_DateRange"
                EXCLUDE USING gist
                ("LocationId" WITH =, daterange("StartDate", "EndDate", '[]') WITH &&);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AspNetUsers_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers");

            migrationBuilder.DropTable(
                name: "StaffLocationAssignments");

            migrationBuilder.DropTable(
                name: "Locations");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_ManagedByOwnerUserId",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "ManagedByOwnerUserId",
                table: "AspNetUsers");
        }
    }
}
