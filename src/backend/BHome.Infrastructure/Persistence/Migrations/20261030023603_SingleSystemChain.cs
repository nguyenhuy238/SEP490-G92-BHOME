using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SingleSystemChain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF (SELECT count(*) FROM "Chains") > 1 THEN
                        RAISE EXCEPTION 'Multiple Chains exist. An explicit project-owner consolidation decision is required.';
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM "Chains") THEN
                        INSERT INTO "Chains" ("Id", "Name", "CreatedAt", "UpdatedAt")
                        VALUES (gen_random_uuid(), 'BHOME', now(), now());
                    END IF;
                END $$;
                UPDATE "Locations" SET "ChainId" = (SELECT "Id" FROM "Chains") WHERE "ChainId" IS NULL;
                """);
            migrationBuilder.AlterColumn<Guid>(
                name: "LocationId",
                table: "PropertyChanges",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "ChainId",
                table: "Locations",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "Chains",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX "UX_Chains_Singleton" ON "Chains" ((true));
                CREATE FUNCTION bhome_system_chain_required() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'The system Chain cannot be deleted or replaced' USING ERRCODE = '23514';
                END $$;
                CREATE TRIGGER "TR_Chains_Required" BEFORE DELETE OR TRUNCATE ON "Chains"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_system_chain_required();
                CREATE TRIGGER "TR_Chains_Identity" BEFORE UPDATE OF "Id" ON "Chains"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_system_chain_required();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "PropertyChanges" WHERE "LocationId" IS NULL) THEN
                        RAISE EXCEPTION 'Cannot downgrade while global Chain audit history exists. Preserve/archive history under an approved rollback plan.';
                    END IF;
                END $$;
                DROP TRIGGER "TR_Chains_Identity" ON "Chains";
                DROP TRIGGER "TR_Chains_Required" ON "Chains";
                DROP FUNCTION bhome_system_chain_required();
                DROP INDEX "UX_Chains_Singleton";
                """);
            migrationBuilder.DropColumn(
                name: "Version",
                table: "Chains");

            migrationBuilder.AlterColumn<Guid>(
                name: "LocationId",
                table: "PropertyChanges",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ChainId",
                table: "Locations",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");
        }
    }
}
