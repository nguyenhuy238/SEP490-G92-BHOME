using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PersistBillingSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UtilityCalculationSnapshot",
                table: "InvoiceLines",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AgreedPriceSnapshot",
                table: "Contracts",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.AddColumn<string>(
                name: "PriceLockTrigger",
                table: "Contracts",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PriceLockedAt",
                table: "Contracts",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UtilityCalculationSnapshot",
                table: "InvoiceLines");

            migrationBuilder.DropColumn(
                name: "AgreedPriceSnapshot",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "PriceLockTrigger",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "PriceLockedAt",
                table: "Contracts");
        }
    }
}
