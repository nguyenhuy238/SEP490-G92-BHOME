using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FinalInvoiceAdjustmentBalances : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "PaidAtDecision",
                table: "InvoiceAdjustmentDecisions",
                type: "numeric(28,0)",
                precision: 28,
                scale: 0,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(18,0)",
                oldPrecision: 18);
            migrationBuilder.Sql(PaymentValidation(true));
            migrationBuilder.Sql(DecisionValidation(true));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS (SELECT 1 FROM "InvoiceAdjustmentDecisions" WHERE "InvoiceStatus" = 1 AND "Outcome" = 'Approved') THEN
                  RAISE EXCEPTION 'Final adjustment effects exist; balance rollback refused'; END IF; END $$;
                """);
            migrationBuilder.Sql(PaymentValidation(false));
            migrationBuilder.Sql(DecisionValidation(false));
            migrationBuilder.AlterColumn<decimal>(
                name: "PaidAtDecision",
                table: "InvoiceAdjustmentDecisions",
                type: "numeric(18,0)",
                precision: 18,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(28,0)",
                oldPrecision: 28,
                oldScale: 0);
        }
        private static string PaymentValidation(bool adjusted) => $$"""
            CREATE OR REPLACE FUNCTION bhome_invoice_payment_validate() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE invoice_total numeric; state integer; credited numeric; incoming numeric;
            BEGIN
              PERFORM 1 FROM "Rooms" room JOIN "Invoices" bill ON bill."RoomId" = room."Id"
                WHERE bill."Id" = NEW."InvoiceId" FOR UPDATE OF room;
              SELECT "Total" + {{(adjusted ? "COALESCE((SELECT SUM(d.\"Delta\") FROM \"InvoiceAdjustmentDecisions\" d WHERE d.\"InvoiceId\" = NEW.\"InvoiceId\" AND d.\"InvoiceStatus\" = 1 AND d.\"Outcome\" = 'Approved'),0)" : "0")}}, "Status"
                INTO invoice_total, state FROM "Invoices" WHERE "Id" = NEW."InvoiceId";
              SELECT "Amount" INTO incoming FROM "PaymentTransfers" WHERE "Id" = NEW."TransferId";
              SELECT COALESCE(SUM("Amount"),0) INTO credited FROM "PaymentAllocations" WHERE "InvoiceId" = NEW."InvoiceId";
              IF state IS DISTINCT FROM 1 OR NEW."Amount" IS DISTINCT FROM incoming OR NEW."Amount" <> invoice_total - credited OR NEW."Amount" <= 0 THEN
                RAISE EXCEPTION 'Only verified exact outstanding Final Invoice payment is allowed' USING ERRCODE = '23514';
              END IF;
              IF NEW."PaidByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InvoiceRecipients" WHERE "InvoiceId" = NEW."InvoiceId" AND "TenantUserId" = NEW."PaidByUserId") THEN
                RAISE EXCEPTION 'Payer is outside invoice entitlement' USING ERRCODE = '23514';
              END IF;
              IF EXISTS (SELECT 1 FROM "PaymentReconciliations" WHERE "TransferId" = NEW."TransferId" AND "Decision" = 'Rejected') THEN
                RAISE EXCEPTION 'Rejected transfer cannot be allocated' USING ERRCODE = '23514';
              END IF;
              RETURN NEW;
            END $$;
            """;
        private static string DecisionValidation(bool finalBalances) => $$"""
            CREATE OR REPLACE FUNCTION bhome_adjustment_decision_validate() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE effective numeric; paid numeric; basis numeric; state integer;
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM "InvoiceAdjustmentRequests" r WHERE r."Id" = NEW."RequestId" AND r."InvoiceId" = NEW."InvoiceId") THEN
                RAISE EXCEPTION 'Decision must belong to its request invoice' USING ERRCODE = '23514';
              END IF;
              IF NEW."Outcome" = 'Approved' AND NEW."InvoiceStatus" = 0 AND (NEW."ChargeCode" IS NULL OR length(NEW."SourceFingerprint") <> 64) THEN
                RAISE EXCEPTION 'Draft correction needs a charge and source snapshot' USING ERRCODE = '23514';
              END IF;
              {{(finalBalances ? """
              IF NEW."Outcome" = 'Approved' AND NEW."InvoiceStatus" = 1 THEN
                PERFORM 1 FROM "Rooms" room JOIN "Invoices" bill ON bill."RoomId" = room."Id" WHERE bill."Id" = NEW."InvoiceId" FOR UPDATE OF room;
                SELECT "Total", "Status" INTO effective, state FROM "Invoices" WHERE "Id" = NEW."InvoiceId";
                IF state IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM "InvoiceAdjustmentRequests" WHERE "Id" = NEW."RequestId" AND "InvoiceStatus" = 1) THEN
                  RAISE EXCEPTION 'Invoice stage changed' USING ERRCODE = '23514';
                END IF;
                SELECT effective + COALESCE(SUM("Delta"),0) INTO effective FROM "InvoiceAdjustmentDecisions"
                  WHERE "InvoiceId" = NEW."InvoiceId" AND "InvoiceStatus" = 1 AND "Outcome" = 'Approved';
                SELECT COALESCE(SUM("Amount"),0) INTO paid FROM "PaymentAllocations" WHERE "InvoiceId" = NEW."InvoiceId";
                basis := effective;
                IF NEW."ChargeCode" IS NOT NULL THEN
                  SELECT l."Amount" + COALESCE((SELECT SUM(d."Delta") FROM "InvoiceAdjustmentDecisions" d
                    WHERE d."InvoiceId" = NEW."InvoiceId" AND d."ChargeCode" = NEW."ChargeCode" AND d."InvoiceStatus" = 1 AND d."Outcome" = 'Approved'),0)
                    INTO basis FROM "InvoiceLines" l WHERE l."InvoiceId" = NEW."InvoiceId" AND l."ChargeCode" = NEW."ChargeCode";
                END IF;
                IF basis IS NULL OR NEW."BeforeAmount" IS DISTINCT FROM basis OR NEW."EffectiveBefore" IS DISTINCT FROM effective OR NEW."PaidAtDecision" IS DISTINCT FROM paid THEN
                  RAISE EXCEPTION 'Stale adjustment financial basis' USING ERRCODE = '23514';
                END IF;
              END IF;
              """ : "")}}
              RETURN NEW;
            END $$;
            """;
    }
}
