using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractHandoverConfirmationInvariant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ContractHandover_State",
                table: "ContractHandovers");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ContractHandover_State",
                table: "ContractHandovers",
                sql: "\"Version\" > 0 AND \"Status\" BETWEEN 0 AND 2 AND (\"TenantConfirmedVersion\" IS NULL OR \"TenantConfirmedVersion\" = \"Version\") AND (\"Status\" <> 2 OR (\"TenantConfirmedVersion\" IS NOT NULL AND \"TenantConfirmedVersion\" = \"Version\" AND \"TenantConfirmedAt\" IS NOT NULL AND \"StaffConfirmedAt\" IS NOT NULL AND \"TenantConfirmedBy\" IS NOT NULL AND \"StaffConfirmedBy\" IS NOT NULL))");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ContractHandover_State",
                table: "ContractHandovers");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ContractHandover_State",
                table: "ContractHandovers",
                sql: "\"Version\" > 0 AND \"Status\" BETWEEN 0 AND 2 AND (\"TenantConfirmedVersion\" IS NULL OR \"TenantConfirmedVersion\" = \"Version\") AND (\"Status\" <> 2 OR (\"TenantConfirmedVersion\" = \"Version\" AND \"TenantConfirmedAt\" IS NOT NULL AND \"StaffConfirmedAt\" IS NOT NULL AND \"TenantConfirmedBy\" IS NOT NULL AND \"StaffConfirmedBy\" IS NOT NULL))");
        }
    }
}
