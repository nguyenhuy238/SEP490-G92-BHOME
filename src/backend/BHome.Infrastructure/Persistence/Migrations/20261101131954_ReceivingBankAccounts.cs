using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ReceivingBankAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReceivingBankAccounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    BankIdentifier = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    AccountNumber = table.Column<string>(type: "character varying(19)", maxLength: 19, nullable: false),
                    AccountHolder = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    IsDevelopmentDemo = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    ConfirmedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceivingBankAccounts", x => x.Id);
                    table.CheckConstraint("CK_ReceivingBankAccount_Format", "\"BankIdentifier\" ~ '^[0-9]{6}$' AND \"AccountNumber\" ~ '^[0-9]{6,19}$' AND \"AccountHolder\" ~ '^[A-Z0-9 ]{5,50}$' AND \"Version\" > 0");
                    table.ForeignKey(
                        name: "FK_ReceivingBankAccounts_AspNetUsers_ConfirmedByUserId",
                        column: x => x.ConfirmedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReceivingBankAccounts_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReceivingBankAccounts_ConfirmedByUserId",
                table: "ReceivingBankAccounts",
                column: "ConfirmedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ReceivingBankAccounts_LocationId_Version",
                table: "ReceivingBankAccounts",
                columns: new[] { "LocationId", "Version" },
                unique: true);
            migrationBuilder.Sql("""
                CREATE TRIGGER receiving_accounts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "ReceivingBankAccounts"
                  FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS (SELECT 1 FROM "ReceivingBankAccounts") THEN
                  RAISE EXCEPTION 'Receiving account configuration history exists; refusing destructive rollback'; END IF; END $$;
                """);
            migrationBuilder.DropTable(
                name: "ReceivingBankAccounts");
        }
    }
}
