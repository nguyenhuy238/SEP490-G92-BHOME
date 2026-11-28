using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

// Purpose-specific snapshots for inspection, handover and settlement sidecars.
internal static class NativeContractMoveOutPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal sealed record MoveState(Guid Id, Guid ContractId, MoveOutStatus Status, DateOnly ProposedDate, string Reason,
        bool IsExpiry, Guid RequestedByUserId, Guid? ApprovedByUserId, DateTimeOffset? ApprovedAt,
        DateTimeOffset? InspectionScheduledAt, Guid? InspectionStaffId, int Version, Guid? InspectedByUserId,
        DateTimeOffset? InspectedAt, string? InspectionNotes, Guid? ElectricityReadingId, Guid? WaterReadingId,
        string? SettlementDecision, Guid? SettlementApprovedByUserId, DateTimeOffset? SettlementApprovedAt,
        string? SettlementLedgerReference, string PendingReason, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal sealed record InspectionState(Guid Id, Guid ContractId, int Version, Guid BaselineContractId, int BaselineVersion,
        string BaselineSnapshot, string ObservedSnapshot, Guid StaffId, DateTimeOffset InspectedAt, string? OwnerDecision,
        string? OwnerReason, Guid? OwnerId, DateTimeOffset? ReviewedAt, bool NoAdditionalCharges, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal sealed record EvidenceState(Guid Id, Guid ContractId, Guid UploadedByUserId, string ObjectKey, string ContentType,
        bool IsLinked, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    internal sealed record HandoverState(Guid Id, Guid ContractId, int Version, ContractHandoverStatus Status, string Snapshot,
        Guid ElectricityReadingId, Guid WaterReadingId, int? TenantConfirmedVersion, Guid? TenantConfirmedBy,
        DateTimeOffset? TenantConfirmedAt, Guid? StaffConfirmedBy, DateTimeOffset? StaffConfirmedAt,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record ReviewState(Guid Id, Guid ContractId, string Decision, string? LedgerReference, bool Settled,
        Guid ReviewedByUserId, DateTimeOffset ReviewedAt, string FinancialSnapshot, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record MoveHistoryState(Guid Id, Guid ContractId, int Version, string Action, string Snapshot,
        Guid ActorId, DateTimeOffset OccurredAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record HandoverHistoryState(Guid Id, Guid ContractId, int Version, string Action, Guid ActorId,
        DateTimeOffset OccurredAt, string Snapshot, Guid ElectricityReadingId, Guid WaterReadingId, string Note,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    internal static MoveState Snapshot(ContractMoveOut m) => new(m.Id, m.ContractId, m.Status, m.ProposedDate, m.Reason,
        m.IsExpiry, m.RequestedByUserId, m.ApprovedByUserId, m.ApprovedAt, m.InspectionScheduledAt, m.InspectionStaffId,
        m.Version, m.InspectedByUserId, m.InspectedAt, m.InspectionNotes, m.ElectricityReadingId, m.WaterReadingId,
        m.SettlementDecision, m.SettlementApprovedByUserId, m.SettlementApprovedAt, m.SettlementLedgerReference,
        m.PendingReason, m.CreatedAt, m.UpdatedAt);
    internal static InspectionState Snapshot(ContractFinalInspection i) => new(i.Id, i.ContractId, i.Version,
        i.BaselineContractId, i.BaselineVersion, i.BaselineSnapshot, i.ObservedSnapshot, i.StaffId, i.InspectedAt,
        i.OwnerDecision, i.OwnerReason, i.OwnerId, i.ReviewedAt, i.NoAdditionalCharges, i.CreatedAt, i.UpdatedAt);
    internal static EvidenceState Snapshot(ContractInspectionEvidence e) => new(e.Id, e.ContractId, e.UploadedByUserId,
        e.ObjectKey, e.ContentType, e.IsLinked, e.CreatedAt, e.UpdatedAt);
    internal static HandoverState Snapshot(ContractHandover h) => new(h.Id, h.ContractId, h.Version, h.Status, h.Snapshot,
        h.ElectricityReadingId, h.WaterReadingId, h.TenantConfirmedVersion, h.TenantConfirmedBy, h.TenantConfirmedAt,
        h.StaffConfirmedBy, h.StaffConfirmedAt, h.CreatedAt, h.UpdatedAt);

    internal static async Task<ContractMoveOut?> MoveAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var raw = await db.Database.SqlQuery<string>($"""
            SELECT (move_out->'current')::text AS "Value" FROM contracts
            WHERE id={id} AND jsonb_typeof(move_out->'current')='object'
            """).SingleOrDefaultAsync(t);
        if (raw is null) return null;
        var s = Deserialize<MoveState>(raw);
        var m = ContractMoveOut.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
        m.ContractId = s.ContractId; m.Status = s.Status; m.ProposedDate = s.ProposedDate; m.Reason = s.Reason ?? "";
        m.IsExpiry = s.IsExpiry; m.RequestedByUserId = s.RequestedByUserId; m.ApprovedByUserId = s.ApprovedByUserId;
        m.ApprovedAt = s.ApprovedAt; m.InspectionScheduledAt = s.InspectionScheduledAt; m.InspectionStaffId = s.InspectionStaffId;
        m.Version = s.Version; m.InspectedByUserId = s.InspectedByUserId; m.InspectedAt = s.InspectedAt;
        m.InspectionNotes = s.InspectionNotes; m.ElectricityReadingId = s.ElectricityReadingId; m.WaterReadingId = s.WaterReadingId;
        m.SettlementDecision = s.SettlementDecision; m.SettlementApprovedByUserId = s.SettlementApprovedByUserId;
        m.SettlementApprovedAt = s.SettlementApprovedAt; m.SettlementLedgerReference = s.SettlementLedgerReference;
        m.PendingReason = s.PendingReason ?? "";
        return m;
    }

    internal static async Task<ContractHandover?> HandoverAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var raw = await db.Database.SqlQuery<string>($"""
            SELECT jsonb_set(handover->'current',ARRAY['snapshot'],
                to_jsonb(COALESCE((handover->'current'->>'snapshot')::jsonb,jsonb_build_object())::text))::text AS "Value" FROM contracts
            WHERE id={id} AND jsonb_typeof(handover->'current')='object'
            """).SingleOrDefaultAsync(t);
        if (raw is null) return null;
        var s = Deserialize<HandoverState>(raw);
        var h = ContractHandover.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
        h.ContractId = s.ContractId; h.Version = s.Version; h.Status = s.Status; h.Snapshot = s.Snapshot ?? "{}";
        h.ElectricityReadingId = s.ElectricityReadingId; h.WaterReadingId = s.WaterReadingId;
        h.TenantConfirmedVersion = s.TenantConfirmedVersion; h.TenantConfirmedBy = s.TenantConfirmedBy;
        h.TenantConfirmedAt = s.TenantConfirmedAt; h.StaffConfirmedBy = s.StaffConfirmedBy; h.StaffConfirmedAt = s.StaffConfirmedAt;
        return h;
    }

    internal static async Task<ContractFinalInspection[]> InspectionsAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (e||jsonb_build_object(
                'baselineSnapshot',COALESCE((e->>'baselineSnapshot')::jsonb,jsonb_build_object())::text,
                'observedSnapshot',COALESCE((e->>'observedSnapshot')::jsonb,jsonb_build_object())::text))::text AS "Value" FROM contracts c
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.move_out->'inspections','[]'::jsonb)) e
            WHERE c.id={id} ORDER BY (e->>'version')::int DESC
            """).ToArrayAsync(t);
        return rows.Select(raw =>
        {
            var s = Deserialize<InspectionState>(raw);
            var i = ContractFinalInspection.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
            i.ContractId = s.ContractId; i.Version = s.Version; i.BaselineContractId = s.BaselineContractId; i.BaselineVersion = s.BaselineVersion;
            i.BaselineSnapshot = s.BaselineSnapshot ?? "{}"; i.ObservedSnapshot = s.ObservedSnapshot ?? "{}";
            i.StaffId = s.StaffId; i.InspectedAt = s.InspectedAt; i.OwnerDecision = s.OwnerDecision; i.OwnerReason = s.OwnerReason;
            i.OwnerId = s.OwnerId; i.ReviewedAt = s.ReviewedAt; i.NoAdditionalCharges = s.NoAdditionalCharges;
            return i;
        }).ToArray();
    }

    internal static async Task<ContractInspectionEvidence[]> EvidenceAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT e::text AS "Value" FROM contracts c
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.move_out->'evidence','[]'::jsonb)) e WHERE c.id={id}
            """).ToArrayAsync(t);
        return rows.Select(raw =>
        {
            var s = Deserialize<EvidenceState>(raw);
            var e = ContractInspectionEvidence.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
            e.ContractId = s.ContractId; e.UploadedByUserId = s.UploadedByUserId; e.ObjectKey = s.ObjectKey ?? "";
            e.ContentType = s.ContentType ?? ""; e.IsLinked = s.IsLinked;
            return e;
        }).ToArray();
    }

    internal static Task<ContractMoveOutHistory[]> MoveHistoryAsync(Compact24DbContext db, Guid id, CancellationToken t) =>
        MoveHistoryAsync(db, [id], t);

    internal static async Task<ContractMoveOutHistory[]> MoveHistoryAsync(Compact24DbContext db, Guid[] ids, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT jsonb_set(e->'state',ARRAY['snapshot'],
                to_jsonb(COALESCE((e->'state'->>'snapshot')::jsonb,jsonb_build_object())::text))::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) e
            WHERE c.id=ANY({ids}) AND e->>'recordType'='ContractMoveOutHistory' AND COALESCE(e->>'deleted','false')<>'true'
            ORDER BY (e->'state'->>'version')::int DESC
            """).ToArrayAsync(t);
        return rows.Select(raw =>
        {
            var s = Deserialize<MoveHistoryState>(raw);
            var h = ContractMoveOutHistory.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
            h.ContractId = s.ContractId; h.Version = s.Version; h.Action = s.Action ?? ""; h.Snapshot = s.Snapshot ?? "{}";
            h.ActorId = s.ActorId; h.OccurredAt = s.OccurredAt;
            return h;
        }).ToArray();
    }

    internal static async Task<ContractSettlementReview[]> ReviewsAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT e::text AS "Value" FROM contracts c
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.settlement->'reviews','[]'::jsonb)) e
            WHERE c.id={id} ORDER BY (e->>'reviewedAt')::timestamptz DESC,(e->>'id')::uuid
            """).ToArrayAsync(t);
        return rows.Select(raw =>
        {
            var s = Deserialize<ReviewState>(raw);
            var r = ContractSettlementReview.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
            r.ContractId = s.ContractId; r.Decision = s.Decision ?? ""; r.LedgerReference = s.LedgerReference;
            r.Settled = s.Settled; r.ReviewedByUserId = s.ReviewedByUserId; r.ReviewedAt = s.ReviewedAt; r.FinancialSnapshot = s.FinancialSnapshot ?? "{}";
            return r;
        }).ToArray();
    }

    private static T Deserialize<T>(string raw) where T : class =>
        JsonSerializer.Deserialize<T>(raw, Json) ?? throw new InvalidOperationException("Invalid persisted contract state.");
    private static string Envelope<T>(string kind, Guid id, T state) => JsonSerializer.Serialize(new
    { schemaVersion = 1, recordType = kind, recordKey = id.ToString(), deleted = false, state }, Json);
    private static void RequireTransaction(Compact24DbContext db)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Contract sidecar write requires the room transaction.");
    }
    private static void Ensure(int affected)
    {
        if (affected != 1) throw new DbUpdateConcurrencyException("Contract sidecar changed.");
    }

    internal static async Task SaveMoveAsync(Compact24DbContext db, ContractMoveOut m, int? originalVersion, CancellationToken t)
    {
        RequireTransaction(db);
        m.Stamp(DateTimeOffset.UtcNow, originalVersion is null);
        var state = Snapshot(m);
        var json = JsonSerializer.Serialize(state, Json);
        var history = Envelope("ContractMoveOut", m.Id, state);
        Ensure(await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET move_out=jsonb_set(move_out,ARRAY['current'],CAST({json} AS jsonb),true),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={m.ContractId} AND ((CAST({originalVersion} AS integer) IS NULL AND move_out->'current' IS NULL)
                OR ((move_out->'current'->>'id')::uuid={m.Id} AND (move_out->'current'->>'version')::integer={originalVersion}))
            """, t));
    }

    internal static async Task SaveHandoverAsync(Compact24DbContext db, ContractHandover h, int? originalVersion, CancellationToken t)
    {
        RequireTransaction(db);
        h.Stamp(DateTimeOffset.UtcNow, originalVersion is null);
        var state = Snapshot(h);
        var json = JsonSerializer.Serialize(state, Json);
        var history = Envelope("ContractHandover", h.Id, state);
        Ensure(await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET handover=jsonb_set(handover,ARRAY['current'],CAST({json} AS jsonb),true),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={h.ContractId} AND ((CAST({originalVersion} AS integer) IS NULL AND handover->'current' IS NULL)
                OR ((handover->'current'->>'id')::uuid={h.Id} AND (handover->'current'->>'version')::integer={originalVersion}))
            """, t));
    }

    internal static async Task SaveInspectionAsync(Compact24DbContext db, ContractFinalInspection i, bool added, CancellationToken t)
    {
        RequireTransaction(db); i.Stamp(DateTimeOffset.UtcNow, added);
        var state = Snapshot(i); var json = JsonSerializer.Serialize(state, Json);
        var history = Envelope("ContractFinalInspection", i.Id, state);
        Ensure(await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET move_out=jsonb_set(move_out,ARRAY['inspections'],
                COALESCE((SELECT jsonb_agg(e ORDER BY n) FROM jsonb_array_elements(COALESCE(move_out->'inspections','[]'::jsonb))
                    WITH ORDINALITY a(e,n) WHERE e->>'id' IS DISTINCT FROM {i.Id.ToString()}),'[]'::jsonb)
                ||jsonb_build_array(CAST({json} AS jsonb)||jsonb_build_object('recordType','ContractFinalInspection')),true),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={i.ContractId}
            """, t));
    }

    internal static async Task SaveEvidenceAsync(Compact24DbContext db, ContractInspectionEvidence e, bool added, CancellationToken t)
    {
        RequireTransaction(db); e.Stamp(DateTimeOffset.UtcNow, added);
        var state = Snapshot(e); var json = JsonSerializer.Serialize(state, Json);
        var history = Envelope("ContractInspectionEvidence", e.Id, state);
        Ensure(await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET move_out=jsonb_set(move_out,ARRAY['evidence'],
                COALESCE((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(COALESCE(move_out->'evidence','[]'::jsonb))
                    WITH ORDINALITY a(v,n) WHERE v->>'id' IS DISTINCT FROM {e.Id.ToString()}),'[]'::jsonb)
                ||jsonb_build_array(CAST({json} AS jsonb)||jsonb_build_object('recordType','ContractInspectionEvidence')),true),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={e.ContractId}
            """, t));
    }

    internal static async Task AppendReviewAsync(Compact24DbContext db, ContractSettlementReview r, CancellationToken t)
    {
        RequireTransaction(db); r.Stamp(DateTimeOffset.UtcNow, true);
        var state = new ReviewState(r.Id, r.ContractId, r.Decision, r.LedgerReference, r.Settled, r.ReviewedByUserId, r.ReviewedAt, r.FinancialSnapshot, r.CreatedAt, r.UpdatedAt);
        var json = JsonSerializer.Serialize(state, Json); var history = Envelope("ContractSettlementReview", r.Id, state);
        Ensure(await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET settlement=jsonb_set(settlement,ARRAY['reviews'],
                COALESCE(settlement->'reviews','[]'::jsonb)||jsonb_build_array(CAST({json} AS jsonb)||jsonb_build_object('recordType','ContractSettlementReview')),true),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={r.ContractId}
            """, t));
    }

    internal static Task AppendHistoryAsync(Compact24DbContext db, ContractMoveOutHistory h, CancellationToken t)
    {
        RequireTransaction(db); h.Stamp(DateTimeOffset.UtcNow, true);
        return AppendHistoryAsync(db, h.ContractId, Envelope("ContractMoveOutHistory", h.Id,
            new MoveHistoryState(h.Id, h.ContractId, h.Version, h.Action, h.Snapshot, h.ActorId, h.OccurredAt, h.CreatedAt, h.UpdatedAt)), t);
    }
    internal static Task AppendHistoryAsync(Compact24DbContext db, ContractHandoverHistory h, CancellationToken t)
    {
        RequireTransaction(db); h.Stamp(DateTimeOffset.UtcNow, true);
        return AppendHistoryAsync(db, h.ContractId, Envelope("ContractHandoverHistory", h.Id,
            new HandoverHistoryState(h.Id, h.ContractId, h.Version, h.Action, h.ActorId, h.OccurredAt, h.Snapshot,
                h.ElectricityReadingId, h.WaterReadingId, h.Note, h.CreatedAt, h.UpdatedAt)), t);
    }
    private static async Task AppendHistoryAsync(Compact24DbContext db, Guid id, string history, CancellationToken t) =>
        Ensure(await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={id}", t));
}
