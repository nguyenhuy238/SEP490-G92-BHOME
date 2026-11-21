using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractWorkflowDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TenantUserId",
                table: "Residents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDevelopmentDemo",
                table: "Contracts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "ContractDocumentFiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    SnapshotHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TemplateId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    TemplateVersion = table.Column<int>(type: "integer", nullable: true),
                    DevelopmentOnly = table.Column<bool>(type: "boolean", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    FileHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractDocumentFiles", x => x.Id);
                    table.CheckConstraint("CK_ContractDocumentFile_Length", "\"Length\" > 0 AND \"Length\" <= 10485760");
                    table.ForeignKey(
                        name: "FK_ContractDocumentFiles_AspNetUsers_RecordedByUserId",
                        column: x => x.RecordedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractDocumentFiles_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Residents_TenantUserId",
                table: "Residents",
                column: "TenantUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractDocumentFiles_ContractId_SnapshotHash_TemplateId_Te~",
                table: "ContractDocumentFiles",
                columns: new[] { "ContractId", "SnapshotHash", "TemplateId", "TemplateVersion" },
                unique: true,
                filter: "\"Kind\" = 0");

            migrationBuilder.CreateIndex(
                name: "IX_ContractDocumentFiles_ObjectKey",
                table: "ContractDocumentFiles",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractDocumentFiles_RecordedByUserId",
                table: "ContractDocumentFiles",
                column: "RecordedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Residents_AspNetUsers_TenantUserId",
                table: "Residents",
                column: "TenantUserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql("""
                CREATE FUNCTION contract_workflow_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_TABLE_NAME = 'Contracts' THEN
                    IF NEW."IsDevelopmentDemo" IS DISTINCT FROM OLD."IsDevelopmentDemo" THEN
                      RAISE EXCEPTION 'Contract signing mode is immutable';
                    END IF;
                    RETURN NEW;
                  END IF;
                  RAISE EXCEPTION 'Contract document evidence is append-only';
                END $$;
                CREATE TRIGGER contract_mode_immutable BEFORE UPDATE ON "Contracts"
                  FOR EACH ROW EXECUTE FUNCTION contract_workflow_immutable();
                CREATE TRIGGER contract_document_immutable BEFORE UPDATE OR DELETE ON "ContractDocumentFiles"
                  FOR EACH ROW EXECUTE FUNCTION contract_workflow_immutable();
                CREATE FUNCTION contract_simulation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE demo boolean;
                BEGIN
                  SELECT "IsDevelopmentDemo" INTO demo FROM "Contracts" WHERE "Id" = NEW."ContractId";
                  IF (NEW."Status" = 6 AND NOT demo) OR (NEW."Status" = 3 AND demo) THEN
                    RAISE EXCEPTION 'Signature result does not match contract signing mode';
                  END IF;
                  IF TG_OP = 'UPDATE' AND OLD."Status" = 6 AND NEW IS DISTINCT FROM OLD THEN
                    RAISE EXCEPTION 'Completed simulation evidence is immutable';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER contract_simulation_guard BEFORE INSERT OR UPDATE ON "ContractSignatures"
                  FOR EACH ROW EXECUTE FUNCTION contract_simulation_guard();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "ContractDocumentFiles")
                     OR EXISTS (SELECT 1 FROM "Contracts" WHERE "IsDevelopmentDemo")
                     OR EXISTS (SELECT 1 FROM "Residents" WHERE "TenantUserId" IS NOT NULL) THEN
                    RAISE EXCEPTION 'Rollback would discard contract workflow data; export and resolve it first';
                  END IF;
                END $$;
                DROP TRIGGER contract_simulation_guard ON "ContractSignatures";
                DROP FUNCTION contract_simulation_guard();
                DROP TRIGGER contract_document_immutable ON "ContractDocumentFiles";
                DROP TRIGGER contract_mode_immutable ON "Contracts";
                DROP FUNCTION contract_workflow_immutable();
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_Residents_AspNetUsers_TenantUserId",
                table: "Residents");

            migrationBuilder.DropTable(
                name: "ContractDocumentFiles");

            migrationBuilder.DropIndex(
                name: "IX_Residents_TenantUserId",
                table: "Residents");

            migrationBuilder.DropColumn(
                name: "TenantUserId",
                table: "Residents");

            migrationBuilder.DropColumn(
                name: "IsDevelopmentDemo",
                table: "Contracts");
        }
    }
}
