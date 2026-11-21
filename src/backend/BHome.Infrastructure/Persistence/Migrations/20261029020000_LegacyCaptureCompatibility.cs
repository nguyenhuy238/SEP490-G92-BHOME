using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations;

public partial class LegacyCaptureCompatibility : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DO $$
        DECLARE name text;
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261028103339_CaptureWorkflows') THEN
                RETURN;
            END IF;
            IF EXISTS (SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" IN
                ('20261029023111_LocationStaffAssignments', '20261029032454_CaptureWorkflowsMerged')) THEN
                RAISE EXCEPTION 'Mixed legacy/current migration history requires a reviewed recovery plan';
            END IF;
            IF to_regnamespace('legacy_capture_20261028') IS NOT NULL THEN
                RAISE EXCEPTION 'Legacy archive already exists; inspect recovery state before retry';
            END IF;
            IF (SELECT count(*) FROM "Chains") > 1 THEN
                RAISE EXCEPTION 'Multiple legacy Chains require an approved consolidation decision';
            END IF;
            -- Legacy assignments have no recorded creator. Never invent an audit actor or deadline.
            IF EXISTS (SELECT 1 FROM "StaffLocationAssignments") THEN
                RAISE EXCEPTION 'Legacy Staff assignments require an approved creator/date mapping';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'AspNetUsers' AND column_name = 'ManagingOwnerId') THEN
                RAISE EXCEPTION 'Legacy identity schema does not match the supported migration';
            END IF;
            CREATE SCHEMA legacy_capture_20261028;
            FOREACH name IN ARRAY ARRAY['Chains','Locations','Rooms','StaffLocationAssignments',
                'Residents','Meters','OperationalTasks','MeterEvidence','MeterReadings'] LOOP
                EXECUTE format('ALTER TABLE public.%I SET SCHEMA legacy_capture_20261028', name);
            END LOOP;
            -- Authentication, roles, sessions and append-only SecurityAudit stay in place.
            -- Preserve the original historical migration record and every archived row/column.
        END $$;
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DO $$ BEGIN
            IF to_regnamespace('legacy_capture_20261028') IS NOT NULL THEN
                RAISE EXCEPTION 'Legacy upgrade rollback requires a reviewed data-preserving recovery plan';
            END IF;
        END $$;
        """);
}
