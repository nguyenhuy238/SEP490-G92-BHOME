using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractMoveInHandover : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ContractHandoverHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractHandoverHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractHandoverHistory_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractHandoverHistory_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContractHandovers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    TenantConfirmedVersion = table.Column<int>(type: "integer", nullable: true),
                    TenantConfirmedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    TenantConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    StaffConfirmedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    StaffConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractHandovers", x => x.Id);
                    table.CheckConstraint("CK_ContractHandover_State", "\"Version\" > 0 AND \"Status\" BETWEEN 0 AND 2 AND (\"TenantConfirmedVersion\" IS NULL OR \"TenantConfirmedVersion\" = \"Version\") AND (\"Status\" <> 2 OR (\"TenantConfirmedVersion\" = \"Version\" AND \"TenantConfirmedAt\" IS NOT NULL AND \"StaffConfirmedAt\" IS NOT NULL AND \"TenantConfirmedBy\" IS NOT NULL AND \"StaffConfirmedBy\" IS NOT NULL))");
                    table.ForeignKey(
                        name: "FK_ContractHandovers_AspNetUsers_StaffConfirmedBy",
                        column: x => x.StaffConfirmedBy,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractHandovers_AspNetUsers_TenantConfirmedBy",
                        column: x => x.TenantConfirmedBy,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractHandovers_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandoverHistory_ActorId",
                table: "ContractHandoverHistory",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandoverHistory_ContractId_OccurredAt",
                table: "ContractHandoverHistory",
                columns: new[] { "ContractId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandovers_ContractId",
                table: "ContractHandovers",
                column: "ContractId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandovers_StaffConfirmedBy",
                table: "ContractHandovers",
                column: "StaffConfirmedBy");

            migrationBuilder.CreateIndex(
                name: "IX_ContractHandovers_TenantConfirmedBy",
                table: "ContractHandovers",
                column: "TenantConfirmedBy");
            migrationBuilder.Sql("""
                CREATE FUNCTION contract_handover_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_TABLE_NAME = 'ContractHandoverHistory' THEN RAISE EXCEPTION 'Handover history is append-only'; END IF;
                  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Handover baseline cannot be deleted'; END IF;
                  IF OLD."Status" = 2 AND (to_jsonb(NEW) - 'UpdatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'UpdatedAt') THEN
                    RAISE EXCEPTION 'Confirmed handover baseline is immutable';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER handover_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "ContractHandoverHistory"
                  FOR EACH STATEMENT EXECUTE FUNCTION contract_handover_immutable();
                CREATE TRIGGER handover_confirmed_immutable BEFORE UPDATE OR DELETE ON "ContractHandovers"
                  FOR EACH ROW EXECUTE FUNCTION contract_handover_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "ContractHandovers") OR EXISTS (SELECT 1 FROM "ContractHandoverHistory") THEN
                    RAISE EXCEPTION 'Rollback would discard move-in handover evidence';
                  END IF;
                END $$;
                DROP TRIGGER handover_history_immutable ON "ContractHandoverHistory";
                DROP TRIGGER handover_confirmed_immutable ON "ContractHandovers";
                DROP FUNCTION contract_handover_immutable();
                """);
            migrationBuilder.DropTable(
                name: "ContractHandoverHistory");

            migrationBuilder.DropTable(
                name: "ContractHandovers");
        }
    }
}
