using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal static class NativeSettlementReads
{
    internal static async Task<Contract?> ContractAsync(BHomePersistenceContext db, Guid id, CancellationToken t) =>
        db is Compact24DbContext native
            ? await NativeContractSnapshot.LoadAsync(native, id, t)
            : await db.Set<Contract>().AsNoTracking().Include(c => c.Room).Include(c => c.Residents).SingleOrDefaultAsync(c => c.Id == id, t);

    internal static async Task<ContractFinalInspection?> InspectionAsync(BHomePersistenceContext db, Guid id, CancellationToken t) =>
        db is Compact24DbContext native
            ? (await NativeContractMoveOutPersistence.InspectionsAsync(native, id, t)).FirstOrDefault()
            : await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == id).OrderByDescending(i => i.Version).FirstOrDefaultAsync(t);

    internal static Task<ContractMoveOut?> MoveAsync(BHomePersistenceContext db, Guid id, CancellationToken t) =>
        db is Compact24DbContext native ? NativeContractMoveOutPersistence.MoveAsync(native, id, t)
            : db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == id, t);

    internal static async Task<ContractHandover?> ConfirmedHandoverAsync(BHomePersistenceContext db, Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext native)
            return await NativeContractMoveOutPersistence.HandoverAsync(native, id, t) is { Status: ContractHandoverStatus.Confirmed } value ? value : null;
        return await db.Set<ContractHandover>().AsNoTracking().SingleOrDefaultAsync(h => h.ContractId == id && h.Status == ContractHandoverStatus.Confirmed, t);
    }

    internal static async Task<Invoice?> PeriodicInvoiceAsync(BHomePersistenceContext db, Guid room, DateOnly period, CancellationToken t)
    {
        if (db is Compact24DbContext native)
            return (await NativeInvoicePersistence.ReadAsync(native, native.Set<Native.Invoice>().AsNoTracking()
                .Where(i => i.InvoiceType == "PERIODIC" && i.RoomId == room && i.BillingPeriod == period), t)).SingleOrDefault();
        return await db.PeriodicInvoices().AsNoTracking().SingleOrDefaultAsync(i => i.RoomId == room && i.BillingPeriod == period, t);
    }

    internal static Task<Guid> LocationAsync(BHomePersistenceContext db, Guid contract, CancellationToken t) =>
        (from c in db.Set<Native.Contract>().AsNoTracking()
         join r in db.Set<Native.Room>() on c.RoomId equals r.Id
         where c.Id == contract
         select r.LocationId).SingleAsync(t);

    internal static Task<SettlementDepositReceipt[]> DepositReceiptsAsync(BHomePersistenceContext db, Guid contract, CancellationToken t) =>
        db.Database.SqlQuery<SettlementDepositReceipt>($"""
            SELECT (s.data->>'id')::uuid AS "Id", (s.data->>'amount')::numeric AS "Amount",
                (s.data->>'verifiedAt')::timestamptz AS "VerifiedAt"
            FROM payments p CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h.value->>'recordKey') h.value->'state' AS data,h.value->>'deleted' AS deleted
                FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='DepositVerification'
                ORDER BY h.value->>'recordKey',h.n DESC
            ) s WHERE COALESCE(s.deleted,'false')<>'true' AND s.data->>'contractId'={contract.ToString()}
            ORDER BY (s.data->>'id')::uuid
            """).ToArrayAsync(t);

    internal static async Task<MeterReading?> ReadingAsync(BHomePersistenceContext db, Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var row = await db.Set<Native.MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t);
            return row is null ? null : NativeCaptureReads.Reading(row);
        }
        return await db.Set<MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t);
    }

    internal static async Task<OperationalTask?> TaskAsync(BHomePersistenceContext db, Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var row = await db.Set<Native.OperationalTask>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id && r.TaskType == "METER_READ", t);
            return row is null ? null : NativeCaptureReads.Task(row);
        }
        return await db.Set<OperationalTask>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t);
    }

    internal sealed record Compensation(Guid Id, int Version, string Status, decimal Amount, DateTimeOffset? DeductedAt);

    internal static Task<Compensation[]> CompensationsAsync(BHomePersistenceContext db, Guid deposit, CancellationToken t) =>
        db.Database.SqlQuery<Compensation>($"""
            SELECT (s.data->>'id')::uuid AS "Id", (s.data->>'version')::int AS "Version",
                s.data->>'status' AS "Status", (s.data->>'amount')::numeric AS "Amount",
                (s.data->>'deductedAt')::timestamptz AS "DeductedAt"
            FROM operational_tasks o CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h.value->>'recordKey') h.value->'state' AS data,h.value->>'deleted' AS deleted
                FROM jsonb_array_elements(o.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='MaintenanceCompensation'
                ORDER BY h.value->>'recordKey',h.n DESC
            ) s WHERE COALESCE(s.deleted,'false')<>'true' AND s.data->>'depositContractId'={deposit.ToString()}
                AND s.data->>'status' IN ('DepositPending','Deducted')
            """).ToArrayAsync(t);

    internal sealed record MeterProof(MeterReading Reading, OperationalTask Task, MeterEvidence Evidence, UtilityType UtilityType);

    internal static async Task<MeterProof[]> MeterProofsAsync(BHomePersistenceContext db, Guid room, Guid[] ids, CancellationToken t)
    {
        var rows = await (from reading in db.Set<Native.MeterReading>().AsNoTracking()
                          join task in db.Set<Native.OperationalTask>() on reading.OperationalTaskId equals task.Id
                          join meter in db.Set<Native.Meter>() on reading.MeterId equals meter.Id
                          where ids.Contains(reading.Id) && meter.RoomId == room && task.TaskType == "METER_READ"
                          select new { reading, task, meter.UtilityType }).ToArrayAsync(t);
        var result = new List<MeterProof>();
        foreach (var row in rows)
        {
            var reading = NativeCaptureReads.Reading(row.reading);
            var task = NativeCaptureReads.Task(row.task);
            var evidence = NativeCaptureReads.Evidence(row.task, reading.EvidenceId);
            if (task.Status == MeterTaskStatus.Completed && evidence is { IsLinked: true, IsUploaded: true })
                result.Add(new(reading, task, evidence, (UtilityType)row.UtilityType));
        }
        return result.ToArray();
    }
}
