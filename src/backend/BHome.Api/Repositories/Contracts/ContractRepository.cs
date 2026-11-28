using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Security.Cryptography;
using BHome.Application.Ocr;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractRepository(BHomePersistenceContext db, ILogger<ContractRepository> logger,
    ISetupWorkspaceStore? setup = null,
    IIdentityProtection? identityProtection = null, NativeContractSidecars? sidecars = null) : IContractRepository
{
    private readonly List<ContractDocumentFile> pendingDocuments = [];
    private readonly List<ContractOperation> pendingOperations = [];
    private readonly List<SecurityAuditEvent> pendingAudit = [];
    private readonly List<DepositVerification> pendingDeposits = [];
    private NativeContractMutation? mutation;

    // Provisioning can also participate in a transaction owned by its caller.
    // Keep its native aggregate attached only for that operation, not the scope.
    internal async Task WithProvisioningMutationAsync(Contract supplied, Func<Contract, Task> work, CancellationToken t)
    {
        if (mutation is not null || db is not Compact24DbContext compact)
        {
            await work(supplied);
            return;
        }
        if (db.Database.CurrentTransaction is null)
            throw ContractException.Conflict("active_main_contract_required_for_accounts");
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        var location = await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.Id == supplied.RoomId)
            .Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()}, 0))", t);
        if ((await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM rooms WHERE id={supplied.RoomId} FOR UPDATE").ToArrayAsync(t)).Length == 0)
            throw ContractException.Missing();
        await WithLockedContractAsync(supplied.Id, async current =>
        {
            if (current.RoomId != supplied.RoomId) throw ContractException.Conflict("contract_residents_changed");
            await work(current);
            supplied.TenantUserId = current.TenantUserId;
            return true;
        }, t);
    }

    // Used by payment reconciliation after the ledger/location/room locks.
    // Do not begin or commit a second transaction or leave detached changes pending.
    public async Task<T> WithLockedContractAsync<T>(Guid id, Func<Contract, Task<T>> work, CancellationToken t)
    {
        if (mutation is not null || db is not Compact24DbContext compact)
            return await work(await FindAsync(id, t) ?? throw ContractException.Missing());
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Contract mutation requires the caller's locked transaction.");
        mutation = new(compact);
        try
        {
            var result = await work(await mutation.FindAsync(id, t) ?? throw ContractException.Missing());
            await FlushAsync(t);
            return result;
        }
        finally { mutation = null; pendingAudit.Clear(); }
    }

    public async Task<ContractPage> ListAsync(ContractListScope scope, int page, int pageSize, Guid? locationId, ContractStatus? status, CancellationToken t)
    {
        if (db is Compact24DbContext) return await NativeListAsync(scope, page, pageSize, locationId, status, t);
        var query = db.Set<Contract>().AsNoTracking().Where(c => scope.Owner ||
            (scope.Tenant && (c.TenantUserId == scope.ActorId ||
                (c.Status == ContractStatus.Active && (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) &&
                 c.Residents.Any(m => m.ResidenceFrom <= scope.Today && (m.ResidenceTo == null || m.ResidenceTo >= scope.Today) &&
                     db.Set<Resident>().Any(r => r.Id == m.ResidentId && r.RoomId == c.RoomId && r.TenantUserId == scope.ActorId))))) ||
            (scope.Staff && db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) &&
                db.StaffLocationAssignments.Any(a => a.StaffUserId == scope.ActorId &&
                a.LocationId == c.Room.LocationId && a.StartDate <= scope.Today && a.EndDate >= scope.Today)));
        if (locationId is { } location) query = query.Where(c => c.Room.LocationId == location);
        if (status is { } state) query = query.Where(c => c.Status == state);
        if (scope.Kind is { } kind) query = query.Where(c => c.Kind == kind);
        var total = await query.CountAsync(t);
        var items = await query.OrderByDescending(c => c.StartDate).ThenBy(c => c.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new
            {
                Summary = new ContractSummary(c.Id, c.RoomId, c.Room.LocationId, c.Room.Location.Name, c.Room.RoomNumber,
                c.Kind.ToString(), c.Status.ToString(), c.StartDate, c.EndDate, c.RentAmount,
                c.Kind == ContractKind.Main && c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft,
                c.RequiredDeposit, c.HoldingExpiryAt, null, null),
                c.AgreedPriceSnapshot,
                c.RepresentativeResidentId
            }).ToArrayAsync(t);
        var representativeIds = items.Select(row => row.RepresentativeResidentId).Distinct().ToArray();
        var customers = identityProtection is not null && representativeIds.Length > 0
            ? await db.Set<Resident>().AsNoTracking().Where(r => representativeIds.Contains(r.Id) && r.VerificationStatus == IdentityVerificationStatus.Verified).ToDictionaryAsync(r => r.Id, t)
            : new Dictionary<Guid, Resident>();
        return new(items.Select(row =>
        {
            var summary = row.Summary;
            if (customers.TryGetValue(row.RepresentativeResidentId, out var primary))
                summary = summary with { RepresentativeName = ContractResidentDisplay.Read(primary, identityProtection).Name };
            if (summary.Kind != "Holding") return summary;
            if (customers.TryGetValue(row.RepresentativeResidentId, out var resident))
                summary = summary with { HoldingCustomer = ReadHoldingCustomer(resident) };
            if (summary.HoldingExpiresAt is not null) return summary;
            // Legacy contracts retain the original expiry in their immutable price snapshot.
            try { return summary with { HoldingExpiresAt = JsonSerializer.Deserialize<HoldingPriceSnapshot>(row.AgreedPriceSnapshot)?.HoldingExpiresAt }; }
            catch (JsonException) { return summary; }
        }).ToArray(), page, pageSize, total);
    }

    private async Task<ContractPage> NativeListAsync(ContractListScope scope, int page, int pageSize, Guid? locationId, ContractStatus? status, CancellationToken t)
    {
        var assigned = db.Database.SqlQuery<Guid>($"""
            SELECT l.id AS "Value" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
            WHERE (a->>'staffUserId')::uuid={scope.ActorId} AND (a->>'startDate')::date<={scope.Today} AND (a->>'endDate')::date>={scope.Today}
            """);
        var kind = scope.Kind;
        var contracts = db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c =>
            c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Holding || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Addendum);
        var query = from c in contracts
                    join r in db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking() on c.RoomId equals r.Id
                    join l in db.Set<BHome.Domain.Locations.Location>().AsNoTracking() on r.LocationId equals l.Id
                    where (locationId == null || l.Id == locationId) && (status == null || c.Status == status.Value) &&
                        (kind == null || c.ContractType == kind) &&
                        (scope.Owner || scope.Tenant && (c.TenantUserId == scope.ActorId || c.Status == ContractStatus.Active &&
                            (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal) &&
                            db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(m => m.ContractId == c.Id && m.ResidenceFrom <= scope.Today &&
                                (m.ResidenceTo == null || m.ResidenceTo >= scope.Today) && db.Set<BHome.Domain.TenantContracts.Resident>().Any(person =>
                                    person.Id == m.ResidentId && person.CurrentRoomId == c.RoomId && person.UserId == scope.ActorId))) ||
                         scope.Staff && db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) && assigned.Contains(l.Id))
                    select new { Contract = c, LocationId = l.Id, LocationName = l.Name, r.RoomNumber };
        var total = await query.CountAsync(t);
        var rows = await query.OrderByDescending(c => c.Contract.StartDate).ThenBy(c => c.Contract.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(t);
        var residentIds = rows.Select(r => r.Contract.RepresentativeResidentId).Distinct().ToArray();
        var customers = identityProtection is not null && residentIds.Length > 0
            ? (await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(r => residentIds.Contains(r.Id) && r.VerificationStatus == IdentityVerificationStatus.Verified)
                .ToArrayAsync(t)).Select(NativeResidentPersistence.Read).ToDictionary(r => r.Id)
            : new Dictionary<Guid, Resident>();
        var items = rows.Select(row =>
        {
            var c = row.Contract;
            var summary = new ContractSummary(c.Id, c.RoomId, row.LocationId, row.LocationName, row.RoomNumber,
                c.Kind.ToString(), c.Status.ToString(), c.StartDate, c.EndDate, c.RentAmount,
                c.Kind == BHome.Domain.TenantContracts.ContractKind.Main && c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft,
                c.RequiredDeposit, c.HoldingExpiryAt);
            if (customers.TryGetValue(c.RepresentativeResidentId, out var resident))
                summary = summary with { RepresentativeName = ContractResidentDisplay.Read(resident, identityProtection).Name };
            if (c.Kind != BHome.Domain.TenantContracts.ContractKind.Holding) return summary;
            if (resident is not null) summary = summary with { HoldingCustomer = ReadHoldingCustomer(resident) };
            if (summary.HoldingExpiresAt is not null) return summary;
            try
            {
                var snapshot = c.History.EnumerateArray().Reverse().FirstOrDefault(e => e.ValueKind == JsonValueKind.Object && e.TryGetProperty("recordType", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "Contract");
                if (snapshot.ValueKind == JsonValueKind.Object && snapshot.TryGetProperty("state", out var state) && state.ValueKind == JsonValueKind.Object && state.TryGetProperty("agreedPriceSnapshot", out var price) && price.ValueKind == JsonValueKind.String)
                    return summary with { HoldingExpiresAt = JsonSerializer.Deserialize<HoldingPriceSnapshot>(price.GetString()!)?.HoldingExpiresAt };
            }
            catch (JsonException) { }
            return summary;
        }).ToArray();
        return new(items, page, pageSize, total);
    }
    public async Task FlushAsync(CancellationToken t)
    {
        if (mutation is not null) await mutation.FlushAsync(t);
        if (sidecars?.Active == true) await sidecars.FlushAsync(t);
        await db.SaveChangesAsync(t);
        if (db is not Compact24DbContext compact) return;
        foreach (var deposit in pendingDeposits)
            await NativeDepositVerification.AppendAsync(compact, deposit, t);
        pendingDeposits.Clear();
        foreach (var document in pendingDocuments)
            await ContractDocumentPersistence.AppendAsync(db, document, t);
        pendingDocuments.Clear();
        foreach (var operation in pendingOperations)
            await ContractOperationPersistence.AppendAsync(compact, operation, t);
        pendingOperations.Clear();
        foreach (var audit in pendingAudit)
            await SecurityAuditWrites.AppendAsync(db, audit, t);
        pendingAudit.Clear();
    }
    public async Task<IReadOnlyList<ContractFinalInspection>> FinalInspectionsAsync(Guid contractId, CancellationToken t) =>
        sidecars?.Active == true ? await sidecars.InspectionsAsync(contractId, t) :
        db is Compact24DbContext compact
            ? (await NativeContractMoveOutPersistence.InspectionsAsync(compact, contractId, t)).Take(100).ToArray()
            : await db.Set<ContractFinalInspection>().Where(i => i.ContractId == contractId).OrderByDescending(i => i.Version).Take(100).ToArrayAsync(t);
    public async Task<IReadOnlyList<HandoverReading>> FinalReadingsAsync(Guid contractId, Guid roomId, DateOnly today, CancellationToken t) =>
        db is Compact24DbContext compact
        ? await NativeHandoverTaskPersistence.FinalReadings(compact, contractId, roomId, null, today, true, false).ToArrayAsync(t)
        : await
        (from r in db.Set<MeterReading>().AsNoTracking()
         join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
         join meter in db.Set<Meter>() on r.MeterId equals meter.Id
         join e in db.Set<MeterEvidence>() on r.EvidenceId equals e.Id
         where task.ContractId == contractId && meter.RoomId == roomId && meter.IsActive && task.Purpose == ReadingPurpose.Final && task.ReadingDate == today && task.MeterStatus == MeterTaskStatus.Completed && e.IsUploaded && e.IsLinked
         select new HandoverReading(r.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, r.ConfirmedValue, e.Id, e.ObjectKey, e.ImageHash)).ToArrayAsync(t);
    public Task<HandoverReading?> ConfirmedFinalInspectionReadingAsync(Guid contractId, Guid roomId, Guid readingId, CancellationToken t) =>
        db is Compact24DbContext compact
        ? NativeHandoverTaskPersistence.FinalReadings(compact, contractId, roomId, readingId, null, false, true).SingleOrDefaultAsync(t)
        :
        (from reading in db.Set<MeterReading>().AsNoTracking()
         join task in db.Set<OperationalTask>().AsNoTracking() on reading.TaskId equals task.Id
         join meter in db.Set<Meter>().AsNoTracking() on reading.MeterId equals meter.Id
         join evidence in db.Set<MeterEvidence>().AsNoTracking() on reading.EvidenceId equals evidence.Id
         where reading.Id == readingId && task.ContractId == contractId && meter.RoomId == roomId &&
               task.Purpose == ReadingPurpose.Final && task.MeterStatus == MeterTaskStatus.Completed &&
               task.MeterId == reading.MeterId && evidence.TaskId == task.Id &&
               evidence.IsUploaded && evidence.IsLinked
         select new HandoverReading(reading.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate,
             reading.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash)).SingleOrDefaultAsync(t);
    public Task<bool> StaffAssignedAsync(Guid staffId, Guid locationId, DateOnly today, CancellationToken t) =>
        db is Compact24DbContext
            ? db.Database.SqlQuery<Guid>($"""
                SELECT l.id AS "Value" FROM locations l
                CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
                WHERE l.id={locationId} AND (a->>'staffUserId')::uuid={staffId}
                  AND (a->>'startDate')::date<={today} AND (a->>'endDate')::date>={today}
                """).AnyAsync(_ => db.EligibleStaffIds(today).Contains(staffId), t)
            : db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == staffId && a.LocationId == locationId &&
                a.StartDate <= today && a.EndDate >= today && db.EligibleStaffIds(today).Contains(staffId), t);
    public async Task<IReadOnlyList<Contract>> RoomActiveContractsAsync(Guid roomId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var ids = await NativeContracts().Where(c => c.RoomId == roomId && c.Status == ContractStatus.Active &&
                (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal)).OrderBy(c => c.Id).Select(c => c.Id).ToArrayAsync(t);
            var values = new List<Contract>(ids.Length);
            foreach (var id in ids) values.Add(await FindAsync(id, t) ?? throw ContractException.Missing());
            return values;
        }
        return await db.Set<Contract>().Include(c => c.Room).ThenInclude(r => r.Location)
            .Include(c => c.Room).ThenInclude(r => r.RoomType).Include(c => c.Residents)
            .Where(c => c.RoomId == roomId && c.Status == ContractStatus.Active &&
                (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal))
            .OrderBy(c => c.Id).AsSplitQuery().ToArrayAsync(t);
    }
    public async Task<IReadOnlyList<ContractMoveOutHistory>> MoveOutHistoryAsync(Guid contractId, CancellationToken t) =>
        db is Compact24DbContext compact ? (await NativeContractMoveOutPersistence.MoveHistoryAsync(compact, contractId, t)).Take(100).ToArray()
        : await db.Set<ContractMoveOutHistory>().AsNoTracking().Where(h => h.ContractId == contractId).OrderByDescending(h => h.Version).Take(100).ToArrayAsync(t);
    public async Task<IReadOnlyList<MoveOutAssignment>> AssignmentsAsync(Guid staffId, DateOnly today, CancellationToken t) =>
        db is Compact24DbContext compact
        ? await NativeMoveOutAssignmentsAsync(compact, staffId, today, t)
        : await
        (from m in db.Set<ContractMoveOut>().AsNoTracking()
         join c in db.Set<Contract>() on m.ContractId equals c.Id
         where (m.InspectionStaffId == null || m.InspectionStaffId == staffId) &&
           m.Status != MoveOutStatus.Requested && m.Status != MoveOutStatus.AwaitingConsent &&
           m.Status != MoveOutStatus.Completed && m.Status != MoveOutStatus.Rejected &&
           c.Status == ContractStatus.Active && c.Room.Location.IsActive &&
           db.EligibleStaffIds(today).Contains(staffId) &&
           db.StaffLocationAssignments.Any(a => a.StaffUserId == staffId && a.LocationId == c.Room.LocationId && a.StartDate <= today && a.EndDate >= today)
         orderby m.ProposedDate, m.ContractId
         select new MoveOutAssignment(c.Id, c.RoomId, c.Room.RoomNumber, c.Room.Location.Name, m.Status.ToString(), m.ProposedDate, m.InspectionScheduledAt, m.Version)).Take(100).ToArrayAsync(t);
    private static async Task<MoveOutAssignment[]> NativeMoveOutAssignmentsAsync(Compact24DbContext compact, Guid staffId, DateOnly today, CancellationToken t)
    {
        if (!await StaffEmploymentEligibility.IsEligibleAsync(compact, staffId, today, t)) return [];
        var rows = await compact.Database.SqlQuery<MoveOutAssignmentRow>($"""
            SELECT c.id AS "ContractId",r.id AS "RoomId",r.room_number AS "RoomNumber",l.name AS "LocationName",
                (m->>'status')::int AS "Status",(m->>'proposedDate')::date AS "ProposedDate",
                (m->>'inspectionScheduledAt')::timestamptz AS "ScheduledAt",(m->>'version')::int AS "Version"
            FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN locations l ON l.id=r.location_id
            CROSS JOIN LATERAL (SELECT c.move_out->'current' AS m) s
            WHERE c.status={(short)ContractStatus.Active} AND c.contract_type IN ('MAIN','RENEWAL','HOLDING','ADDENDUM')
                AND l.is_active AND jsonb_typeof(m)='object'
                AND (m->>'inspectionStaffId' IS NULL OR (m->>'inspectionStaffId')::uuid={staffId})
                AND (m->>'status')::int NOT IN ({(int)MoveOutStatus.Requested},{(int)MoveOutStatus.AwaitingConsent},
                    {(int)MoveOutStatus.Completed},{(int)MoveOutStatus.Rejected})
                AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a
                    WHERE (a->>'staffUserId')::uuid={staffId} AND (a->>'startDate')::date<={today}
                      AND (a->>'endDate')::date>={today})
            ORDER BY (m->>'proposedDate')::date,c.id LIMIT 100
            """).ToArrayAsync(t);
        return rows.Select(m => new MoveOutAssignment(m.ContractId, m.RoomId, m.RoomNumber, m.LocationName,
            ((MoveOutStatus)m.Status).ToString(), m.ProposedDate, m.ScheduledAt, m.Version)).ToArray();
    }
    private sealed record MoveOutAssignmentRow(Guid ContractId, Guid RoomId, string RoomNumber, string LocationName,
        int Status, DateOnly ProposedDate, DateTimeOffset? ScheduledAt, int Version);
    private sealed record InboxRow(Guid ContractId, string RoomNumber, Guid LocationId, string LocationName,
        int Status, DateOnly ProposedDate, DateTimeOffset? InspectedAt, string? OwnerDecision);
    public async Task<IReadOnlyList<ContractChoice>> MoveOutInboxRoomsAsync(Guid locationId, CancellationToken t)
    {
        if (db is Compact24DbContext)
            return await db.Database.SqlQuery<ContractChoice>($"""
                SELECT DISTINCT r.id AS "Id", r.room_number AS "Label"
                FROM contracts c JOIN rooms r ON r.id=c.room_id
                WHERE r.location_id={locationId} AND c.contract_type IN ('MAIN','RENEWAL','HOLDING','ADDENDUM')
                    AND jsonb_typeof(c.move_out->'current')='object'
                ORDER BY "Label", "Id"
                """).ToArrayAsync(t);
        var rows = await (from move in db.Set<ContractMoveOut>().AsNoTracking()
                          join contract in db.Set<Contract>().AsNoTracking() on move.ContractId equals contract.Id
                          where contract.Room.LocationId == locationId
                          select new { contract.RoomId, contract.Room.RoomNumber })
            .Distinct().OrderBy(room => room.RoomNumber).ThenBy(room => room.RoomId).ToArrayAsync(t);
        return rows.Select(room => new ContractChoice(room.RoomId, room.RoomNumber)).ToArray();
    }
    public async Task<OwnerMoveOutInboxPage> OwnerMoveOutInboxAsync(int page, int pageSize,
        Guid? locationId, MoveOutStatus? status, string? room, CancellationToken t,
        Guid? roomId = null, string? stage = null)
    {
        InboxRow[] rows;
        int total;
        if (db is Compact24DbContext compact)
        {
            var pattern = string.IsNullOrWhiteSpace(room) ? null : "%" + room + "%";
            var requestedStatus = (int?)status;
            var query = compact.Database.SqlQuery<InboxRow>($"""
                SELECT c.id AS "ContractId",r.room_number AS "RoomNumber",r.location_id AS "LocationId",l.name AS "LocationName",
                    (m->>'status')::int AS "Status",(m->>'proposedDate')::date AS "ProposedDate",
                    (i->>'inspectedAt')::timestamptz AS "InspectedAt",i->>'ownerDecision' AS "OwnerDecision"
                FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN locations l ON l.id=r.location_id
                CROSS JOIN LATERAL (SELECT c.move_out->'current' AS m) s
                LEFT JOIN LATERAL (SELECT value AS i FROM jsonb_array_elements(COALESCE(c.move_out->'inspections','[]'::jsonb))
                    ORDER BY (value->>'version')::int DESC LIMIT 1) inspection ON true
                LEFT JOIN LATERAL (
                    SELECT entry.value FROM jsonb_array_elements(c.history) WITH ORDINALITY entry(value, position)
                    WHERE entry.value->>'recordType'='MoveOutChargeProposalV1' ORDER BY entry.position DESC LIMIT 1
                ) proposal ON true
                LEFT JOIN LATERAL (
                    SELECT entry.value FROM jsonb_array_elements(c.history) WITH ORDINALITY entry(value, position)
                    WHERE entry.value->>'recordType'='MoveOutChargeProposalFeedbackV1'
                        AND entry.value->'state'->>'proposalId'=proposal.value->'state'->>'id'
                    ORDER BY entry.position DESC LIMIT 1
                ) feedback ON true
                LEFT JOIN LATERAL (
                    SELECT entry.value FROM jsonb_array_elements(c.history) WITH ORDINALITY entry(value, position)
                    WHERE entry.value->>'recordType'='MoveOutChargeProposalSettlementV1'
                        AND entry.value->'state'->>'proposalId'=proposal.value->'state'->>'id'
                        AND entry.value->'state'->>'feedbackId'=feedback.value->'state'->>'id'
                    ORDER BY entry.position DESC LIMIT 1
                ) resolution ON true
                CROSS JOIN LATERAL (SELECT COALESCE(proposal.value IS NOT NULL AND (feedback.value IS NULL OR
                    (feedback.value->'state'->>'confirmed'='true' AND (
                        COALESCE(resolution.value->'state'->'settlement'->>'status',feedback.value->'state'->'settlement'->>'status')='Payable'
                        OR (COALESCE(resolution.value->'state'->'settlement'->>'status',feedback.value->'state'->'settlement'->>'status')='RefundEligible'
                            AND NOT EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.source_deposit_contract_id=c.id AND rr.status IN ('REQUESTED','APPROVED','COMPLETED')))
                    ))),false) AS tenant) pending
                WHERE c.contract_type IN ('MAIN','RENEWAL','HOLDING','ADDENDUM') AND jsonb_typeof(m)='object'
                    AND (CAST({roomId} AS uuid) IS NULL OR r.id={roomId})
                    AND (CAST({stage} AS text) IS NULL OR CASE CAST({stage} AS text)
                        WHEN 'Staff' THEN (m->>'status')::int={(int)MoveOutStatus.Approved}
                        WHEN 'Completed' THEN (m->>'status')::int={(int)MoveOutStatus.Completed}
                        WHEN 'Tenant' THEN (m->>'status')::int={(int)MoveOutStatus.AwaitingConsent} OR
                            ((m->>'status')::int IN ({(int)MoveOutStatus.Inspected},{(int)MoveOutStatus.PendingSettlement}) AND pending.tenant)
                        WHEN 'Owner' THEN (m->>'status')::int IN ({(int)MoveOutStatus.Requested},{(int)MoveOutStatus.Settled}) OR
                            ((m->>'status')::int IN ({(int)MoveOutStatus.Inspected},{(int)MoveOutStatus.PendingSettlement}) AND NOT pending.tenant)
                        ELSE false END)
                    AND (CAST({requestedStatus} AS integer) IS NULL OR (m->>'status')::int={requestedStatus})
                    AND (CAST({locationId} AS uuid) IS NULL OR r.location_id={locationId})
                    AND (CAST({pattern} AS text) IS NULL OR r.room_number ILIKE {pattern})
                """);
            total = await query.CountAsync(t);
            rows = await query.OrderByDescending(m => m.ProposedDate).ThenBy(m => m.ContractId)
                .Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(t);
        }
        else
        {
            var moves = db.Set<ContractMoveOut>().AsNoTracking().AsQueryable();
            if (stage == "Staff") moves = moves.Where(move => move.Status == MoveOutStatus.Approved);
            else if (stage == "Completed") moves = moves.Where(move => move.Status == MoveOutStatus.Completed);
            else if (stage == "Tenant") moves = moves.Where(move => move.Status == MoveOutStatus.AwaitingConsent);
            else if (stage == "Owner") moves = moves.Where(move => move.Status == MoveOutStatus.Requested || move.Status == MoveOutStatus.Settled ||
                move.Status == MoveOutStatus.Inspected || move.Status == MoveOutStatus.PendingSettlement);
            if (status is { } state) moves = moves.Where(move => move.Status == state);
            var contracts = db.Set<Contract>().AsNoTracking().AsQueryable();
            if (locationId is { } location) contracts = contracts.Where(c => c.Room.LocationId == location);
            if (roomId is { } exactRoom) contracts = contracts.Where(c => c.RoomId == exactRoom);
            if (!string.IsNullOrWhiteSpace(room)) contracts = contracts.Where(c => EF.Functions.ILike(c.Room.RoomNumber, "%" + room + "%"));
            var query = from move in moves
                        join contract in contracts on move.ContractId equals contract.Id
                        select new InboxRow(contract.Id,
                            contract.Room.RoomNumber,
                            contract.Room.LocationId,
                            contract.Room.Location.Name,
                            (int)move.Status,
                            move.ProposedDate,
                            db.Set<ContractFinalInspection>().Where(i => i.ContractId == contract.Id)
                                .OrderByDescending(i => i.Version).Select(i => (DateTimeOffset?)i.InspectedAt).FirstOrDefault(),
                            db.Set<ContractFinalInspection>().Where(i => i.ContractId == contract.Id)
                                .OrderByDescending(i => i.Version).Select(i => i.OwnerDecision).FirstOrDefault());
            total = await query.CountAsync(t);
            rows = await query.OrderByDescending(m => m.ProposedDate).ThenBy(m => m.ContractId)
                .Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(t);
        }
        // MoveOut.Status tracks the physical Staff workflow, while tenant fee
        // agreement and automatic settlement are immutable events in contract
        // history. Fetch those events for this page in ONE scoped query so the
        // inbox never regresses to "Staff result received" after Tenant accepts.
        var proposalProgress = new Dictionary<Guid, (string? ProposalStatus, string? SettlementStatus)>();
        if (db is Compact24DbContext && rows.Length > 0)
        {
            var contractIds = rows.Select(row => row.ContractId).ToArray();
            var snapshots = await db.Database.SqlQuery<string>($"""
                SELECT jsonb_build_object(
                    'contractId', c.id,
                    'proposalId', proposal.value->'state'->>'id',
                    'confirmed', feedback.value->'state'->>'confirmed',
                    'settlementStatus', COALESCE(
                        resolution.value->'state'->'settlement'->>'status',
                        feedback.value->'state'->'settlement'->>'status'
                    )
                )::text AS "Value"
                FROM contracts c
                LEFT JOIN LATERAL (
                    SELECT entry.value FROM jsonb_array_elements(c.history) WITH ORDINALITY entry(value, position)
                    WHERE entry.value->>'recordType'='MoveOutChargeProposalV1'
                    ORDER BY entry.position DESC LIMIT 1
                ) proposal ON true
                LEFT JOIN LATERAL (
                    SELECT entry.value FROM jsonb_array_elements(c.history) WITH ORDINALITY entry(value, position)
                    WHERE entry.value->>'recordType'='MoveOutChargeProposalFeedbackV1'
                      AND entry.value->'state'->>'proposalId'=proposal.value->'state'->>'id'
                    ORDER BY entry.position DESC LIMIT 1
                ) feedback ON true
                LEFT JOIN LATERAL (
                    SELECT entry.value FROM jsonb_array_elements(c.history) WITH ORDINALITY entry(value, position)
                    WHERE entry.value->>'recordType'='MoveOutChargeProposalSettlementV1'
                      AND entry.value->'state'->>'proposalId'=proposal.value->'state'->>'id'
                      AND entry.value->'state'->>'feedbackId'=feedback.value->'state'->>'id'
                    ORDER BY entry.position DESC LIMIT 1
                ) resolution ON true
                WHERE c.id=ANY({contractIds})
                """).ToArrayAsync(t);
            foreach (var json in snapshots)
            {
                using var document = JsonDocument.Parse(json);
                var row = document.RootElement;
                var contractId = row.GetProperty("contractId").GetGuid();
                var proposalId = row.GetProperty("proposalId");
                if (proposalId.ValueKind == JsonValueKind.Null) continue;
                var confirmed = row.GetProperty("confirmed");
                var proposalStatus = confirmed.ValueKind == JsonValueKind.Null ? "PendingTenant" :
                    confirmed.GetString() == "true" ? "Accepted" : "Disputed";
                var settlement = row.GetProperty("settlementStatus");
                proposalProgress[contractId] = (proposalStatus,
                    settlement.ValueKind == JsonValueKind.String ? settlement.GetString() : null);
            }
        }
        return new(rows.Select(row => new OwnerMoveOutInboxItem(row.ContractId, row.RoomNumber,
            row.LocationId, row.LocationName, ((MoveOutStatus)row.Status).ToString(), row.ProposedDate, row.InspectedAt,
            row.OwnerDecision == "Confirmed",
            proposalProgress.GetValueOrDefault(row.ContractId).ProposalStatus,
            proposalProgress.GetValueOrDefault(row.ContractId).SettlementStatus)).ToArray(), page, pageSize, total);
    }
    public async Task<T> InTransactionAsync<T>(Guid roomId, Func<Task<T>> work, CancellationToken t)
    {
        // Order: payment ledger -> Location advisory -> Room row. Property and Invoice start at
        // Location and never acquire the ledger afterward. Re-read domain state only after locking.
        db.ChangeTracker.Clear();
        pendingDocuments.Clear();
        pendingOperations.Clear();
        pendingAudit.Clear();
        pendingDeposits.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
            var locationId = (db is Compact24DbContext
                ? await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t)
                : await db.Set<Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t)) ?? throw ContractException.Missing();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
            if (!(db is Compact24DbContext
                ? (await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM rooms WHERE id={roomId} FOR UPDATE").ToArrayAsync(t)).Length != 0
                : await db.Locked<Room>(roomId).AnyAsync(t)))
                throw ContractException.Missing();
            if (db is Compact24DbContext compact)
            {
                mutation = new(compact);
                sidecars?.Begin(compact);
            }
            var value = await work();
            await FlushAsync(t);
            await transaction.CommitAsync(t); return value;
        }
        catch (DbUpdateConcurrencyException)
        { throw ContractException.Conflict("contract_concurrent_operation_retry"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23P01" or "23514" })
        {
            var postgres = (PostgresException)e.InnerException!;
            logger.LogWarning("Contract database conflict with SQL state {SqlState} and constraint {Constraint}", postgres.SqlState, postgres.ConstraintName);
            if (postgres.SqlState == "23505" && postgres.ConstraintName == "ux_resident_contact_email")
                throw ContractException.Conflict("signing_email_already_in_use");
            throw ContractException.Conflict("contract_concurrent_or_duplicate_operation");
        }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01" or "23514" or "23505" or "23P01")
        { throw ContractException.Conflict("contract_concurrent_operation_retry"); }
        finally
        {
            mutation = null;
            sidecars?.Clear();
            pendingDocuments.Clear();
            pendingOperations.Clear();
            pendingAudit.Clear();
            pendingDeposits.Clear();
        }
    }
    public Task<Contract?> FindAsync(Guid id, CancellationToken t) => mutation is not null ? mutation.FindAsync(id, t)
        : db is Compact24DbContext compact ? NativeContractSnapshot.LoadAsync(compact, id, t)
        : db.Set<Contract>().Include(c => c.Room).ThenInclude(r => r.Location)
        .Include(c => c.Room).ThenInclude(r => r.RoomType)
        .Include(c => c.Residents).Include(c => c.Signatures).AsSplitQuery().SingleOrDefaultAsync(c => c.Id == id, t);
    public Task<Room?> RoomAsync(Guid id, CancellationToken t) => mutation is not null ? mutation.RoomAsync(id, t)
        : db is Compact24DbContext compact ? new NativeContractMutation(compact).RoomAsync(id, t)
        : db.Set<Room>().Include(r => r.Location).SingleOrDefaultAsync(r => r.Id == id, t);
    public async Task<IReadOnlyList<Resident>> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t)
        => mutation is not null ? await mutation.ResidentsAsync(roomId, ids, t)
        : db is Compact24DbContext
            ? (await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(r => r.CurrentRoomId == roomId && ids.Contains(r.Id)).ToArrayAsync(t)).Select(NativeResidentPersistence.Read).ToArray()
            : await db.Set<Resident>().Where(r => r.RoomId == roomId && ids.Contains(r.Id)).ToArrayAsync(t);
    public Task<bool> ActiveUserInRoleAsync(Guid id, string role, CancellationToken t) =>
        db is Compact24DbContext
        ? db.Users.AsNoTracking().AnyAsync(u => u.Id == id && u.IsActive && EF.Property<string[]>(u, "roles").Contains(role), t)
        : (from u in db.Users
           join ur in db.UserRoles on u.Id equals ur.UserId
           join r in db.Roles on ur.RoleId equals r.Id
           where u.Id == id && u.IsActive && r.Name == role
           select u.Id).AnyAsync(t);
    public Task<string?> DecisionActorNameAsync(Guid userId, CancellationToken t)
    {
        var users = db.Users.AsNoTracking().Where(u => u.Id == userId);
        return db.Model.FindEntityType(typeof(User))?.FindProperty("full_name") is not null
            ? users.Select(u => EF.Property<string?>(u, "full_name") ?? u.UserName).SingleOrDefaultAsync(t)
            : users.Select(u => u.UserName).SingleOrDefaultAsync(t);
    }
    public async Task<bool> ConflictsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, Guid[] residentIds, CancellationToken t)
    {
        var capacity = db is Compact24DbContext
            ? (int)await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => r.Capacity).SingleAsync(t)
            : await db.Set<Room>().Where(r => r.Id == roomId).Select(r => r.Capacity).SingleAsync(t);
        var others = db is Compact24DbContext
            ? await NativeContractsWithMembersAsync(NativeContracts().Where(c => c.RoomId == roomId && c.Id != exceptId &&
                c.ContractType != BHome.Domain.TenantContracts.ContractKind.Holding && c.Status == ContractStatus.Active && c.StartDate <= to && c.EndDate >= from), t)
            : await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).Where(c => c.RoomId == roomId && c.Id != exceptId &&
                c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.StartDate <= to && c.EndDate >= from).ToArrayAsync(t);
        if (others.Any(c => c.Residents.Any(r => residentIds.Contains(r.ResidentId)))) return true;
        var dates = others.Select(c => c.StartDate < from ? from : c.StartDate).Append(from).Distinct();
        return dates.Any(date => residentIds.Length + others.Where(c => c.StartDate <= date && c.EndDate >= date).SelectMany(c => c.Residents).Select(r => r.ResidentId).Distinct().Count() > capacity);
    }
    public async Task<IReadOnlySet<Guid>> RoomsAwaitingMainOwnerSignatureAsync(Guid[] roomIds, Guid exceptContractId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var nativePending = (await NativeContracts().Where(c => roomIds.Contains(c.RoomId) && c.Id != exceptContractId &&
                c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main && c.Status == ContractStatus.PendingSigning).ToArrayAsync(t))
                .Select(NativeContractSnapshot.Read).ToArray();
            var ids = nativePending.Select(c => c.Id).ToArray();
            var signatures = (await db.Set<BHome.Domain.TenantContracts.ContractSigning>().AsNoTracking().Where(s => ids.Contains(s.ContractId)).ToArrayAsync(t))
                .Select(NativeContractSnapshot.Read).ToLookup(s => s.ContractId);
            foreach (var c in nativePending) c.Signatures = signatures[c.Id].ToList();
            return nativePending.Where(AnonymousContractSigningService.MainAwaitsOwnerSignature).Select(c => c.RoomId).ToHashSet();
        }
        var pending = await db.Set<Contract>().AsNoTracking().Include(c => c.Signatures)
            .Where(c => roomIds.Contains(c.RoomId) && c.Id != exceptContractId &&
                c.Kind == ContractKind.Main && c.Status == ContractStatus.PendingSigning).ToArrayAsync(t);
        return pending.Where(AnonymousContractSigningService.MainAwaitsOwnerSignature).Select(c => c.RoomId).ToHashSet();
    }
    public Task<bool> HasOtherActiveContractsAsync(Guid roomId, Guid exceptId, CancellationToken t) =>
        db is Compact24DbContext
        ? NativeContracts().AnyAsync(c => c.RoomId == roomId && c.Id != exceptId && c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Expired), t)
        : db.Set<Contract>().AnyAsync(c => c.RoomId == roomId && c.Id != exceptId && c.Kind == ContractKind.Main &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Expired), t);
    public Task<bool> OpenRenewalAsync(Guid contractId, CancellationToken t) => db is Compact24DbContext
        ? NativeContracts().AnyAsync(c => c.PreviousContractId == contractId &&
            (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation), t)
        : db.Set<Contract>().AnyAsync(c => c.PreviousContractId == contractId &&
        (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation), t);
    public async Task<IReadOnlyList<Contract>> VersionsAsync(Guid roomId, Guid tenantId, CancellationToken t) =>
        db is Compact24DbContext
        ? (await NativeContracts().Where(c => c.RoomId == roomId && c.TenantUserId == tenantId).OrderBy(c => c.StartDate).Take(501).ToArrayAsync(t)).Select(NativeContractSnapshot.Read).ToArray()
        : await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == roomId && c.TenantUserId == tenantId).OrderBy(c => c.StartDate).Take(501).ToArrayAsync(t);

    private IQueryable<BHome.Domain.TenantContracts.Contract> NativeContracts() => db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking()
        .Where(c => c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Holding || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Addendum);

    private async Task<Contract[]> NativeContractsWithMembersAsync(IQueryable<BHome.Domain.TenantContracts.Contract> query, CancellationToken t)
    {
        var contracts = (await query.ToArrayAsync(t)).Select(NativeContractSnapshot.Read).ToArray();
        var ids = contracts.Select(c => c.Id).ToArray();
        var members = (await db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking().Where(m => ids.Contains(m.ContractId)).ToArrayAsync(t))
            .ToLookup(m => m.ContractId);
        foreach (var c in contracts) c.Residents = members[c.Id].ToList();
        return contracts;
    }
    public async Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t)
    {
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            return await db.Database.SqlQuery<decimal>($"""
                SELECT COALESCE(sum(a.amount),0) AS "Value" FROM payment_allocations a
                JOIN payments p ON p.id=a.source_payment_id
                WHERE a.target_deposit_contract_id={contractId} AND p.status='VERIFIED'
                """).SingleAsync(t);
        return await db.Set<DepositVerification>().Where(d => d.ContractId == contractId).SumAsync(d => (decimal?)d.Amount, t) ?? 0;
    }
    public Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t) =>
        db is Compact24DbContext compact ? NativeDepositVerification.FindAsync(compact, reference, t) :
            db.Set<DepositVerification>().SingleOrDefaultAsync(d => d.BankTransactionReference == reference, t);
    public async Task<ResolvedPrices> ResolvePricesAsync(Guid roomId, DateOnly effectiveOn, CancellationToken t)
    {
        var room = db is Compact24DbContext
            ? NativeRoomLocationPersistence.Read(await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().SingleAsync(r => r.Id == roomId, t))
            : await db.Set<Room>().AsNoTracking().SingleAsync(r => r.Id == roomId, t);
        var candidates = db is Compact24DbContext
            ? (await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking().Where(x => x.LocationId == room.LocationId &&
                x.EffectiveFrom <= effectiveOn && (x.EffectiveTo == null || x.EffectiveTo >= effectiveOn)).ToArrayAsync(t))
                .Select(NativePolicyPersistence.Read).Where(x =>
                    x.RoomId == roomId || x.RoomTypeId == room.RoomTypeId && x.RoomTypeId != null || x.RoomId == null && x.RoomTypeId == null).ToArray()
            : await db.Set<BillingPolicy>().AsNoTracking().Where(x => x.LocationId == room.LocationId &&
            (x.RoomId == roomId || x.RoomTypeId == room.RoomTypeId && x.RoomTypeId != null || x.RoomId == null && x.RoomTypeId == null) &&
            x.EffectiveFrom <= effectiveOn && (x.EffectiveTo == null || x.EffectiveTo >= effectiveOn)).ToArrayAsync(t);
        var charges = candidates.GroupBy(x => x.ChargeCode).Select(g =>
            g.OrderByDescending(x => x.RoomId.HasValue ? 2 : x.RoomTypeId.HasValue ? 1 : 0).First())
            .OrderBy(x => x.ChargeCode, StringComparer.Ordinal).Select(PropertyService.Map).ToArray();
        return new(roomId, effectiveOn, charges, new[] { "RENT", "ELECTRICITY", "WATER" }.Except(charges.Select(x => x.ChargeCode)).ToArray());
    }
    public async Task<bool> HasUtilityProfileAsync(Guid roomId, DateOnly from, DateOnly to, CancellationToken t)
    {
        if (setup is null) return false;
        var location = await setup.RoomLocationAsync(roomId, t) ?? throw ContractException.Missing();
        var profiles = (await setup.ListAsync(location, "UtilityProfile", t))
            .Select(d => (d.Id, Profile: d.Data.Deserialize<UtilityProfileWrite>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!))
            .Where(d => d.Profile.RoomId == roomId).ToArray();
        return profiles.Any(d =>
        {
            var replacement = profiles.Where(next => next.Profile.ReplacesId == d.Id)
                .Select(next => (DateOnly?)next.Profile.EffectiveFrom).Min();
            var effectiveTo = d.Profile.EffectiveTo;
            if (replacement is { } next && (effectiveTo is null || effectiveTo >= next))
                effectiveTo = next.AddDays(-1);
            return d.Profile.EffectiveFrom <= to && (effectiveTo is null || effectiveTo >= from);
        });
    }
    public async Task<IReadOnlyList<Contract>> BindingContractsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var native = await NativeContractsWithMembersAsync(NativeContracts().Where(c => c.RoomId == roomId && c.Id != exceptId &&
                c.ContractType != BHome.Domain.TenantContracts.ContractKind.Addendum && c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.PendingSigning ||
                 c.Status == ContractStatus.PendingActivation || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Holding && c.Status == ContractStatus.Draft)), t);
            return native.Where(c => c.Status != ContractStatus.Draft || c.ApprovedAt != null).ToArray();
        }
        var contracts = db.Set<Contract>().AsNoTracking().Include(c => c.Residents)
            .Where(c => c.RoomId == roomId && c.Id != exceptId && c.Kind != ContractKind.Addendum &&
                c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from);
        contracts = contracts.Where(c => c.Status == ContractStatus.Active ||
            c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation);
        return await contracts.ToArrayAsync(t);
    }
    public Task<bool> HoldingConflictAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t)
    {
        if (db is Compact24DbContext)
            return NativeContracts().AnyAsync(c => c.RoomId == roomId && c.Id != exceptId && c.StartDate <= to && c.EndDate >= from &&
                (c.Status == ContractStatus.Active || c.ContractType != BHome.Domain.TenantContracts.ContractKind.Addendum &&
                (c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Draft) &&
                (db.Set<BHome.Domain.TenantContracts.ContractSigning>().Any(s => s.ContractId == c.Id && s.SigningStatus != SignatureStatus.Failed) ||
                 db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.TargetDepositContractId == c.Id && a.Amount > 0))), t);
        var candidates = db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == roomId && c.Id != exceptId && c.StartDate <= to && c.EndDate >= from);
        return candidates.AnyAsync(c => c.Status == ContractStatus.Active ||
            c.Kind != ContractKind.Addendum &&
            (c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Draft) &&
            (c.Signatures.Any(s => s.Status != SignatureStatus.Failed) || db.Set<DepositVerification>().Any(d => d.ContractId == c.Id && d.Amount > 0)), t);
    }
    public async Task<Contract?> MainForHoldingAsync(Guid holdingId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var id = await NativeContracts().Where(c => c.SourceHoldingContractId == holdingId).Select(c => (Guid?)c.Id).SingleOrDefaultAsync(t);
            return id is { } value ? await FindAsync(value, t) : null;
        }
        return await db.Set<Contract>()
        .Include(c => c.Room).ThenInclude(r => r.Location).Include(c => c.Room).ThenInclude(r => r.RoomType)
        .Include(c => c.Residents).Include(c => c.Signatures).AsSplitQuery()
        .SingleOrDefaultAsync(c => c.HoldingContractId == holdingId, t);
    }
    public Task<ContractMoveOut?> MoveOutAsync(Guid contractId, CancellationToken t) =>
        sidecars?.Active == true ? sidecars.MoveAsync(contractId, t) :
        db is Compact24DbContext compact ? NativeContractMoveOutPersistence.MoveAsync(compact, contractId, t)
        : db.Set<ContractMoveOut>().SingleOrDefaultAsync(m => m.ContractId == contractId, t);
    public async Task<IReadOnlyList<ContractInspectionEvidence>> InspectionEvidenceAsync(Guid contractId, CancellationToken t) =>
        sidecars?.Active == true ? await sidecars.EvidenceAsync(contractId, t) :
        db is Compact24DbContext compact
        ? (await NativeContractMoveOutPersistence.EvidenceAsync(compact, contractId, t)).Take(50).ToArray()
        : await db.Set<ContractInspectionEvidence>().Where(e => e.ContractId == contractId).Take(50).ToArrayAsync(t);
    public async Task<IReadOnlyList<ContractSettlementReview>> SettlementReviewsAsync(Guid contractId, CancellationToken t) =>
        db is Compact24DbContext compact ? (await NativeContractMoveOutPersistence.ReviewsAsync(compact, contractId, t)).Take(100).ToArray()
        : await db.Set<ContractSettlementReview>().AsNoTracking().Where(r => r.ContractId == contractId).OrderByDescending(r => r.ReviewedAt).ThenBy(r => r.Id).Take(100).ToArrayAsync(t);
    public Task<bool> ValidFinalReadingAsync(Guid readingId, Guid contractId, Guid roomId, UtilityType type, DateOnly readingDate, CancellationToken t) =>
        db is Compact24DbContext compact
        ? NativeHandoverTaskPersistence.FinalReadings(compact, contractId, roomId, readingId, readingDate, true, false)
            .AnyAsync(r => r.UtilityType == (int)type, t)
        :
        (from r in db.Set<MeterReading>()
         join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
         join meter in db.Set<Meter>() on r.MeterId equals meter.Id
         join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
         where r.Id == readingId && task.ContractId == contractId && meter.RoomId == roomId && meter.IsActive && meter.UtilityType == type &&
             task.ReadingDate == readingDate && task.MeterStatus == MeterTaskStatus.Completed && task.Purpose == ReadingPurpose.Final &&
             evidence.IsUploaded && evidence.IsLinked && r.ConfirmedAt != default
         select r.Id).AnyAsync(t);
    public Task<ContractOperation?> OperationAsync(Guid actorId, Guid key, string operation, CancellationToken t) =>
        db is Compact24DbContext compact
            ? ContractOperationPersistence.ReadAsync(compact, actorId, key, operation, t)
            : db.Set<ContractOperation>().SingleOrDefaultAsync(o => o.ActorId == actorId && o.Key == key && o.Operation == operation, t);
    public void Add(object entity)
    {
        if (db is Compact24DbContext)
        {
            if (db.Database.CurrentTransaction is null)
                throw new InvalidOperationException("Contract writes require the repository transaction.");
            if (entity is ContractDocumentFile document) { pendingDocuments.Add(document); return; }
            if (entity is ContractOperation operation) { pendingOperations.Add(operation); return; }
            if (entity is DepositVerification deposit) { pendingDeposits.Add(deposit); return; }
            if (sidecars?.Active == true)
            {
                if (entity is ContractMoveOut move) { sidecars.Add(move); return; }
                if (entity is ContractHandover handover) { sidecars.Add(handover); return; }
                if (entity is ContractFinalInspection inspection) { sidecars.Add(inspection); return; }
                if (entity is ContractInspectionEvidence evidence) { sidecars.Add(evidence); return; }
                if (entity is ContractMoveOutHistory moveHistory) { sidecars.Add(moveHistory); return; }
                if (entity is ContractHandoverHistory handoverHistory) { sidecars.Add(handoverHistory); return; }
                if (entity is ContractSettlementReview review) { sidecars.Add(review); return; }
            }
            if (mutation is not null)
            {
                if (entity is Contract root)
                {
                    mutation.Add(root);
                    return;
                }
                if (entity is ContractSigning signature) { mutation.Add(signature); return; }
                if (entity is ContractResident member) { mutation.Add(member); return; }
                if (entity is PropertyChange change) { mutation.Audit(change); return; }
            }
        }
        db.Add(entity);
    }
    public async Task<IReadOnlyList<ContractOccupantView>> OccupantsAsync(Guid contractId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var rows = await (from cr in db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking()
                              join resident in db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking() on cr.ResidentId equals resident.Id
                              where cr.ContractId == contractId
                              select new { Resident = resident, Role = cr.ResidentRole }).ToArrayAsync(t);
            return rows.Select(o => new ContractOccupantView(o.Resident.Id,
                ContractResidentDisplay.Read(NativeResidentPersistence.Read(o.Resident), identityProtection).Name,
                o.Role == ResidentType.Representative)).ToArray();
        }
        var occupants = await (from cr in db.Set<ContractResident>().AsNoTracking()
                               join resident in db.Set<Resident>() on cr.ResidentId equals resident.Id
                               where cr.ContractId == contractId
                               select new { Resident = resident, cr.Role }).ToArrayAsync(t);
        return occupants.Select(o => new ContractOccupantView(o.Resident.Id,
            ContractResidentDisplay.Read(o.Resident, identityProtection).Name, o.Role == ResidentType.Representative)).ToArray();
    }
    public async Task<HoldingCustomerView?> HoldingCustomerAsync(Guid contractId, Guid residentId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var row = await (from cr in db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking()
                             join r in db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking() on cr.ResidentId equals r.Id
                             where cr.ContractId == contractId && cr.ResidentId == residentId &&
                               cr.ResidentRole == ResidentType.Representative && r.VerificationStatus == IdentityVerificationStatus.Verified
                             select r).SingleOrDefaultAsync(t);
            return row is null ? null : ReadHoldingCustomer(NativeResidentPersistence.Read(row));
        }
        var resident = await (from cr in db.Set<ContractResident>().AsNoTracking()
                              join r in db.Set<Resident>().AsNoTracking() on cr.ResidentId equals r.Id
                              where cr.ContractId == contractId && cr.ResidentId == residentId && cr.Role == ResidentType.Representative && r.VerificationStatus == IdentityVerificationStatus.Verified
                              select r).SingleOrDefaultAsync(t);
        return resident is null ? null : ReadHoldingCustomer(resident);
    }
    private HoldingCustomerView? ReadHoldingCustomer(Resident resident)
    {
        if (identityProtection is null || string.IsNullOrWhiteSpace(resident.IdentityData) || resident.IdentityData == "{}") return null;
        byte[]? bytes = null;
        try
        {
            var envelope = JsonSerializer.Deserialize<EncryptedIdentity>(resident.IdentityData);
            if (envelope is null) return null;
            bytes = identityProtection.Decrypt(envelope, new(resident.OwnerUserId, resident.Id));
            var identity = JsonSerializer.Deserialize<IdentityConfirmation>(bytes);
            if (identity is null || !identity.HumanConfirmed || string.IsNullOrWhiteSpace(identity.FullName)) return null;
            var number = identity.CitizenIdentityNumber;
            return new(identity.FullName, number?.Length == 12 ? "********" + number[^4..] : "");
        }
        catch (Exception e) when (e is JsonException or CryptographicException or ArgumentException or InvalidOperationException)
        { return null; }
        finally { if (bytes is not null) CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task CloseResidenceAsync(Contract contract, DateOnly actualEndDate, Guid actorId, DateTimeOffset at, CancellationToken t)
    {
        // Only Compact24 is a deployed runtime. The offline legacy regression schema has a
        // required RoomId column and no actual-residence fields; it cannot assert this integration.
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) { await db.SaveChangesAsync(t); return; }
        var ids = contract.Residents.Select(r => r.ResidentId).ToArray();
        var retained = await db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking().Where(cr => ids.Contains(cr.ResidentId) && cr.ContractId != contract.Id &&
            (cr.ResidenceTo == null || cr.ResidenceTo >= actualEndDate) && NativeContracts().Any(c => c.Id == cr.ContractId &&
                c.Status == ContractStatus.Active && c.ContractType != BHome.Domain.TenantContracts.ContractKind.Holding && c.StartDate <= actualEndDate &&
                (c.ActualEndDate ?? c.EndDate) >= actualEndDate)).Select(cr => cr.ResidentId).Distinct().ToArrayAsync(t);
        foreach (var resident in await ResidentsAsync(contract.RoomId, ids.Except(retained).ToArray(), t))
            resident.RoomId = null;
        await FlushAsync(t);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contract_residents SET actual_move_out_date={actualEndDate},
                  registration_status=CASE WHEN registration_status='Completed' THEN registration_status ELSE 'Closed' END,
                  history=history||jsonb_build_array(jsonb_build_object('action','PhysicalResidenceClosed','actorId',{actorId},
                    'occurredAt',{at},'actualMoveOutDate',{actualEndDate},'previousRegistrationStatus',registration_status))
                WHERE contract_id={contract.Id} AND resident_id=ANY({ids})
                """, t);
    }
    public void AuditAnonymous(string action, Guid targetId, DateTimeOffset at) => AddAudit(null, action, targetId, at);
    public void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at) => AddAudit(actorId, action, targetId, at);
    private void AddAudit(Guid? actorId, string action, Guid targetId, DateTimeOffset at)
    {
        if (db is Compact24DbContext)
        {
            if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Contract audit requires the repository transaction.");
            pendingAudit.Add(new(Guid.NewGuid(), actorId, null, null, action, true, at, "Contract", targetId));
        }
        else db.SecurityAudit.Add(new SecurityAuditRecord
        { UserId = actorId, Event = action, TargetId = targetId, TargetType = "Contract", Succeeded = true, OccurredAt = at });
    }
}
