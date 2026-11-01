using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ImmutableFinalInvoices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_invoice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_OP = 'INSERT' THEN
                    IF NEW."Status" = 1 THEN RAISE EXCEPTION 'Create Draft before finalizing' USING ERRCODE = '23514'; END IF;
                    RETURN NEW;
                  END IF;
                  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Invoice history cannot be deleted' USING ERRCODE = '23514'; END IF;
                  IF OLD."Status" = 1 AND NEW IS DISTINCT FROM OLD THEN
                    RAISE EXCEPTION 'Final invoice is immutable' USING ERRCODE = '23514';
                  END IF;
                  IF NEW."Status" = 1 AND (NOT EXISTS (SELECT 1 FROM "InvoiceLines" WHERE "InvoiceId" = NEW."Id") OR
                      NEW."Total" <> (SELECT SUM("Amount") FROM "InvoiceLines" WHERE "InvoiceId" = NEW."Id") OR
                      NOT EXISTS (SELECT 1 FROM "InvoiceRecipients" WHERE "InvoiceId" = NEW."Id")) THEN
                    RAISE EXCEPTION 'Final invoice requires reconciled lines and recipients' USING ERRCODE = '23514';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER invoice_immutable BEFORE INSERT OR UPDATE OR DELETE ON "Invoices"
                  FOR EACH ROW EXECUTE FUNCTION bhome_invoice_immutable();
                CREATE FUNCTION bhome_invoice_child_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE invoice_id uuid;
                BEGIN
                  IF TG_OP = 'DELETE' THEN invoice_id := OLD."InvoiceId"; ELSE invoice_id := NEW."InvoiceId"; END IF;
                  IF EXISTS (SELECT 1 FROM "Invoices" WHERE "Id" = invoice_id AND "Status" = 1) OR
                     (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "Invoices" WHERE "Id" = OLD."InvoiceId" AND "Status" = 1)) THEN
                    RAISE EXCEPTION 'Final invoice charges and recipients are immutable' USING ERRCODE = '23514';
                  END IF;
                  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
                END $$;
                CREATE TRIGGER invoice_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLines"
                  FOR EACH ROW EXECUTE FUNCTION bhome_invoice_child_immutable();
                CREATE TRIGGER invoice_recipients_immutable BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceRecipients"
                  FOR EACH ROW EXECUTE FUNCTION bhome_invoice_child_immutable();
                CREATE FUNCTION bhome_invoice_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Invoice history cannot be truncated' USING ERRCODE = '23514'; END $$;
                CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON "Invoices" FOR EACH STATEMENT EXECUTE FUNCTION bhome_invoice_no_truncate();
                CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON "InvoiceLines" FOR EACH STATEMENT EXECUTE FUNCTION bhome_invoice_no_truncate();
                CREATE TRIGGER invoice_recipients_no_truncate BEFORE TRUNCATE ON "InvoiceRecipients" FOR EACH STATEMENT EXECUTE FUNCTION bhome_invoice_no_truncate();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Invoices" WHERE "Status" = 1) THEN
                  RAISE EXCEPTION 'Cannot remove financial immutability while final invoices exist'; END IF; END $$;
                DROP TRIGGER invoice_immutable ON "Invoices";
                DROP TRIGGER invoice_lines_immutable ON "InvoiceLines";
                DROP TRIGGER invoice_recipients_immutable ON "InvoiceRecipients";
                DROP TRIGGER invoices_no_truncate ON "Invoices";
                DROP TRIGGER invoice_lines_no_truncate ON "InvoiceLines";
                DROP TRIGGER invoice_recipients_no_truncate ON "InvoiceRecipients";
                DROP FUNCTION bhome_invoice_immutable();
                DROP FUNCTION bhome_invoice_child_immutable();
                DROP FUNCTION bhome_invoice_no_truncate();
                """);
        }
    }
}
