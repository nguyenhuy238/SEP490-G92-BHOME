using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CiManualBankStatementEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StatementEvidenceContentType",
                table: "PaymentTransfers",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "StatementEvidenceLength",
                table: "PaymentTransfers",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatementEvidenceObjectKey",
                table: "PaymentTransfers",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatementEvidenceSha256",
                table: "PaymentTransfers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StatementEvidenceContentType",
                table: "PaymentTransfers");

            migrationBuilder.DropColumn(
                name: "StatementEvidenceLength",
                table: "PaymentTransfers");

            migrationBuilder.DropColumn(
                name: "StatementEvidenceObjectKey",
                table: "PaymentTransfers");

            migrationBuilder.DropColumn(
                name: "StatementEvidenceSha256",
                table: "PaymentTransfers");
        }
    }
}
