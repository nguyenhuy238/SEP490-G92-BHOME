using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractExpiryNotices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ContractExpiryNotices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientId = table.Column<Guid>(type: "uuid", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Stage = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractExpiryNotices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractExpiryNotices_AspNetUsers_RecipientId",
                        column: x => x.RecipientId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractExpiryNotices_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_Status_EndDate_Id",
                table: "Contracts",
                columns: new[] { "Status", "EndDate", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_ContractExpiryNotices_ContractId_EndDate_Stage_RecipientId",
                table: "ContractExpiryNotices",
                columns: new[] { "ContractId", "EndDate", "Stage", "RecipientId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractExpiryNotices_RecipientId_CreatedAt",
                table: "ContractExpiryNotices",
                columns: new[] { "RecipientId", "CreatedAt" });
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_contract_expiry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Contract expiry notices are append-only'; END; $$;
                CREATE TRIGGER contract_expiry_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "ContractExpiryNotices"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_contract_expiry_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS (SELECT 1 FROM "ContractExpiryNotices") THEN RAISE EXCEPTION 'Preserve expiry notice history before rollback'; END IF; END; $$;
                DROP TRIGGER contract_expiry_immutable ON "ContractExpiryNotices";
                DROP FUNCTION bhome_contract_expiry_immutable();
                """);
            migrationBuilder.DropTable(
                name: "ContractExpiryNotices");

            migrationBuilder.DropIndex(
                name: "IX_Contracts_Status_EndDate_Id",
                table: "Contracts");
        }
    }
}
