using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations;

public partial class ImportLegacyCapture : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DO $$
        DECLARE name text; columns text; before_count bigint; after_count bigint;
        BEGIN
            IF to_regnamespace('legacy_capture_20261028') IS NULL THEN RETURN; END IF;
            IF NOT EXISTS (SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261028103339_CaptureWorkflows') THEN
                RAISE EXCEPTION 'Legacy archive without the matching migration history';
            END IF;
            FOREACH name IN ARRAY ARRAY['Chains','Locations','Rooms','Meters','Residents',
                'OperationalTasks','MeterEvidence','MeterReadings'] LOOP
                EXECUTE format('SELECT count(*) FROM public.%I', name) INTO after_count;
                IF after_count <> 0 THEN RAISE EXCEPTION 'Destination table must be empty before legacy import: %', name; END IF;
                SELECT string_agg(format('%I', current.column_name), ', ' ORDER BY current.ordinal_position)
                INTO columns FROM information_schema.columns current
                JOIN information_schema.columns old ON old.table_schema = 'legacy_capture_20261028'
                    AND old.table_name = current.table_name AND old.column_name = current.column_name
                WHERE current.table_schema = 'public' AND current.table_name = name;
                EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM legacy_capture_20261028.%I', name, columns, columns, name);
                EXECUTE format('SELECT count(*) FROM legacy_capture_20261028.%I', name) INTO before_count;
                EXECUTE format('SELECT count(*) FROM public.%I', name) INTO after_count;
                IF before_count <> after_count THEN RAISE EXCEPTION 'Legacy import count mismatch: %', name; END IF;
            END LOOP;
            UPDATE "AspNetUsers" SET "LegacyManagedByOwnerUserId" = "ManagingOwnerId";
            UPDATE "Locations" location SET "LegacyOwnerUserId" = chain."OwnerUserId"
            FROM legacy_capture_20261028."Chains" chain WHERE location."ChainId" = chain."Id";
            -- The archive remains private and unchanged for recovery and provenance.
            -- No Active contract, occupancy, assignment, signing or financial evidence is inferred.
        END $$;
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DO $$ BEGIN
            IF to_regnamespace('legacy_capture_20261028') IS NOT NULL THEN
                RAISE EXCEPTION 'Legacy import cannot be downgraded without an approved recovery plan';
            END IF;
        END $$;
        """);
}
