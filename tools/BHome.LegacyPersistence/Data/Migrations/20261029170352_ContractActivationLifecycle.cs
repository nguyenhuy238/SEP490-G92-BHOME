using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractActivationLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_Period",
                table: "OperationalTasks");

            // Rooms.Status belongs to the preceding PropertyConfiguration migration.
            // Preserve its four-state values and safe default; Contract only changes values at runtime.

            migrationBuilder.AddColumn<Guid>(
                name: "ContractId",
                table: "OperationalTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ContractFileUploads",
                columns: table => new
                {
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    CleanupAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractFileUploads", x => x.ObjectKey);
                });

            migrationBuilder.CreateTable(
                name: "ContractOperations",
                columns: table => new
                {
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<Guid>(type: "uuid", nullable: false),
                    Operation = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractOperations", x => new { x.ActorId, x.Operation, x.Key });
                });

            migrationBuilder.CreateTable(
                name: "Contracts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerSignerId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RepresentativeResidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    PreviousContractId = table.Column<Guid>(type: "uuid", nullable: true),
                    HoldingContractId = table.Column<Guid>(type: "uuid", nullable: true),
                    AppliedHoldingDeposit = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    HoldingAllocationReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    MonthlyRent = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    RequiredDeposit = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    Terms = table.Column<string>(type: "character varying(12000)", maxLength: 12000, nullable: false),
                    SnapshotHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ActivatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActivatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ActualEndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Contracts", x => x.Id);
                    table.CheckConstraint("CK_Contract_Activation", "\"Status\" <> 3 OR (\"ActivatedAt\" IS NOT NULL AND \"ActivatedByUserId\" IS NOT NULL)");
                    table.CheckConstraint("CK_Contract_Holding", "\"AppliedHoldingDeposit\" >= 0 AND \"AppliedHoldingDeposit\" <= \"RequiredDeposit\" AND ((\"HoldingContractId\" IS NULL AND \"HoldingAllocationReference\" IS NULL AND \"AppliedHoldingDeposit\" = 0) OR (\"HoldingContractId\" IS NOT NULL AND \"HoldingAllocationReference\" IS NOT NULL))");
                    table.CheckConstraint("CK_Contract_Signers", "\"OwnerSignerId\" <> \"TenantUserId\"");
                    table.CheckConstraint("CK_Contract_Terms", "\"EndDate\" > \"StartDate\" AND \"MonthlyRent\" > 0 AND \"RequiredDeposit\" >= 0");
                    table.ForeignKey(
                        name: "FK_Contracts_AspNetUsers_OwnerSignerId",
                        column: x => x.OwnerSignerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Contracts_AspNetUsers_TenantUserId",
                        column: x => x.TenantUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Contracts_Contracts_PreviousContractId",
                        column: x => x.PreviousContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Contracts_Residents_RepresentativeResidentId",
                        column: x => x.RepresentativeResidentId,
                        principalTable: "Residents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Contracts_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SigningCertificates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ProviderUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CredentialId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SerialNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Subject = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Issuer = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ValidFrom = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ValidTo = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Locked = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SigningCertificates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ContractDepositVerifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    BankTransactionReference = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    VerificationReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    VerifiedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractDepositVerifications", x => x.Id);
                    table.CheckConstraint("CK_Deposit_Positive", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_ContractDepositVerifications_AspNetUsers_VerifiedByUserId",
                        column: x => x.VerifiedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractDepositVerifications_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContractInspectionEvidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    UploadedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    IsLinked = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractInspectionEvidence", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractInspectionEvidence_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContractMoveOuts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ProposedDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    IsExpiry = table.Column<bool>(type: "boolean", nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ApprovedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    InspectionScheduledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    InspectedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    InspectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    InspectionNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    ElectricityReadingId = table.Column<Guid>(type: "uuid", nullable: true),
                    WaterReadingId = table.Column<Guid>(type: "uuid", nullable: true),
                    SettlementDecision = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    SettlementApprovedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    SettlementApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SettlementLedgerReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PendingReason = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractMoveOuts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractMoveOuts_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractMoveOuts_MeterReadings_ElectricityReadingId",
                        column: x => x.ElectricityReadingId,
                        principalTable: "MeterReadings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractMoveOuts_MeterReadings_WaterReadingId",
                        column: x => x.WaterReadingId,
                        principalTable: "MeterReadings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContractResidents",
                columns: table => new
                {
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    ResidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    ResidenceFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    ResidenceTo = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractResidents", x => new { x.ContractId, x.ResidentId });
                    table.ForeignKey(
                        name: "FK_ContractResidents_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContractResidents_Residents_ResidentId",
                        column: x => x.ResidentId,
                        principalTable: "Residents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContractSettlementReviews",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Decision = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    LedgerReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Settled = table.Column<bool>(type: "boolean", nullable: false),
                    ReviewedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReviewedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractSettlementReviews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractSettlementReviews_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContractSignatures",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    SignerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CertificateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    SnapshotHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SourceHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PreparedHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PreparedObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    FieldName = table.Column<string>(type: "text", nullable: false),
                    DocumentDigest = table.Column<string>(type: "text", nullable: false),
                    DataToSignDigest = table.Column<string>(type: "text", nullable: false),
                    CertificateChain = table.Column<string>(type: "text", nullable: false),
                    ProviderUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CredentialId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProviderReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SignedObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: true),
                    SignedHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SignedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContractSignatures", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContractSignatures_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_ContractId",
                table: "OperationalTasks",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_OperationalTasks_MeterId_ContractId",
                table: "OperationalTasks",
                columns: new[] { "MeterId", "ContractId" },
                unique: true,
                filter: "\"Purpose\" = 2 AND \"Status\" <> 3");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_FinalContract",
                table: "OperationalTasks",
                sql: "(\"Purpose\" = 2 AND \"ContractId\" IS NOT NULL) OR (\"Purpose\" <> 2 AND \"ContractId\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_Period",
                table: "OperationalTasks",
                sql: "(\"Purpose\" IN (0,2) AND \"BillingPeriod\" IS NULL) OR (\"Purpose\" = 1 AND \"BillingPeriod\" IS NOT NULL AND EXTRACT(DAY FROM \"BillingPeriod\") = 1)");

            migrationBuilder.CreateIndex(
                name: "IX_ContractDepositVerifications_BankTransactionReference",
                table: "ContractDepositVerifications",
                column: "BankTransactionReference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractDepositVerifications_ContractId",
                table: "ContractDepositVerifications",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractDepositVerifications_VerifiedByUserId",
                table: "ContractDepositVerifications",
                column: "VerifiedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractFileUploads_CleanupAfter",
                table: "ContractFileUploads",
                column: "CleanupAfter");

            migrationBuilder.CreateIndex(
                name: "IX_ContractInspectionEvidence_ContractId",
                table: "ContractInspectionEvidence",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractInspectionEvidence_ObjectKey",
                table: "ContractInspectionEvidence",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractMoveOuts_ContractId",
                table: "ContractMoveOuts",
                column: "ContractId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContractMoveOuts_ElectricityReadingId",
                table: "ContractMoveOuts",
                column: "ElectricityReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractMoveOuts_WaterReadingId",
                table: "ContractMoveOuts",
                column: "WaterReadingId");

            migrationBuilder.CreateIndex(
                name: "IX_ContractResidents_ResidentId",
                table: "ContractResidents",
                column: "ResidentId");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_HoldingAllocationReference",
                table: "Contracts",
                column: "HoldingAllocationReference",
                unique: true,
                filter: "\"HoldingAllocationReference\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_HoldingContractId",
                table: "Contracts",
                column: "HoldingContractId",
                unique: true,
                filter: "\"HoldingContractId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_OwnerSignerId",
                table: "Contracts",
                column: "OwnerSignerId");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_PreviousContractId",
                table: "Contracts",
                column: "PreviousContractId",
                unique: true,
                filter: "\"PreviousContractId\" IS NOT NULL AND \"Status\" IN (0,1,2,3)");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_RepresentativeResidentId",
                table: "Contracts",
                column: "RepresentativeResidentId");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_TenantUserId",
                table: "Contracts",
                column: "TenantUserId");

            migrationBuilder.CreateIndex(
                name: "UX_Contract_ActiveRoom",
                table: "Contracts",
                column: "RoomId",
                unique: true,
                filter: "\"Status\" = 3");

            migrationBuilder.CreateIndex(
                name: "IX_ContractSettlementReviews_ContractId_ReviewedAt",
                table: "ContractSettlementReviews",
                columns: new[] { "ContractId", "ReviewedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ContractSignatures_ContractId_SignerUserId",
                table: "ContractSignatures",
                columns: new[] { "ContractId", "SignerUserId" },
                unique: true,
                filter: "\"Status\" <> 4");

            migrationBuilder.CreateIndex(
                name: "IX_ContractSignatures_ProviderReference",
                table: "ContractSignatures",
                column: "ProviderReference",
                unique: true,
                filter: "\"ProviderReference\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SigningCertificates_OwnerUserId",
                table: "SigningCertificates",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_SigningCertificates_Provider_SerialNumber",
                table: "SigningCertificates",
                columns: new[] { "Provider", "SerialNumber" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_OperationalTasks_Contracts_ContractId",
                table: "OperationalTasks",
                column: "ContractId",
                principalTable: "Contracts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_contract_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract history cannot be deleted'; END IF;
                    IF EXISTS (SELECT 1 FROM "ContractSignatures" WHERE "ContractId" = OLD."Id") AND
                       ROW(NEW."RoomId", NEW."OwnerSignerId", NEW."TenantUserId", NEW."RepresentativeResidentId",
                           NEW."PreviousContractId", NEW."Kind", NEW."StartDate", NEW."EndDate", NEW."MonthlyRent",
                           NEW."RequiredDeposit", NEW."Terms", NEW."SnapshotHash", NEW."HoldingContractId",
                           NEW."AppliedHoldingDeposit", NEW."HoldingAllocationReference") IS DISTINCT FROM
                       ROW(OLD."RoomId", OLD."OwnerSignerId", OLD."TenantUserId", OLD."RepresentativeResidentId",
                           OLD."PreviousContractId", OLD."Kind", OLD."StartDate", OLD."EndDate", OLD."MonthlyRent",
                           OLD."RequiredDeposit", OLD."Terms", OLD."SnapshotHash", OLD."HoldingContractId",
                           OLD."AppliedHoldingDeposit", OLD."HoldingAllocationReference")
                    THEN RAISE EXCEPTION 'Contract signing snapshot is immutable'; END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER contract_snapshot_immutable BEFORE UPDATE OR DELETE ON "Contracts"
                FOR EACH ROW EXECUTE FUNCTION bhome_contract_snapshot_immutable();

                CREATE FUNCTION bhome_contract_residents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract occupant history cannot be deleted'; END IF;
                    IF EXISTS (SELECT 1 FROM "ContractSignatures" WHERE "ContractId" = NEW."ContractId") THEN
                        IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Contract occupants are immutable'; END IF;
                        IF ROW(NEW."ContractId", NEW."ResidentId", NEW."Role", NEW."ResidenceFrom") IS DISTINCT FROM
                           ROW(OLD."ContractId", OLD."ResidentId", OLD."Role", OLD."ResidenceFrom")
                        THEN RAISE EXCEPTION 'Contract occupants are immutable'; END IF;
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER contract_residents_immutable BEFORE INSERT OR UPDATE OR DELETE ON "ContractResidents"
                FOR EACH ROW EXECUTE FUNCTION bhome_contract_residents_immutable();

                CREATE FUNCTION bhome_contract_deposit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Verified bank allocations are append-only'; END $$;
                CREATE TRIGGER contract_deposit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON "ContractDepositVerifications"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_contract_deposit_append_only();

                CREATE FUNCTION bhome_contract_signature_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract signing history cannot be deleted'; END IF;
                    IF OLD."Status" = 3 AND (to_jsonb(NEW) - 'UpdatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'UpdatedAt')
                    THEN RAISE EXCEPTION 'Verified signing evidence is immutable'; END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER contract_signature_immutable BEFORE UPDATE OR DELETE ON "ContractSignatures"
                FOR EACH ROW EXECUTE FUNCTION bhome_contract_signature_immutable();
                CREATE FUNCTION bhome_contract_settlement_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Settlement decision history is append-only'; END $$;
                CREATE TRIGGER contract_settlement_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON "ContractSettlementReviews"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_contract_settlement_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER contract_settlement_append_only ON "ContractSettlementReviews";
                DROP FUNCTION bhome_contract_settlement_append_only();
                DROP TRIGGER contract_signature_immutable ON "ContractSignatures";
                DROP FUNCTION bhome_contract_signature_immutable();
                DROP TRIGGER contract_deposit_append_only ON "ContractDepositVerifications";
                DROP FUNCTION bhome_contract_deposit_append_only();
                DROP TRIGGER contract_residents_immutable ON "ContractResidents";
                DROP FUNCTION bhome_contract_residents_immutable();
                DROP TRIGGER contract_snapshot_immutable ON "Contracts";
                DROP FUNCTION bhome_contract_snapshot_immutable();
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_OperationalTasks_Contracts_ContractId",
                table: "OperationalTasks");

            migrationBuilder.DropTable(
                name: "ContractDepositVerifications");

            migrationBuilder.DropTable(
                name: "ContractFileUploads");

            migrationBuilder.DropTable(
                name: "ContractInspectionEvidence");

            migrationBuilder.DropTable(
                name: "ContractMoveOuts");

            migrationBuilder.DropTable(
                name: "ContractOperations");

            migrationBuilder.DropTable(
                name: "ContractResidents");

            migrationBuilder.DropTable(
                name: "ContractSettlementReviews");

            migrationBuilder.DropTable(
                name: "ContractSignatures");

            migrationBuilder.DropTable(
                name: "SigningCertificates");

            migrationBuilder.DropTable(
                name: "Contracts");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_ContractId",
                table: "OperationalTasks");

            migrationBuilder.DropIndex(
                name: "IX_OperationalTasks_MeterId_ContractId",
                table: "OperationalTasks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_FinalContract",
                table: "OperationalTasks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Task_Period",
                table: "OperationalTasks");

            // Rolling back Contract must retain the Property-owned room state column.

            migrationBuilder.DropColumn(
                name: "ContractId",
                table: "OperationalTasks");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Task_Period",
                table: "OperationalTasks",
                sql: "(\"Purpose\" = 0 AND \"BillingPeriod\" IS NULL) OR (\"Purpose\" = 1 AND \"BillingPeriod\" IS NOT NULL AND EXTRACT(DAY FROM \"BillingPeriod\") = 1)");
        }
    }
}
