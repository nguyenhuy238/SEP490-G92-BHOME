using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CaptureWorkflowsMerged : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TargetId",
                table: "SecurityAudit",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetType",
                table: "SecurityAudit",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "Locations",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "ChainId",
                table: "Locations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "Locations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "Chains",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Chains", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Rooms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Rooms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Rooms_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Meters",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    UtilityType = table.Column<int>(type: "integer", nullable: false),
                    Display = table.Column<int>(type: "integer", nullable: false),
                    DecimalPlaces = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    InstalledOn = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Meters", x => x.Id);
                    table.CheckConstraint("CK_Meter_Precision", "\"DecimalPlaces\" BETWEEN 0 AND 4");
                    table.ForeignKey(
                        name: "FK_Meters_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Residents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayLabel = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    ResidentType = table.Column<int>(type: "integer", nullable: false),
                    VerificationStatus = table.Column<int>(type: "integer", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    IdentityData = table.Column<string>(type: "jsonb", nullable: false),
                    IdentityHmac = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    HmacKeyVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ConfirmedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Residents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Residents_AspNetUsers_ConfirmedByUserId",
                        column: x => x.ConfirmedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Residents_AspNetUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Residents_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OperationalTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MeterId = table.Column<Guid>(type: "uuid", nullable: false),
                    Purpose = table.Column<int>(type: "integer", nullable: false),
                    ReadingDate = table.Column<DateOnly>(type: "date", nullable: false),
                    BillingPeriod = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    OcrProposedValue = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: true),
                    OcrImageHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    OcrEngineVersion = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperationalTasks", x => x.Id);
                    table.CheckConstraint("CK_Task_Period", "(\"Purpose\" = 0 AND \"BillingPeriod\" IS NULL) OR (\"Purpose\" = 1 AND \"BillingPeriod\" IS NOT NULL AND EXTRACT(DAY FROM \"BillingPeriod\") = 1)");
                    table.ForeignKey(
                        name: "FK_OperationalTasks_Meters_MeterId",
                        column: x => x.MeterId,
                        principalTable: "Meters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MeterEvidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    UploadedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    ImageHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    CleanupAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    IsUploaded = table.Column<bool>(type: "boolean", nullable: false),
                    IsLinked = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MeterEvidence", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MeterEvidence_AspNetUsers_UploadedByUserId",
                        column: x => x.UploadedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MeterEvidence_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MeterReadings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeterId = table.Column<Guid>(type: "uuid", nullable: false),
                    EvidenceId = table.Column<Guid>(type: "uuid", nullable: false),
                    PreviousValue = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: true),
                    OcrProposedValue = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: true),
                    ConfirmedValue = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    Consumption = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ConfirmedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MeterReadings", x => x.Id);
                    table.CheckConstraint("CK_Reading_Values", "\"ConfirmedValue\" >= 0 AND (\"PreviousValue\" IS NULL OR \"ConfirmedValue\" >= \"PreviousValue\")");
                    table.ForeignKey(
                        name: "FK_MeterReadings_AspNetUsers_ConfirmedByUserId",
                        column: x => x.ConfirmedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MeterReadings_MeterEvidence_EvidenceId",
                        column: x => x.EvidenceId,
                        principalTable: "MeterEvidence",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MeterReadings_Meters_MeterId",
                        column: x => x.MeterId,
                        principalTable: "Meters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MeterReadings_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Locations_ChainId",
                table: "Locations",
                column: "ChainId");

            migrationBuilder.CreateIndex(
                name: "IX_MeterEvidence_IsLinked_CleanupAfter",
                table: "MeterEvidence",
                columns: new[] { "IsLinked", "CleanupAfter" });

            migrationBuilder.CreateIndex(
                name: "IX_MeterEvidence_ObjectKey",
                table: "MeterEvidence",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MeterEvidence_TaskId",
                table: "MeterEvidence",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_MeterEvidence_UploadedByUserId",
                table: "MeterEvidence",
                column: "UploadedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_MeterReadings_ConfirmedByUserId",
                table: "MeterReadings",
                column: "ConfirmedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_MeterReadings_EvidenceId",
                table: "MeterReadings",
                column: "EvidenceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MeterReadings_MeterId",
                table: "MeterReadings",
                column: "MeterId");

            migrationBuilder.CreateIndex(
                name: "IX_MeterReadings_TaskId",
                table: "MeterReadings",
                column: "TaskId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Meters_RoomId_UtilityType",
                table: "Meters",
                columns: new[] { "RoomId", "UtilityType" },
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_MeterId",
                table: "OperationalTasks",
                column: "MeterId",
                unique: true,
                filter: "\"Purpose\" = 0 AND \"Status\" <> 3");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_MeterId_BillingPeriod",
                table: "OperationalTasks",
                columns: new[] { "MeterId", "BillingPeriod" },
                unique: true,
                filter: "\"Purpose\" = 1 AND \"Status\" <> 3");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_Status",
                table: "OperationalTasks",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Residents_ConfirmedByUserId",
                table: "Residents",
                column: "ConfirmedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Residents_OwnerUserId_HmacKeyVersion_IdentityHmac",
                table: "Residents",
                columns: new[] { "OwnerUserId", "HmacKeyVersion", "IdentityHmac" },
                unique: true,
                filter: "\"IdentityHmac\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Residents_RoomId",
                table: "Residents",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_Rooms_LocationId_RoomNumber",
                table: "Rooms",
                columns: new[] { "LocationId", "RoomNumber" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Locations_Chains_ChainId",
                table: "Locations",
                column: "ChainId",
                principalTable: "Chains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Locations_Chains_ChainId",
                table: "Locations");

            migrationBuilder.DropTable(
                name: "Chains");

            migrationBuilder.DropTable(
                name: "MeterReadings");

            migrationBuilder.DropTable(
                name: "Residents");

            migrationBuilder.DropTable(
                name: "MeterEvidence");

            migrationBuilder.DropTable(
                name: "OperationalTasks");

            migrationBuilder.DropTable(
                name: "Meters");

            migrationBuilder.DropTable(
                name: "Rooms");

            migrationBuilder.DropIndex(
                name: "IX_Locations_ChainId",
                table: "Locations");

            migrationBuilder.DropColumn(
                name: "TargetId",
                table: "SecurityAudit");

            migrationBuilder.DropColumn(
                name: "TargetType",
                table: "SecurityAudit");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "Locations");

            migrationBuilder.DropColumn(
                name: "ChainId",
                table: "Locations");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "Locations");
        }
    }
}
