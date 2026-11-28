using BHome.Application.Billing;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Contracts;
using Microsoft.EntityFrameworkCore;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Notifications;

internal static class SmsNotificationPolicy
{
    internal static string? Template(string eventType, string role) => (eventType, role) switch
    {
        ("CONTRACT_SIGNING_INVITATION", "Owner" or "Tenant") => "SMS-02",
        ("INVOICE_FINALIZED", "Tenant") => "SMS-03",
        ("INVOICE_OVERDUE", "Tenant") => "SMS-04",
        ("CONTRACT_EXPIRY_REMINDER", "Tenant") => "SMS-05",
        ("INCIDENT_EMERGENCY_SUBMITTED", "Owner" or "Staff") => "SMS-06",
        _ => null
    };
}

// Re-read current business state immediately before dispatch. No signing tokens, documents or balances in SMS.
internal sealed class SmsNotificationContent(Compact24DbContext db, TimeProvider clock)
{
    internal async Task<IReadOnlyDictionary<string, string>?> BuildAsync(NotificationView notice, Guid recipient, CancellationToken t)
    {
        var today = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
        if (notice.EventType is "INVOICE_FINALIZED" or "INVOICE_OVERDUE")
        {
            var invoice = (await NativeInvoicePersistence.ReadAsync(db, db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking()
                .Where(i => i.Id == notice.RelatedObjectId && i.Status == InvoiceStatus.Final && i.RecipientUserIds.Contains(recipient)), t, false)).SingleOrDefault();
            if (invoice is null) return null;
            if (notice.EventType == "INVOICE_OVERDUE" && (invoice.DueDate >= today || (await db.FinancialsAsync(invoice.Id, t)).OutstandingAmount <= 0)) return null;
            return new Dictionary<string, string> { ["ROOM"] = invoice.RoomNumber, ["PERIOD"] = invoice.BillingPeriod.ToString("MM/yyyy", System.Globalization.CultureInfo.InvariantCulture) };
        }
        if (notice.EventType is "CONTRACT_SIGNING_INVITATION" or "CONTRACT_EXPIRY_REMINDER")
        {
            var contract = await NativeContractSnapshot.LoadAsync(db, notice.RelatedObjectId, t);
            if (contract is null) return null;
            if (notice.EventType == "CONTRACT_EXPIRY_REMINDER")
            {
                if (contract.Kind == ContractKind.Holding || contract.Status != ContractStatus.Active || contract.TenantUserId != recipient ||
                    contract.EndDate < today || contract.EndDate > today.AddDays(30)) return null;
            }
            else
            {
                if (contract.Status != ContractStatus.PendingSigning) return null;
                var external = (recipient == contract.OwnerSignerId || recipient == contract.TenantUserId) &&
                    contract.Signatures.Any(s => s.SignerUserId == recipient && s.Status == SignatureStatus.Pending &&
                        s.ProviderReference != null && s.SnapshotHash == contract.SnapshotHashOrEmpty);
                var email = await db.Users.Where(u => u.Id == recipient && u.EmailConfirmed).Select(u => u.Email).SingleOrDefaultAsync(t);
                var invitation = email is not null && (await NativeInvitationPersistence.ForContractAsync(db, contract.Id, t)).Any(i =>
                    i.RecipientEmail == email && i.SnapshotHash == contract.SnapshotHashOrEmpty && i.RevokedAt == null && i.AcceptedAt == null && i.ExpiresAt > clock.GetUtcNow());
                if (!external && !invitation) return null;
            }
            return new Dictionary<string, string> { ["CONTRACT_CODE"] = contract.Id.ToString("N")[..8].ToUpperInvariant(), ["EXPIRY_DATE"] = contract.EndDate.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture) };
        }
        if (notice.EventType == "INCIDENT_EMERGENCY_SUBMITTED")
        {
            var incident = await db.Set<IncidentReport>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == notice.RelatedObjectId && i.Severity == IncidentSeverity.Emergency, t);
            if (incident is null) return null;
            var location = await db.Set<BHome.Domain.Locations.Location>().Where(l => l.Id == incident.LocationId).Select(l => l.Name).SingleAsync(t);
            var room = incident.RoomId is { } id ? await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r => r.Id == id).Select(r => r.RoomNumber).SingleOrDefaultAsync(t) : null;
            return new Dictionary<string, string> { ["LOCATION"] = location.Length > 60 ? location[..60] : location, ["ROOM"] = room ?? "khu vuc chung" };
        }
        return null;
    }
}
