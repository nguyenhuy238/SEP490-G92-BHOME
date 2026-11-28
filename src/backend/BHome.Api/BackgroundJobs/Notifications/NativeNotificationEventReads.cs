using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher
{
    private async Task<Invoice> LoadInvoice(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact
            ? (await NativeInvoicePersistence.ReadAsync(compact, compact.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Id == id), t, false)).Single()
            : await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == id, t);

    private Task<Guid[]> RecipientIds(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact
            ? compact.Set<BHome.Domain.Billing.Invoice>().Where(i => i.Id == id).Select(i => i.RecipientUserIds).SingleAsync(t)
            : db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == id).Select(r => r.TenantUserId).ToArrayAsync(t);

    private Task<bool> PendingAdjustment(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact
            ? compact.Set<InvoiceAdjustment>().AnyAsync(r => r.InvoiceId == id && r.DecisionSnapshot == null, t)
            : db.Set<InvoiceAdjustment>().AnyAsync(r => r.InvoiceId == id && r.Decision == null, t);

    private Task<bool> HasPeriodicInvoice(Guid room, DateOnly period, CancellationToken t) =>
        db is Compact24DbContext compact
            ? compact.Set<BHome.Domain.Billing.Invoice>().AnyAsync(i => i.RoomId == room && i.BillingPeriod == period && i.InvoiceType == "PERIODIC", t)
            : db.PeriodicInvoices().AnyAsync(i => i.RoomId == room && i.BillingPeriod == period, t);

    private async Task<Room?> LoadRoom(Guid room, Guid location, CancellationToken t)
    {
        if (db is not Compact24DbContext compact)
            return await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == room && r.LocationId == location, t);
        var row = await compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == room && r.LocationId == location, t);
        return row is null ? null : NativeRoomLocationPersistence.Read(row);
    }

    private Task<Contract?> LoadNotificationContract(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact ? NativeContractSnapshot.LoadAsync(compact, id, t) :
            db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == id, t);

    private Task<BillingAutomationExecution> LoadExecution(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact ? NativeBillingJobPersistence.ByIdAsync(compact, id, t) :
            db.Set<BillingAutomationExecution>().AsNoTracking().SingleAsync(e => e.Id == id, t);

    private async Task<BillingAutomationPlan> LoadPlan(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact
            ? await NativeBillingAutomationPersistence.PlanAsync(compact, id, t) ?? throw new InvalidOperationException("Notification plan missing.")
            : await db.Set<BillingAutomationPlan>().AsNoTracking().SingleAsync(p => p.Id == id, t);

    private Task<bool> HasAssignment(Guid staff, Guid location, DateOnly day, CancellationToken t) =>
        db is Compact24DbContext compact
            ? compact.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
                    WHERE l.id={location} AND (a->>'staffUserId')::uuid={staff}
                    AND (a->>'startDate')::date<={day} AND (a->>'endDate')::date>={day}) AS "Value"
                """).SingleAsync(t)
            : db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == staff && a.LocationId == location && a.StartDate <= day && a.EndDate >= day, t);

    private async Task<Guid[]> MissingDraftTenants(Guid room, DateOnly start, DateOnly end, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var contracts = compact.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.RoomId == room && c.ActivatedAt != null &&
                (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal) &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
                c.StartDate <= end && (c.ActualEndDate ?? c.EndDate) >= start);
            var occupants = from cr in compact.Set<BHome.Domain.TenantContracts.ContractResident>()
                            join c in contracts on cr.ContractId equals c.Id
                            join r in compact.Set<BHome.Domain.TenantContracts.Resident>() on cr.ResidentId equals r.Id
                            where cr.ResidenceFrom <= end && (cr.ResidenceTo == null || cr.ResidenceTo >= start) && r.UserId != null
                            select r.UserId!.Value;
            return await occupants.Union(contracts.Where(c => c.TenantUserId != null).Select(c => c.TenantUserId!.Value)).ToArrayAsync(t);
        }
        var legacy = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).Where(c => c.RoomId == room && c.ActivatedAt != null &&
            (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
            c.StartDate <= end && (c.ActualEndDate ?? c.EndDate) >= start).ToArrayAsync(t);
        var residentIds = legacy.SelectMany(c => c.Residents.Where(r => r.ResidenceFrom <= end && (r.ResidenceTo == null || r.ResidenceTo >= start)).Select(r => r.ResidentId)).Distinct().ToArray();
        var tenants = await db.Set<Resident>().AsNoTracking().Where(r => residentIds.Contains(r.Id) && r.TenantUserId != null).Select(r => r.TenantUserId!.Value).ToArrayAsync(t);
        return tenants.Concat(legacy.Where(c => c.TenantUserId != null).Select(c => c.TenantUserId!.Value)).Distinct().ToArray();
    }

    private static IQueryable<Native.Notification> Outbox(Compact24DbContext compact, string kind) =>
        compact.Set<Native.Notification>().AsNoTracking().Where(n => n.RecordKind == "OUTBOX" &&
            n.EventData.GetProperty("recordType").GetString() == kind);

    private static async Task<T[]> ReadOutbox<T>(IQueryable<Native.Notification> query, CancellationToken t) where T : class =>
        (await query.OrderBy(n => n.EventAt).Take(25).ToArrayAsync(t))
            .Select(n => n.EventData.GetProperty("state").Deserialize<T>(CompactNotificationWriter.Json)
                ?? throw new InvalidOperationException("Invalid notification event state.")).ToArray();

    private async Task<BillingAutomationExecution[]> PendingExecutions(bool final, CancellationToken t)
    {
        var keys = NotificationPublications.Keys(db);
        if (db is not Compact24DbContext compact)
        {
            var legacy = db.Set<BillingAutomationExecution>().AsNoTracking().Where(e => e.Status == "PendingInputs");
            return final ? await legacy.Where(e => e.Phase == "Final").OrderBy(e => e.BillingPeriod).ThenBy(e => e.Id).ToArrayAsync(t) :
                await legacy.Where(e => e.Phase != "Final" && !keys.Contains("billing-exception:" + e.Id.ToString())).OrderBy(e => e.LastStartedAt).Take(25).ToArrayAsync(t);
        }
        var query = NativeBillingJobPersistence.Rows(compact).Where(e => e.TaskData.GetProperty("state").GetProperty("status").GetString() == "PendingInputs");
        var rows = final
            ? await query.Where(e => e.TaskData.GetProperty("state").GetProperty("phase").GetString() == "Final")
                .OrderBy(e => e.TaskData.GetProperty("state").GetProperty("billingPeriod").GetString()).ThenBy(e => e.Id).ToArrayAsync(t)
            : await query.Where(e => e.TaskData.GetProperty("state").GetProperty("phase").GetString() != "Final" && !keys.Contains("billing-exception:" + e.Id.ToString()))
                .OrderBy(e => e.TaskData.GetProperty("state").GetProperty("lastStartedAt").GetString()).Take(25).ToArrayAsync(t);
        return rows.Select(e => e.TaskData.GetProperty("state").Deserialize<BillingAutomationExecution>(CompactNotificationWriter.Json)
            ?? throw new InvalidOperationException("Invalid billing execution state.")).ToArray();
    }
}
