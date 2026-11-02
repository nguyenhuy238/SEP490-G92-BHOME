using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PersistentNotificationInbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NotificationPublications",
                columns: table => new
                {
                    EventKey = table.Column<string>(type: "character varying(220)", maxLength: 220, nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RecipientCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationPublications", x => x.EventKey);
                });

            migrationBuilder.CreateTable(
                name: "UserNotifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AudienceRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: true),
                    Category = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Title = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Summary = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    RelatedObjectType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    RelatedObjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventKey = table.Column<string>(type: "character varying(220)", maxLength: 220, nullable: false),
                    SourceTaskNotificationId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeliveryState = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserNotifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserNotifications_AspNetUsers_RecipientUserId",
                        column: x => x.RecipientUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserNotifications_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserNotifications_OperationalTaskNotifications_SourceTaskNo~",
                        column: x => x.SourceTaskNotificationId,
                        principalTable: "OperationalTaskNotifications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserNotifications_LocationId",
                table: "UserNotifications",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_UserNotifications_RecipientUserId_EventKey",
                table: "UserNotifications",
                columns: new[] { "RecipientUserId", "EventKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserNotifications_RecipientUserId_ReadAt_CreatedAt",
                table: "UserNotifications",
                columns: new[] { "RecipientUserId", "ReadAt", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserNotifications_SourceTaskNotificationId",
                table: "UserNotifications",
                column: "SourceTaskNotificationId");
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_notification_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF (to_jsonb(NEW)-'ReadAt'-'DeliveryState') IS DISTINCT FROM (to_jsonb(OLD)-'ReadAt'-'DeliveryState')
                  THEN RAISE EXCEPTION 'Notification intent is immutable'; END IF; RETURN NEW; END; $$;
                CREATE TRIGGER notification_content_immutable BEFORE UPDATE ON "UserNotifications" FOR EACH ROW EXECUTE FUNCTION bhome_notification_content_immutable();
                CREATE TRIGGER notification_history_preserved BEFORE DELETE OR TRUNCATE ON "UserNotifications" FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();
                CREATE TRIGGER notification_publication_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "NotificationPublications" FOR EACH STATEMENT EXECUTE FUNCTION bhome_billing_plan_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM \"UserNotifications\") OR EXISTS(SELECT 1 FROM \"NotificationPublications\") THEN RAISE EXCEPTION 'Preserve notification history before rollback'; END IF; END $$; DROP TRIGGER notification_content_immutable ON \"UserNotifications\"; DROP TRIGGER notification_history_preserved ON \"UserNotifications\"; DROP FUNCTION bhome_notification_content_immutable(); DROP TRIGGER notification_publication_immutable ON \"NotificationPublications\";");
            migrationBuilder.DropTable(
                name: "NotificationPublications");

            migrationBuilder.DropTable(
                name: "UserNotifications");
        }
    }
}
