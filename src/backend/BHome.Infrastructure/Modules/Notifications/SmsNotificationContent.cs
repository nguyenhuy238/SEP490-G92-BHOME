using BHome.Application.Billing;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;

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
            var invoice = await db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == notice.RelatedObjectId && i.Status == InvoiceStatus.Final, t);
            if (invoice is null || !await db.Set<InvoiceRecipient>().AnyAsync(r => r.InvoiceId == invoice.Id && r.TenantUserId == recipient, t)) return null;
            if (notice.EventType == "INVOICE_OVERDUE" && (invoice.DueDate >= today || (await db.FinancialsAsync(invoice.Id, t)).OutstandingAmount <= 0)) return null;
            return new Dictionary<string, string> { ["ROOM"] = invoice.RoomNumber, ["PERIOD"] = invoice.BillingPeriod.ToString("MM/yyyy") };
        }
        if (notice.EventType is "CONTRACT_SIGNING_INVITATION" or "CONTRACT_EXPIRY_REMINDER")
        {
            var contract = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == notice.RelatedObjectId, t);
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
                    await db.Set<ContractSignature>().AnyAsync(s => s.ContractId == contract.Id && s.SignerUserId == recipient &&
                        s.Status == SignatureStatus.Pending && s.ProviderReference != null, t);
                var email = await db.Users.Where(u => u.Id == recipient && u.EmailConfirmed).Select(u => u.Email).SingleOrDefaultAsync(t);
                var invitation = email is not null && await db.Set<ContractSigningInvitation>().AnyAsync(i => i.ContractId == contract.Id &&
                    i.RecipientEmail == email && i.RevokedAt == null && i.AcceptedAt == null && i.ExpiresAt > clock.GetUtcNow(), t);
                if (!external && !invitation) return null;
            }
            return new Dictionary<string, string> { ["CONTRACT_CODE"] = contract.Id.ToString("N")[..8].ToUpperInvariant(), ["EXPIRY_DATE"] = contract.EndDate.ToString("dd/MM/yyyy") };
        }
        if (notice.EventType == "INCIDENT_EMERGENCY_SUBMITTED")
        {
            var incident = await db.Set<IncidentReport>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == notice.RelatedObjectId && i.Severity == IncidentSeverity.Emergency, t);
            if (incident is null) return null;
            var location = await db.Locations.Where(l => l.Id == incident.LocationId).Select(l => l.Name).SingleAsync(t);
            var room = incident.RoomId is { } id ? await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r => r.Id == id).Select(r => r.RoomNumber).SingleOrDefaultAsync(t) : null;
            return new Dictionary<string, string> { ["LOCATION"] = location.Length > 60 ? location[..60] : location, ["ROOM"] = room ?? "khu vuc chung" };
        }
        return null;
    }
}
