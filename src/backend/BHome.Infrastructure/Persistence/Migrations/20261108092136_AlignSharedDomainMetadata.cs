using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AlignSharedDomainMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "Channels",
                table: "UserNotifications",
                type: "text[]",
                nullable: false,
                defaultValue: new string[0]);

            migrationBuilder.AddColumn<string>(
                name: "EventType",
                table: "UserNotifications",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Priority",
                table: "UserNotifications",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "UserNotifications",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "OutstandingAmount",
                table: "PaymentConfirmedEvents",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PaidAmount",
                table: "PaymentConfirmedEvents",
                type: "numeric",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Channels",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "EventType",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "Priority",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "OutstandingAmount",
                table: "PaymentConfirmedEvents");

            migrationBuilder.DropColumn(
                name: "PaidAmount",
                table: "PaymentConfirmedEvents");
        }
    }
}
