using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BHome.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class IncidentMaintenanceCore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IncidentFileUploads",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    CleanupAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentFileUploads", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "IncidentReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    CommonArea = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReporterId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReporterRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Description = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false),
                    Severity = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DuplicateOfId = table.Column<Guid>(type: "uuid", nullable: true),
                    AcknowledgedById = table.Column<Guid>(type: "uuid", nullable: true),
                    AcknowledgedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    OwnerDecisionAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ResolutionNote = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    ResolvedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentReports", x => x.Id);
                    table.CheckConstraint("CK_Incident_Acknowledgement", "(\"AcknowledgedById\" IS NULL) = (\"AcknowledgedAt\" IS NULL)");
                    table.CheckConstraint("CK_Incident_Duplicate", "\"DuplicateOfId\" IS NULL OR \"DuplicateOfId\" <> \"Id\"");
                    table.CheckConstraint("CK_Incident_Scope", "(\"RoomId\" IS NOT NULL AND \"CommonArea\" IS NULL) OR (\"RoomId\" IS NULL AND \"CommonArea\" IS NOT NULL AND length(trim(\"CommonArea\")) > 0)");
                    table.CheckConstraint("CK_Incident_Values", "\"Severity\" IN (0,1) AND \"Status\" BETWEEN 0 AND 5 AND length(trim(\"Description\")) >= 10 AND \"Version\" > 0");
                    table.ForeignKey(
                        name: "FK_IncidentReports_AspNetUsers_AcknowledgedById",
                        column: x => x.AcknowledgedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentReports_AspNetUsers_ReporterId",
                        column: x => x.ReporterId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentReports_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentReports_Contracts_ContractId",
                        column: x => x.ContractId,
                        principalTable: "Contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentReports_IncidentReports_DuplicateOfId",
                        column: x => x.DuplicateOfId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentReports_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentReports_Rooms_RoomId_LocationId",
                        columns: x => new { x.RoomId, x.LocationId },
                        principalTable: "Rooms",
                        principalColumns: new[] { "Id", "LocationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IncidentCommands",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResponseJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentCommands", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncidentCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentCommands_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MaintenanceWorkOrders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    AssignedStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpectedOutcome = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    TargetCompletionAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    InspectionResult = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    ProposedSolution = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    Vendor = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    EstimatedMinutes = table.Column<int>(type: "integer", nullable: true),
                    EstimatedCost = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: true),
                    ProposalVersion = table.Column<int>(type: "integer", nullable: false),
                    ApprovedProposalVersion = table.Column<int>(type: "integer", nullable: true),
                    ApprovedById = table.Column<Guid>(type: "uuid", nullable: true),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Result = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    CompletionActivityId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActualCost = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: true),
                    VerifiedById = table.Column<Guid>(type: "uuid", nullable: true),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MaintenanceWorkOrders", x => x.Id);
                    table.CheckConstraint("CK_WorkOrder_Approval", "\"Status\" NOT IN (2,3,4) OR (\"ApprovedAt\" IS NOT NULL AND \"ApprovedById\" IS NOT NULL AND \"ApprovedProposalVersion\" IS NOT NULL AND \"ApprovedProposalVersion\" = \"ProposalVersion\")");
                    table.CheckConstraint("CK_WorkOrder_Cost", "(\"EstimatedCost\" IS NULL OR \"EstimatedCost\" >= 0) AND (\"ActualCost\" IS NULL OR \"ActualCost\" >= 0) AND (\"EstimatedMinutes\" IS NULL OR \"EstimatedMinutes\" > 0)");
                    table.CheckConstraint("CK_WorkOrder_State", "\"Status\" BETWEEN 0 AND 5 AND \"Version\" > 0 AND \"ProposalVersion\" >= 0");
                    table.CheckConstraint("CK_WorkOrder_Verification", "\"Status\" <> 4 OR (\"VerifiedById\" IS NOT NULL AND \"VerifiedAt\" IS NOT NULL AND \"ActualCost\" IS NOT NULL AND \"CompletionActivityId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_AspNetUsers_ApprovedById",
                        column: x => x.ApprovedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_AspNetUsers_AssignedStaffId",
                        column: x => x.AssignedStaffId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_AspNetUsers_VerifiedById",
                        column: x => x.VerifiedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceWorkOrders_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IncidentActivities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Note = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false),
                    TenantVisible = table.Column<bool>(type: "boolean", nullable: false),
                    DataJson = table.Column<string>(type: "jsonb", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncidentActivities_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentActivities_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentActivities_MaintenanceWorkOrders_WorkOrderId",
                        column: x => x.WorkOrderId,
                        principalTable: "MaintenanceWorkOrders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IncidentEmergencyActions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedCost = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: true),
                    CostApproved = table.Column<bool>(type: "boolean", nullable: true),
                    CostDecidedById = table.Column<Guid>(type: "uuid", nullable: true),
                    CostDecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentEmergencyActions", x => x.Id);
                    table.CheckConstraint("CK_EmergencyAction_Cost", "\"RequestedCost\" IS NULL OR \"RequestedCost\" >= 0");
                    table.CheckConstraint("CK_EmergencyAction_Decision", "(\"CostApproved\" IS NULL AND \"CostDecidedAt\" IS NULL AND \"CostDecidedById\" IS NULL) OR (\"CostApproved\" IS NOT NULL AND \"RequestedCost\" IS NOT NULL AND \"CostDecidedAt\" IS NOT NULL AND \"CostDecidedById\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_IncidentEmergencyActions_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentEmergencyActions_AspNetUsers_CostDecidedById",
                        column: x => x.CostDecidedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentEmergencyActions_IncidentActivities_ActivityId",
                        column: x => x.ActivityId,
                        principalTable: "IncidentActivities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentEmergencyActions_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IncidentEvidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActivityId = table.Column<Guid>(type: "uuid", nullable: true),
                    UploadedById = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentEvidence", x => x.Id);
                    table.CheckConstraint("CK_IncidentEvidence_Values", "\"Kind\" BETWEEN 0 AND 4 AND \"Length\" > 0 AND \"Length\" <= 5000000 AND \"ContentType\" IN ('image/png','image/jpeg')");
                    table.ForeignKey(
                        name: "FK_IncidentEvidence_AspNetUsers_UploadedById",
                        column: x => x.UploadedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentEvidence_IncidentActivities_ActivityId",
                        column: x => x.ActivityId,
                        principalTable: "IncidentActivities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentEvidence_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentEvidence_MaintenanceWorkOrders_WorkOrderId",
                        column: x => x.WorkOrderId,
                        principalTable: "MaintenanceWorkOrders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IncidentNotifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientId = table.Column<Guid>(type: "uuid", nullable: false),
                    Event = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    HighPriority = table.Column<bool>(type: "boolean", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeliveryState = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    DeliveryReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DeliveryError = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentNotifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncidentNotifications_AspNetUsers_RecipientId",
                        column: x => x.RecipientId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentNotifications_IncidentActivities_ActivityId",
                        column: x => x.ActivityId,
                        principalTable: "IncidentActivities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_IncidentNotifications_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MaintenanceHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActivityId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConditionBefore = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ConditionAfter = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    StatusBefore = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    StatusAfter = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    ActualCost = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    VerifiedById = table.Column<Guid>(type: "uuid", nullable: false),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MaintenanceHistory", x => x.Id);
                    table.CheckConstraint("CK_MaintenanceHistory_Cost", "\"ActualCost\" >= 0");
                    table.ForeignKey(
                        name: "FK_MaintenanceHistory_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceHistory_IncidentActivities_ActivityId",
                        column: x => x.ActivityId,
                        principalTable: "IncidentActivities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceHistory_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceHistory_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceHistory_MaintenanceWorkOrders_WorkOrderId",
                        column: x => x.WorkOrderId,
                        principalTable: "MaintenanceWorkOrders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaintenanceHistory_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OperatingExpenses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    WorkOrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    EmergencyActionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    SourceType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,0)", precision: 18, scale: 0, nullable: false),
                    ExpenseDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ConfirmedById = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperatingExpenses", x => x.Id);
                    table.CheckConstraint("CK_MaintenanceExpense_Source", "(\"SourceType\" = 'WorkOrder' AND \"WorkOrderId\" = \"SourceId\" AND \"WorkOrderId\" IS NOT NULL AND \"EmergencyActionId\" IS NULL) OR (\"SourceType\" = 'EmergencyAction' AND \"EmergencyActionId\" = \"SourceId\" AND \"EmergencyActionId\" IS NOT NULL AND \"WorkOrderId\" IS NULL) OR (\"SourceType\" = 'Direct' AND \"WorkOrderId\" IS NULL AND \"EmergencyActionId\" IS NULL)");
                    table.CheckConstraint("CK_MaintenanceExpense_Values", "\"Amount\" > 0 AND \"Category\" = 'Maintenance' AND \"SourceType\" IN ('WorkOrder','Direct','EmergencyAction')");
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_AspNetUsers_ConfirmedById",
                        column: x => x.ConfirmedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_Assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "Assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_IncidentEmergencyActions_EmergencyActionId",
                        column: x => x.EmergencyActionId,
                        principalTable: "IncidentEmergencyActions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_IncidentReports_IncidentId",
                        column: x => x.IncidentId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_Locations_LocationId",
                        column: x => x.LocationId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_MaintenanceWorkOrders_WorkOrderId",
                        column: x => x.WorkOrderId,
                        principalTable: "MaintenanceWorkOrders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OperatingExpenses_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentActivities_ActorId",
                table: "IncidentActivities",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentActivities_IncidentId_OccurredAt",
                table: "IncidentActivities",
                columns: new[] { "IncidentId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentActivities_WorkOrderId",
                table: "IncidentActivities",
                column: "WorkOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentCommands_ActorId_Key",
                table: "IncidentCommands",
                columns: new[] { "ActorId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentCommands_IncidentId",
                table: "IncidentCommands",
                column: "IncidentId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEmergencyActions_ActivityId",
                table: "IncidentEmergencyActions",
                column: "ActivityId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEmergencyActions_ActorId",
                table: "IncidentEmergencyActions",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEmergencyActions_CostDecidedById",
                table: "IncidentEmergencyActions",
                column: "CostDecidedById");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEmergencyActions_IncidentId",
                table: "IncidentEmergencyActions",
                column: "IncidentId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEvidence_ActivityId",
                table: "IncidentEvidence",
                column: "ActivityId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEvidence_IncidentId_Kind_WorkOrderId",
                table: "IncidentEvidence",
                columns: new[] { "IncidentId", "Kind", "WorkOrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEvidence_ObjectKey",
                table: "IncidentEvidence",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEvidence_UploadedById",
                table: "IncidentEvidence",
                column: "UploadedById");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentEvidence_WorkOrderId",
                table: "IncidentEvidence",
                column: "WorkOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentFileUploads_CleanupAfter",
                table: "IncidentFileUploads",
                column: "CleanupAfter");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentFileUploads_ObjectKey",
                table: "IncidentFileUploads",
                column: "ObjectKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentNotifications_ActivityId_RecipientId",
                table: "IncidentNotifications",
                columns: new[] { "ActivityId", "RecipientId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentNotifications_IncidentId",
                table: "IncidentNotifications",
                column: "IncidentId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentNotifications_RecipientId_CreatedAt",
                table: "IncidentNotifications",
                columns: new[] { "RecipientId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_AcknowledgedById",
                table: "IncidentReports",
                column: "AcknowledgedById");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_AssetId",
                table: "IncidentReports",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ContractId",
                table: "IncidentReports",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_DuplicateOfId",
                table: "IncidentReports",
                column: "DuplicateOfId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_LocationId_Status_CreatedAt",
                table: "IncidentReports",
                columns: new[] { "LocationId", "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ReporterId_CreatedAt",
                table: "IncidentReports",
                columns: new[] { "ReporterId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_RoomId_LocationId",
                table: "IncidentReports",
                columns: new[] { "RoomId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceHistory_ActivityId",
                table: "MaintenanceHistory",
                column: "ActivityId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceHistory_AssetId",
                table: "MaintenanceHistory",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceHistory_IncidentId",
                table: "MaintenanceHistory",
                column: "IncidentId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceHistory_LocationId_VerifiedAt",
                table: "MaintenanceHistory",
                columns: new[] { "LocationId", "VerifiedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceHistory_RoomId",
                table: "MaintenanceHistory",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceHistory_WorkOrderId",
                table: "MaintenanceHistory",
                column: "WorkOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_ApprovedById",
                table: "MaintenanceWorkOrders",
                column: "ApprovedById");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_AssetId_Status",
                table: "MaintenanceWorkOrders",
                columns: new[] { "AssetId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_AssignedStaffId",
                table: "MaintenanceWorkOrders",
                column: "AssignedStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_IncidentId_Status",
                table: "MaintenanceWorkOrders",
                columns: new[] { "IncidentId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_LocationId_TargetCompletionAt",
                table: "MaintenanceWorkOrders",
                columns: new[] { "LocationId", "TargetCompletionAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_RoomId",
                table: "MaintenanceWorkOrders",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_MaintenanceWorkOrders_VerifiedById",
                table: "MaintenanceWorkOrders",
                column: "VerifiedById");

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_AssetId",
                table: "OperatingExpenses",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_ConfirmedById",
                table: "OperatingExpenses",
                column: "ConfirmedById");

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_EmergencyActionId",
                table: "OperatingExpenses",
                column: "EmergencyActionId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_IncidentId",
                table: "OperatingExpenses",
                column: "IncidentId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_LocationId_ExpenseDate",
                table: "OperatingExpenses",
                columns: new[] { "LocationId", "ExpenseDate" });

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_RoomId",
                table: "OperatingExpenses",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_SourceType_SourceId",
                table: "OperatingExpenses",
                columns: new[] { "SourceType", "SourceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OperatingExpenses_WorkOrderId",
                table: "OperatingExpenses",
                column: "WorkOrderId");

            migrationBuilder.Sql("""
                CREATE FUNCTION bhome_incident_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'Incident history, commands and expenses are append-only' USING ERRCODE = '23514';
                END $$;
                CREATE TRIGGER "TR_IncidentActivities_AppendOnly" BEFORE UPDATE OR DELETE OR TRUNCATE ON "IncidentActivities"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_incident_append_only();
                CREATE TRIGGER "TR_IncidentCommands_AppendOnly" BEFORE UPDATE OR DELETE OR TRUNCATE ON "IncidentCommands"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_incident_append_only();
                CREATE TRIGGER "TR_MaintenanceHistory_AppendOnly" BEFORE UPDATE OR DELETE OR TRUNCATE ON "MaintenanceHistory"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_incident_append_only();
                CREATE TRIGGER "TR_OperatingExpenses_AppendOnly" BEFORE UPDATE OR DELETE OR TRUNCATE ON "OperatingExpenses"
                FOR EACH STATEMENT EXECUTE FUNCTION bhome_incident_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM "IncidentReports") OR EXISTS (SELECT 1 FROM "IncidentFileUploads") THEN
                        RAISE EXCEPTION 'Cannot downgrade IncidentMaintenanceCore with incident data or upload intents. Preserve history under an approved rollback plan.';
                    END IF;
                END $$;
                DROP TRIGGER "TR_IncidentActivities_AppendOnly" ON "IncidentActivities";
                DROP TRIGGER "TR_IncidentCommands_AppendOnly" ON "IncidentCommands";
                DROP TRIGGER "TR_MaintenanceHistory_AppendOnly" ON "MaintenanceHistory";
                DROP TRIGGER "TR_OperatingExpenses_AppendOnly" ON "OperatingExpenses";
                DROP FUNCTION bhome_incident_append_only();
                """);
            migrationBuilder.DropTable(
                name: "IncidentCommands");

            migrationBuilder.DropTable(
                name: "IncidentEvidence");

            migrationBuilder.DropTable(
                name: "IncidentFileUploads");

            migrationBuilder.DropTable(
                name: "IncidentNotifications");

            migrationBuilder.DropTable(
                name: "MaintenanceHistory");

            migrationBuilder.DropTable(
                name: "OperatingExpenses");

            migrationBuilder.DropTable(
                name: "IncidentEmergencyActions");

            migrationBuilder.DropTable(
                name: "IncidentActivities");

            migrationBuilder.DropTable(
                name: "MaintenanceWorkOrders");

            migrationBuilder.DropTable(
                name: "IncidentReports");
        }
    }
}
