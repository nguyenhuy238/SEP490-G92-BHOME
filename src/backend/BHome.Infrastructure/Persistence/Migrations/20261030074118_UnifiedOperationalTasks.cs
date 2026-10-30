using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UnifiedOperationalTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "MeterId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AssignedAt",
                table: "OperationalTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AssignedStaffUserId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AssignmentId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DueAt",
                table: "OperationalTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "EvidenceRequired",
                table: "OperationalTasks",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "OperationalTasks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "LocationId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<int>(
                name: "Priority",
                table: "OperationalTasks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Requirements",
                table: "OperationalTasks",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Result",
                table: "OperationalTasks",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Title",
                table: "OperationalTasks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "VerifiedAt",
                table: "OperationalTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "VerifiedByUserId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "OperationalTasks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Preserve existing Task/reading/evidence identities. Never invent historical assignees.
            migrationBuilder.Sql("""
                UPDATE "OperationalTasks" AS task
                SET "LocationId" = room."LocationId", "Title" = 'Meter reading', "Version" = 1
                FROM "Meters" AS meter JOIN "Rooms" AS room ON room."Id" = meter."RoomId"
                WHERE task."MeterId" = meter."Id";
                """);

            migrationBuilder.CreateTable(
                name: "OperationalTaskCommands",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResponseJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperationalTaskCommands", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OperationalTaskCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperationalTaskCommands_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OperationalTaskEvidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    UploadedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    SubmissionId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperationalTaskEvidence", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OperationalTaskEvidence_AspNetUsers_UploadedByUserId",
                        column: x => x.UploadedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperationalTaskEvidence_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OperationalTaskFileUploads",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    CleanupAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperationalTaskFileUploads", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OperationalTaskFileUploads_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OperationalTaskHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Note = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false),
                    ChangesJson = table.Column<string>(type: "jsonb", nullable: false),
                    ResponsibleStaffUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WasOverdue = table.Column<bool>(type: "boolean", nullable: false),
                    TaskVersion = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperationalTaskHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OperationalTaskHistory_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperationalTaskHistory_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OperationalTaskNotifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<Guid>(type: "uuid", nullable: false),
                    Event = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperationalTaskNotifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OperationalTaskNotifications_AspNetUsers_RecipientUserId",
                        column: x => x.RecipientUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperationalTaskNotifications_OperationalTaskHistory_EventId",
                        column: x => x.EventId,
                        principalTable: "OperationalTaskHistory",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperationalTaskNotifications_OperationalTasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "OperationalTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_AssignedStaffUserId",
                table: "OperationalTasks",
                column: "AssignedStaffUserId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_AssignmentId",
                table: "OperationalTasks",
                column: "AssignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_LocationId_Status_DueAt",
                table: "OperationalTasks",
                columns: new[] { "LocationId", "Status", "DueAt" });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_VerifiedByUserId",
                table: "OperationalTasks",
                column: "VerifiedByUserId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_Kind",
                table: "OperationalTasks",
                sql: "\"Kind\" IN (0,1) AND ((\"Kind\" = 0 AND \"MeterId\" IS NOT NULL AND \"Status\" IN (0,1,2,3)) OR (\"Kind\" = 1 AND \"MeterId\" IS NULL AND \"ContractId\" IS NULL AND \"BillingPeriod\" IS NULL AND \"DueAt\" IS NOT NULL AND length(trim(\"Title\")) > 0 AND length(trim(\"Requirements\")) > 0))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_State",
                table: "OperationalTasks",
                sql: "\"Status\" IN (0,1,2,3,4) AND \"Priority\" IN (0,1) AND \"Version\" > 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_Verification",
                table: "OperationalTasks",
                sql: "\"Kind\" = 0 OR \"Status\" <> 2 OR (\"VerifiedAt\" IS NOT NULL AND \"VerifiedByUserId\" IS NOT NULL AND \"CompletedAt\" IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskCommands_ActorId_Key",
                table: "OperationalTaskCommands",
                columns: new[] { "ActorId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskCommands_TaskId",
                table: "OperationalTaskCommands",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskEvidence_ObjectKey",
                table: "OperationalTaskEvidence",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskEvidence_TaskId_CreatedAt",
                table: "OperationalTaskEvidence",
                columns: new[] { "TaskId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskEvidence_UploadedByUserId",
                table: "OperationalTaskEvidence",
                column: "UploadedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskFileUploads_CleanupAfter",
                table: "OperationalTaskFileUploads",
                column: "CleanupAfter");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskFileUploads_ObjectKey",
                table: "OperationalTaskFileUploads",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskFileUploads_TaskId",
                table: "OperationalTaskFileUploads",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskHistory_ActorId",
                table: "OperationalTaskHistory",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskHistory_TaskId_OccurredAt",
                table: "OperationalTaskHistory",
                columns: new[] { "TaskId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskNotifications_EventId_RecipientUserId",
                table: "OperationalTaskNotifications",
                columns: new[] { "EventId", "RecipientUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskNotifications_RecipientUserId_CreatedAt",
                table: "OperationalTaskNotifications",
                columns: new[] { "RecipientUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTaskNotifications_TaskId",
                table: "OperationalTaskNotifications",
                column: "TaskId");

            migrationBuilder.AddForeignKey(
                name: "FK_OperationalTasks_AspNetUsers_AssignedStaffUserId",
                table: "OperationalTasks",
                column: "AssignedStaffUserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_OperationalTasks_AspNetUsers_VerifiedByUserId",
                table: "OperationalTasks",
                column: "VerifiedByUserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_OperationalTasks_Locations_LocationId",
                table: "OperationalTasks",
                column: "LocationId",
                principalTable: "Locations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_OperationalTasks_StaffLocationAssignments_AssignmentId",
                table: "OperationalTasks",
                column: "AssignmentId",
                principalTable: "StaffLocationAssignments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The legacy schema cannot represent Owner-verified work. Refuse a lossy downgrade.
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "OperationalTasks" WHERE "Kind" <> 0) THEN
                        RAISE EXCEPTION 'Cannot downgrade UnifiedOperationalTasks while operational work exists. Restore the matching application/database backup instead.';
                    END IF;
                END $$;
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_OperationalTasks_AspNetUsers_AssignedStaffUserId",
                table: "OperationalTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_OperationalTasks_AspNetUsers_VerifiedByUserId",
                table: "OperationalTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_OperationalTasks_Locations_LocationId",
                table: "OperationalTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_OperationalTasks_StaffLocationAssignments_AssignmentId",
                table: "OperationalTasks");

            migrationBuilder.DropTable(
                name: "OperationalTaskCommands");

            migrationBuilder.DropTable(
                name: "OperationalTaskEvidence");

            migrationBuilder.DropTable(
                name: "OperationalTaskFileUploads");

            migrationBuilder.DropTable(
                name: "OperationalTaskNotifications");

            migrationBuilder.DropTable(
                name: "OperationalTaskHistory");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_AssignedStaffUserId",
                table: "OperationalTasks");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_AssignmentId",
                table: "OperationalTasks");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_LocationId_Status_DueAt",
                table: "OperationalTasks");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_VerifiedByUserId",
                table: "OperationalTasks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_Kind",
                table: "OperationalTasks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_State",
                table: "OperationalTasks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_Verification",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "AssignedAt",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "AssignedStaffUserId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "AssignmentId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "DueAt",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "EvidenceRequired",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "LocationId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "Priority",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "Requirements",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "Result",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "Title",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "VerifiedAt",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "VerifiedByUserId",
                table: "OperationalTasks");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "OperationalTasks");

            migrationBuilder.AlterColumn<Guid>(
                name: "MeterId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
