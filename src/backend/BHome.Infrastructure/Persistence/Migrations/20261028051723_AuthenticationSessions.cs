using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AuthenticationSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "AuthenticationSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SecurityStamp = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Device = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastActivityAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevocationReason = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuthenticationSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AuthenticationSessions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PasswordResetGrants",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PasswordResetGrants", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_PasswordResetGrants_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SecurityAudit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    TargetUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Event = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Succeeded = table.Column<bool>(type: "boolean", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SecurityAudit", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RefreshTokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReplacedByTokenId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RefreshTokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RefreshTokens_AuthenticationSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "AuthenticationSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RefreshTokens_RefreshTokens_ReplacedByTokenId",
                        column: x => x.ReplacedByTokenId,
                        principalTable: "RefreshTokens",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuthenticationSessions_UserId_RevokedAt",
                table: "AuthenticationSessions",
                columns: new[] { "UserId", "RevokedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PasswordResetGrants_TokenHash",
                table: "PasswordResetGrants",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_ReplacedByTokenId",
                table: "RefreshTokens",
                column: "ReplacedByTokenId");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_SessionId",
                table: "RefreshTokens",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_TokenHash",
                table: "RefreshTokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SecurityAudit_UserId_OccurredAt",
                table: "SecurityAudit",
                columns: new[] { "UserId", "OccurredAt" });

            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_security_audit_append_only() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'Security audit is append-only';
                END;
                $$;
                CREATE TRIGGER security_audit_append_only
                BEFORE UPDATE OR DELETE OR TRUNCATE ON "SecurityAudit"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_security_audit_append_only();

                CREATE FUNCTION bhome_account_security_changed() RETURNS trigger
                LANGUAGE plpgsql AS $$
                DECLARE event_name text;
                BEGIN
                    IF OLD."IsActive" IS DISTINCT FROM NEW."IsActive" THEN
                        event_name := CASE WHEN NEW."IsActive" THEN 'AccountActivated' ELSE 'AccountDeactivated' END;
                    ELSIF OLD."SecurityStamp" IS DISTINCT FROM NEW."SecurityStamp" THEN
                        event_name := 'SecurityStampChanged';
                    ELSIF OLD."TwoFactorEnabled" IS DISTINCT FROM NEW."TwoFactorEnabled" THEN
                        event_name := 'TwoFactorChanged';
                    ELSE RETURN NEW;
                    END IF;
                    IF NOT NEW."IsActive" OR OLD."SecurityStamp" IS DISTINCT FROM NEW."SecurityStamp"
                        OR OLD."TwoFactorEnabled" IS DISTINCT FROM NEW."TwoFactorEnabled" THEN
                        UPDATE "AuthenticationSessions" SET "RevokedAt" = clock_timestamp(), "RevocationReason" = event_name
                        WHERE "UserId" = NEW."Id" AND "RevokedAt" IS NULL;
                    END IF;
                    -- Direct DB/Identity management has no authenticated actor. Do not invent one.
                    INSERT INTO "SecurityAudit" ("Id", "TargetUserId", "Event", "Succeeded", "OccurredAt")
                    VALUES (gen_random_uuid(), NEW."Id", event_name, true, clock_timestamp());
                    RETURN NEW;
                END;
                $$;
                CREATE TRIGGER account_security_changed AFTER UPDATE ON "AspNetUsers"
                FOR EACH ROW EXECUTE FUNCTION bhome_account_security_changed();

                CREATE FUNCTION bhome_user_role_changed() RETURNS trigger
                LANGUAGE plpgsql AS $$
                DECLARE old_user uuid; new_user uuid; target uuid;
                BEGIN
                    IF TG_OP <> 'INSERT' THEN old_user := OLD."UserId"; END IF;
                    IF TG_OP <> 'DELETE' THEN new_user := NEW."UserId"; END IF;
                    FOR target IN SELECT DISTINCT id FROM unnest(ARRAY[old_user, new_user]) AS changed(id) WHERE id IS NOT NULL
                    LOOP
                        PERFORM 1 FROM "AspNetUsers" WHERE "Id" = target FOR UPDATE;
                        UPDATE "AuthenticationSessions" SET "RevokedAt" = clock_timestamp(), "RevocationReason" = 'RoleChanged'
                        WHERE "UserId" = target AND "RevokedAt" IS NULL;
                        INSERT INTO "SecurityAudit" ("Id", "TargetUserId", "Event", "Succeeded", "OccurredAt")
                        VALUES (gen_random_uuid(), target, 'RoleChanged', true, clock_timestamp());
                    END LOOP;
                    RETURN NULL;
                END;
                $$;
                CREATE TRIGGER user_role_changed AFTER INSERT OR UPDATE OR DELETE ON "AspNetUserRoles"
                FOR EACH ROW EXECUTE FUNCTION bhome_user_role_changed();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER user_role_changed ON "AspNetUserRoles";
                DROP FUNCTION bhome_user_role_changed();
                DROP TRIGGER account_security_changed ON "AspNetUsers";
                DROP FUNCTION bhome_account_security_changed();
                DROP TRIGGER security_audit_append_only ON "SecurityAudit";
                DROP FUNCTION bhome_security_audit_append_only();
                """);
            migrationBuilder.DropTable(
                name: "PasswordResetGrants");

            migrationBuilder.DropTable(
                name: "RefreshTokens");

            migrationBuilder.DropTable(
                name: "SecurityAudit");

            migrationBuilder.DropTable(
                name: "AuthenticationSessions");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "AspNetUsers");
        }
    }
}
