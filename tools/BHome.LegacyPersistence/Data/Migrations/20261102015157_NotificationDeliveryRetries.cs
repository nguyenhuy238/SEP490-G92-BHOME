using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NotificationDeliveryRetries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DeliveryAttempts",
                table: "UserNotifications",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeliveryLastAttemptAt",
                table: "UserNotifications",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeliveryLastErrorCode",
                table: "UserNotifications",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeliveryLeaseToken",
                table: "UserNotifications",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeliveryLockedUntil",
                table: "UserNotifications",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeliveryProviderReference",
                table: "UserNotifications",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "NextDeliveryAt",
                table: "UserNotifications",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NotificationDeliveryAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NotificationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Outcome = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ErrorCode = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationDeliveryAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NotificationDeliveryAttempts_UserNotifications_Notification~",
                        column: x => x.NotificationId,
                        principalTable: "UserNotifications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserNotifications_DeliveryState_NextDeliveryAt",
                table: "UserNotifications",
                columns: new[] { "DeliveryState", "NextDeliveryAt" });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveryAttempts_NotificationId_Sequence",
                table: "NotificationDeliveryAttempts",
                columns: new[] { "NotificationId", "Sequence" },
                unique: true);
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION bhome_notification_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF (to_jsonb(NEW)-ARRAY['ReadAt','DeliveryState','DeliveryAttempts','NextDeliveryAt','DeliveryLockedUntil','DeliveryLeaseToken','DeliveryLastAttemptAt','DeliveryLastErrorCode','DeliveryProviderReference'])
                  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ReadAt','DeliveryState','DeliveryAttempts','NextDeliveryAt','DeliveryLockedUntil','DeliveryLeaseToken','DeliveryLastAttemptAt','DeliveryLastErrorCode','DeliveryProviderReference'])
                  THEN RAISE EXCEPTION 'Notification intent is immutable'; END IF; RETURN NEW; END; $$;
                CREATE TRIGGER notification_delivery_attempt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "NotificationDeliveryAttempts" FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationDeliveryAttempts") OR EXISTS(SELECT 1 FROM "UserNotifications" WHERE "DeliveryAttempts">0)
                  THEN RAISE EXCEPTION 'Preserve notification delivery history before rollback'; END IF; END $$;
                DROP TRIGGER notification_delivery_attempt_immutable ON "NotificationDeliveryAttempts";
                CREATE OR REPLACE FUNCTION bhome_notification_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF (to_jsonb(NEW)-'ReadAt'-'DeliveryState') IS DISTINCT FROM (to_jsonb(OLD)-'ReadAt'-'DeliveryState')
                  THEN RAISE EXCEPTION 'Notification intent is immutable'; END IF; RETURN NEW; END; $$;
                """);
            migrationBuilder.DropTable(
                name: "NotificationDeliveryAttempts");

            migrationBuilder.DropIndex(
                name: "IX_UserNotifications_DeliveryState_NextDeliveryAt",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "DeliveryAttempts",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "DeliveryLastAttemptAt",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "DeliveryLastErrorCode",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "DeliveryLeaseToken",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "DeliveryLockedUntil",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "DeliveryProviderReference",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "NextDeliveryAt",
                table: "UserNotifications");
        }
    }
}
