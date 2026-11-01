using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InvoicePaymentLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PaymentCommands",
                columns: table => new
                {
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<Guid>(type: "uuid", nullable: false),
                    Operation = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentCommands", x => new { x.ActorId, x.Key, x.Operation });
                    table.ForeignKey(
                        name: "FK_PaymentCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentTransfers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderIdentity = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    BankReference = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    NormalizedReference = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TransferDescription = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    StatementReference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    VerificationReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    VerificationSource = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    VerifiedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ProposedInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDevelopmentDemo = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentTransfers", x => x.Id);
                    table.CheckConstraint("CK_PaymentTransfer_Values", "\"Amount\" > 0 AND \"Currency\" = 'VND' AND length(\"NormalizedReference\") > 0 AND \"NormalizedReference\" = upper(btrim(\"BankReference\"))");
                    table.ForeignKey(
                        name: "FK_PaymentTransfers_AspNetUsers_VerifiedByUserId",
                        column: x => x.VerifiedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentTransfers_Invoices_ProposedInvoiceId",
                        column: x => x.ProposedInvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentAllocations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TransferId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    PaidByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    VerifiedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AllocatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentAllocations", x => x.Id);
                    table.CheckConstraint("CK_PaymentAllocation_Amount", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentAllocations_AspNetUsers_PaidByUserId",
                        column: x => x.PaidByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentAllocations_AspNetUsers_VerifiedByUserId",
                        column: x => x.VerifiedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentAllocations_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentAllocations_PaymentTransfers_TransferId",
                        column: x => x.TransferId,
                        principalTable: "PaymentTransfers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentReconciliations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TransferId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    Decision = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentReconciliations", x => x.Id);
                    table.CheckConstraint("CK_PaymentReconciliation_Decision", "\"Decision\" IN ('PendingReview','Allocated','Rejected')");
                    table.ForeignKey(
                        name: "FK_PaymentReconciliations_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentReconciliations_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentReconciliations_PaymentTransfers_TransferId",
                        column: x => x.TransferId,
                        principalTable: "PaymentTransfers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BankReferenceClaims",
                columns: table => new
                {
                    NormalizedReference = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    AllocationId = table.Column<Guid>(type: "uuid", nullable: true),
                    DepositVerificationId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankReferenceClaims", x => x.NormalizedReference);
                    table.CheckConstraint("CK_BankReferenceClaim_Target", "(\"AllocationId\" IS NULL) <> (\"DepositVerificationId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_BankReferenceClaims_ContractDepositVerifications_DepositVer~",
                        column: x => x.DepositVerificationId,
                        principalTable: "ContractDepositVerifications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BankReferenceClaims_PaymentAllocations_AllocationId",
                        column: x => x.AllocationId,
                        principalTable: "PaymentAllocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentConfirmedEvents",
                columns: table => new
                {
                    AllocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentConfirmedEvents", x => x.AllocationId);
                    table.ForeignKey(
                        name: "FK_PaymentConfirmedEvents_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentConfirmedEvents_PaymentAllocations_AllocationId",
                        column: x => x.AllocationId,
                        principalTable: "PaymentAllocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankReferenceClaims_AllocationId",
                table: "BankReferenceClaims",
                column: "AllocationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BankReferenceClaims_DepositVerificationId",
                table: "BankReferenceClaims",
                column: "DepositVerificationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_InvoiceId",
                table: "PaymentAllocations",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_PaidByUserId",
                table: "PaymentAllocations",
                column: "PaidByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_TransferId",
                table: "PaymentAllocations",
                column: "TransferId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_VerifiedByUserId",
                table: "PaymentAllocations",
                column: "VerifiedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentConfirmedEvents_InvoiceId",
                table: "PaymentConfirmedEvents",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentReconciliations_ActorId",
                table: "PaymentReconciliations",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentReconciliations_InvoiceId",
                table: "PaymentReconciliations",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentReconciliations_TransferId_OccurredAt",
                table: "PaymentReconciliations",
                columns: new[] { "TransferId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_ProposedInvoiceId",
                table: "PaymentTransfers",
                column: "ProposedInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_ProviderIdentity_NormalizedReference",
                table: "PaymentTransfers",
                columns: new[] { "ProviderIdentity", "NormalizedReference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_VerifiedAt",
                table: "PaymentTransfers",
                column: "VerifiedAt");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_VerifiedByUserId",
                table: "PaymentTransfers",
                column: "VerifiedByUserId");
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "ContractDepositVerifications" GROUP BY upper(btrim("BankTransactionReference")) HAVING COUNT(*) > 1) THEN
                    RAISE EXCEPTION 'Existing deposit references collide after normalization; manual review required';
                  END IF;
                END $$;
                INSERT INTO "BankReferenceClaims" ("NormalizedReference", "DepositVerificationId")
                  SELECT upper(btrim("BankTransactionReference")), "Id" FROM "ContractDepositVerifications";
                CREATE FUNCTION bhome_deposit_reference_claim() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  INSERT INTO "BankReferenceClaims" ("NormalizedReference", "DepositVerificationId")
                    VALUES (upper(btrim(NEW."BankTransactionReference")), NEW."Id");
                  RETURN NEW;
                END $$;
                CREATE TRIGGER deposit_bank_reference_claim AFTER INSERT ON "ContractDepositVerifications"
                  FOR EACH ROW EXECUTE FUNCTION bhome_deposit_reference_claim();
                CREATE FUNCTION bhome_invoice_payment_validate() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE invoice_total numeric; state integer; credited numeric; incoming numeric; bank_memo text; expected_memo text;
                BEGIN
                  PERFORM 1 FROM "Rooms" room JOIN "Invoices" bill ON bill."RoomId" = room."Id"
                    WHERE bill."Id" = NEW."InvoiceId" FOR UPDATE OF room;
                  SELECT "Total", "Status" INTO invoice_total, state FROM "Invoices" WHERE "Id" = NEW."InvoiceId";
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
                CREATE TRIGGER invoice_payment_validate BEFORE INSERT ON "PaymentAllocations"
                  FOR EACH ROW EXECUTE FUNCTION bhome_invoice_payment_validate();
                CREATE FUNCTION bhome_invoice_reference_claim() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  INSERT INTO "BankReferenceClaims" ("NormalizedReference", "AllocationId")
                    SELECT "NormalizedReference", NEW."Id" FROM "PaymentTransfers" WHERE "Id" = NEW."TransferId";
                  RETURN NEW;
                END $$;
                CREATE TRIGGER invoice_bank_reference_claim AFTER INSERT ON "PaymentAllocations"
                  FOR EACH ROW EXECUTE FUNCTION bhome_invoice_reference_claim();
                CREATE FUNCTION bhome_payment_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Payment ledger and history are append-only' USING ERRCODE = '23514'; END $$;
                CREATE TRIGGER payment_transfers_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentTransfers" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER payment_allocations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentAllocations" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER payment_reconciliations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentReconciliations" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER bank_reference_claims_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "BankReferenceClaims" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER payment_commands_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentCommands" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                CREATE TRIGGER payment_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentConfirmedEvents" FOR EACH STATEMENT EXECUTE FUNCTION bhome_payment_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM "PaymentTransfers") OR EXISTS (SELECT 1 FROM "PaymentAllocations") THEN
                    RAISE EXCEPTION 'Payment history exists; rollback would discard financial evidence';
                  END IF;
                END $$;
                DROP TRIGGER deposit_bank_reference_claim ON "ContractDepositVerifications";
                DROP FUNCTION bhome_deposit_reference_claim();
                DROP TRIGGER invoice_bank_reference_claim ON "PaymentAllocations";
                DROP TRIGGER invoice_payment_validate ON "PaymentAllocations";
                DROP FUNCTION bhome_invoice_reference_claim();
                DROP FUNCTION bhome_invoice_payment_validate();
                DROP TRIGGER payment_transfers_immutable ON "PaymentTransfers";
                DROP TRIGGER payment_allocations_immutable ON "PaymentAllocations";
                DROP TRIGGER payment_reconciliations_immutable ON "PaymentReconciliations";
                DROP TRIGGER bank_reference_claims_immutable ON "BankReferenceClaims";
                DROP TRIGGER payment_commands_immutable ON "PaymentCommands";
                DROP TRIGGER payment_events_immutable ON "PaymentConfirmedEvents";
                DROP FUNCTION bhome_payment_append_only();
                """);
            migrationBuilder.DropTable(
                name: "BankReferenceClaims");

            migrationBuilder.DropTable(
                name: "PaymentCommands");

            migrationBuilder.DropTable(
                name: "PaymentConfirmedEvents");

            migrationBuilder.DropTable(
                name: "PaymentReconciliations");

            migrationBuilder.DropTable(
                name: "PaymentAllocations");

            migrationBuilder.DropTable(
                name: "PaymentTransfers");
        }
    }
}
