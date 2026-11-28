using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PropertyConfiguration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Capacity",
                table: "Rooms",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "Floor",
                table: "Rooms",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RoomTypeId",
                table: "Rooms",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Status",
                table: "Rooms",
                type: "integer",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "Rooms",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "Locations",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Rooms_Id_LocationId",
                table: "Rooms",
                columns: new[] { "Id", "LocationId" });

            migrationBuilder.CreateTable(
                name: "Assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    CommonArea = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Category = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Condition = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assets", x => x.Id);
                    table.CheckConstraint("CK_Asset_Scope", "(\"RoomId\" IS NOT NULL AND \"CommonArea\" IS NULL) OR (\"RoomId\" IS NULL AND \"CommonArea\" IS NOT NULL AND length(trim(\"CommonArea\")) > 0)");
                    table.CheckConstraint("CK_Asset_Status", "\"Status\" BETWEEN 0 AND 3");
                    table.ForeignKey(
                        name: "FK_Assets_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Assets_Rooms_RoomId_LocationId",
                        columns: x => new { x.RoomId, x.LocationId },
                        principalTable: "Rooms",
                        principalColumns: new[] { "Id", "LocationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PropertyChanges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Before = table.Column<string>(type: "jsonb", nullable: true),
                    After = table.Column<string>(type: "jsonb", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PropertyChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PropertyChanges_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PropertyChanges_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RoomTypes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    DefaultCapacity = table.Column<int>(type: "integer", nullable: false),
                    AreaM2 = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    Amenities = table.Column<string[]>(type: "text[]", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoomTypes", x => x.Id);
                    table.UniqueConstraint("AK_RoomTypes_Id_LocationId", x => new { x.Id, x.LocationId });
                    table.CheckConstraint("CK_RoomType_Values", "\"DefaultCapacity\" BETWEEN 1 AND 32767 AND (\"AreaM2\" IS NULL OR \"AreaM2\" > 0)");
                    table.ForeignKey(
                        name: "FK_RoomTypes_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BillingPolicies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: true),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    ChargeCode = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Method = table.Column<int>(type: "integer", nullable: false),
                    Rate = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    EffectiveTo = table.Column<DateOnly>(type: "date", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingPolicies", x => x.Id);
                    table.CheckConstraint("CK_Policy_Method", "(\"Category\" = 0 AND \"Method\" = 0 AND \"ChargeCode\" = 'RENT') OR (\"Category\" = 1 AND \"Method\" = 1 AND \"ChargeCode\" = 'ELECTRICITY') OR (\"Category\" = 2 AND \"Method\" = 1 AND \"ChargeCode\" = 'WATER') OR (\"Category\" = 3 AND \"Method\" = 0 AND \"ChargeCode\" NOT IN ('RENT', 'ELECTRICITY', 'WATER'))");
                    table.CheckConstraint("CK_Policy_Values", "\"Rate\" >= 0 AND (\"EffectiveTo\" IS NULL OR \"EffectiveTo\" >= \"EffectiveFrom\") AND NOT (\"RoomId\" IS NOT NULL AND \"RoomTypeId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_BillingPolicies_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillingPolicies_RoomTypes_RoomTypeId_LocationId",
                        columns: x => new { x.RoomTypeId, x.LocationId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "Id", "LocationId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillingPolicies_Rooms_RoomId_LocationId",
                        columns: x => new { x.RoomId, x.LocationId },
                        principalTable: "Rooms",
                        principalColumns: new[] { "Id", "LocationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Rooms_RoomTypeId_LocationId",
                table: "Rooms",
                columns: new[] { "RoomTypeId", "LocationId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Room_Values",
                table: "Rooms",
                sql: "\"Capacity\" BETWEEN 1 AND 32767 AND \"Status\" BETWEEN 0 AND 3");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_LocationId",
                table: "Assets",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_RoomId_LocationId",
                table: "Assets",
                columns: new[] { "RoomId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_BillingPolicies_LocationId_ChargeCode_EffectiveFrom",
                table: "BillingPolicies",
                columns: new[] { "LocationId", "ChargeCode", "EffectiveFrom" });

            migrationBuilder.CreateIndex(
                name: "IX_BillingPolicies_RoomId_LocationId",
                table: "BillingPolicies",
                columns: new[] { "RoomId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_BillingPolicies_RoomTypeId_LocationId",
                table: "BillingPolicies",
                columns: new[] { "RoomTypeId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_PropertyChanges_ActorId",
                table: "PropertyChanges",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_PropertyChanges_LocationId",
                table: "PropertyChanges",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_PropertyChanges_TargetId_OccurredAt",
                table: "PropertyChanges",
                columns: new[] { "TargetId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomTypes_LocationId",
                table: "RoomTypes",
                column: "LocationId");

            migrationBuilder.AddForeignKey(
                name: "FK_Rooms_RoomTypes_RoomTypeId_LocationId",
                table: "Rooms",
                columns: new[] { "RoomTypeId", "LocationId" },
                principalTable: "RoomTypes",
                principalColumns: new[] { "Id", "LocationId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX "UX_Rooms_NormalizedNumber" ON "Rooms" ("LocationId", upper(btrim("RoomNumber")));
                CREATE UNIQUE INDEX "UX_RoomTypes_NormalizedName" ON "RoomTypes" ("LocationId", upper(btrim("Name")));
                CREATE UNIQUE INDEX "UX_Assets_NormalizedCode" ON "Assets" ("LocationId", upper(btrim("Code"))) WHERE "Code" IS NOT NULL;

                CREATE EXTENSION IF NOT EXISTS btree_gist;
                ALTER TABLE "BillingPolicies" ADD CONSTRAINT "EX_Policy_Scope_Charge_Period"
                EXCLUDE USING gist (
                    "LocationId" WITH =,
                    (COALESCE("RoomTypeId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
                    (COALESCE("RoomId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
                    "ChargeCode" WITH =,
                    daterange("EffectiveFrom", "EffectiveTo", '[]') WITH &&
                ) DEFERRABLE INITIALLY DEFERRED;

                CREATE FUNCTION bhome_property_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'Property history is append-only' USING ERRCODE = '23514';
                END $$;
                CREATE TRIGGER "TR_PropertyChanges_Immutable" BEFORE UPDATE OR DELETE OR TRUNCATE
                ON "PropertyChanges" FOR EACH STATEMENT EXECUTE FUNCTION bhome_property_history_immutable();

                CREATE FUNCTION bhome_policy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Policy history cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF (to_jsonb(NEW) - ARRAY['EffectiveTo','Version','UpdatedAt']) IS DISTINCT FROM
                       (to_jsonb(OLD) - ARRAY['EffectiveTo','Version','UpdatedAt']) OR
                       NEW."EffectiveTo" IS NULL OR NEW."EffectiveTo" < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date OR
                       (OLD."EffectiveTo" IS NOT NULL AND NEW."EffectiveTo" > OLD."EffectiveTo") THEN
                        RAISE EXCEPTION 'Create a new policy version; historical terms are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER "TR_BillingPolicies_History" BEFORE UPDATE OR DELETE ON "BillingPolicies"
                FOR EACH ROW EXECUTE FUNCTION bhome_policy_history_guard();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER "TR_PropertyChanges_Immutable" ON "PropertyChanges";
                DROP FUNCTION bhome_property_history_immutable();
                DROP TRIGGER "TR_BillingPolicies_History" ON "BillingPolicies";
                DROP FUNCTION bhome_policy_history_guard();
                DROP INDEX "UX_Rooms_NormalizedNumber";
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_Rooms_RoomTypes_RoomTypeId_LocationId",
                table: "Rooms");

            migrationBuilder.DropTable(
                name: "Assets");

            migrationBuilder.DropTable(
                name: "BillingPolicies");

            migrationBuilder.DropTable(
                name: "PropertyChanges");

            migrationBuilder.DropTable(
                name: "RoomTypes");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Rooms_Id_LocationId",
                table: "Rooms");

            migrationBuilder.DropIndex(
                name: "IX_Rooms_RoomTypeId_LocationId",
                table: "Rooms");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Room_Values",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Capacity",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Floor",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "RoomTypeId",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Locations");
        }
    }
}
