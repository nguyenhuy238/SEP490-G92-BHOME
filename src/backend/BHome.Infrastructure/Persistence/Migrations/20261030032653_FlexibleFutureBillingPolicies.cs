using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FlexibleFutureBillingPolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "FirstUsedAt",
                table: "BillingPolicies",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION bhome_policy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE business_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Policy history cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF (NEW."Id", NEW."LocationId", NEW."RoomTypeId", NEW."RoomId", NEW."Category", NEW."ChargeCode", NEW."CreatedAt")
                       IS DISTINCT FROM
                       (OLD."Id", OLD."LocationId", OLD."RoomTypeId", OLD."RoomId", OLD."Category", OLD."ChargeCode", OLD."CreatedAt") THEN
                        RAISE EXCEPTION 'Policy identity and scope are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."FirstUsedAt" IS NOT NULL AND NEW."FirstUsedAt" IS DISTINCT FROM OLD."FirstUsedAt" THEN
                        RAISE EXCEPTION 'Policy usage cannot be cleared or rewritten' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."FirstUsedAt" IS NULL AND NEW."FirstUsedAt" IS NOT NULL THEN
                        IF (to_jsonb(NEW) - ARRAY['FirstUsedAt','Version','UpdatedAt']) IS DISTINCT FROM
                           (to_jsonb(OLD) - ARRAY['FirstUsedAt','Version','UpdatedAt']) THEN
                            RAISE EXCEPTION 'Recording usage cannot rewrite policy terms' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."EffectiveFrom" > business_today AND OLD."FirstUsedAt" IS NULL THEN
                        IF NEW."EffectiveFrom" <= business_today THEN
                            RAISE EXCEPTION 'Future policy edits cannot take effect today or in the past' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF (to_jsonb(NEW) - ARRAY['EffectiveTo','Version','UpdatedAt']) IS DISTINCT FROM
                       (to_jsonb(OLD) - ARRAY['EffectiveTo','Version','UpdatedAt']) OR
                       NEW."EffectiveTo" IS NULL OR NEW."EffectiveTo" < business_today OR
                       (OLD."EffectiveTo" IS NOT NULL AND NEW."EffectiveTo" > OLD."EffectiveTo") THEN
                        RAISE EXCEPTION 'Create a new policy version; used or effective terms are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "BillingPolicies" WHERE "FirstUsedAt" IS NOT NULL) THEN
                        RAISE EXCEPTION 'Cannot drop recorded policy usage without an approved preservation plan';
                    END IF;
                END $$;
                CREATE OR REPLACE FUNCTION bhome_policy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
                """);
            migrationBuilder.DropColumn(
                name: "FirstUsedAt",
                table: "BillingPolicies");
        }
    }
}
