using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MainTenancyDraftPreparation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContractSettings",
                table: "Locations",
                type: "jsonb",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AlterColumn<Guid>(
                name: "TenantUserId",
                table: "Contracts",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "DraftMetadata",
                table: "Contracts",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.AddColumn<int>(
                name: "DraftVersion",
                table: "Contracts",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Contract_TenantForLifecycle",
                table: "Contracts",
                sql: "\"Status\" IN (0,6) OR \"TenantUserId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "Contracts" WHERE "TenantUserId" IS NULL) THEN
                    RAISE EXCEPTION 'Cannot downgrade while unlinked tenancy drafts exist. Preserve or explicitly resolve those drafts first.';
                  END IF;
                END $$;
                """);
            migrationBuilder.DropCheckConstraint(
                name: "CK_Contract_TenantForLifecycle",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "ContractSettings",
                table: "Locations");

            migrationBuilder.DropColumn(
                name: "DraftMetadata",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "DraftVersion",
                table: "Contracts");

            migrationBuilder.AlterColumn<Guid>(
                name: "TenantUserId",
                table: "Contracts",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
