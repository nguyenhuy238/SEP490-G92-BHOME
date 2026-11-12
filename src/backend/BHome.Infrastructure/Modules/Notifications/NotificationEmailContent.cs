using System.Globalization;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

// Called only after the worker rechecks recipient scope and target entitlement.
internal sealed class NotificationEmailContent(Compact24DbContext db)
{
    internal async Task<(string Title, string Body)> BuildAsync(NotificationView notice, CancellationToken t)
    {
        if (notice.RelatedObjectType is "Invoice" or "Debt" && notice.EventType is
            "INVOICE_FINALIZED" or "INVOICE_DUE_SOON" or "INVOICE_OVERDUE" or "INVOICE_FULLY_PAID" or "PAYMENT_PARTIALLY_CONFIRMED")
        {
            var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == notice.RelatedObjectId, t);
            var message = notice.EventType switch
            {
                "INVOICE_FINALIZED" => "Hóa đơn thuê phòng của bạn đã được phát hành.",
                "INVOICE_FULLY_PAID" => "BHOME đã xác nhận thanh toán đủ cho hóa đơn. Mở lịch sử thanh toán để xem chi tiết.",
                "PAYMENT_PARTIALLY_CONFIRMED" => "BHOME đã xác nhận một khoản thanh toán cho hóa đơn. Mở lịch sử thanh toán để xem chi tiết.",
                _ => "Vui lòng kiểm tra nghĩa vụ thanh toán còn lại của hóa đơn trong BHOME."
            };
            return ($"{notice.Title} — kỳ {invoice.BillingPeriod.ToString("MM/yyyy", CultureInfo.InvariantCulture)}",
                $"{message}\n\nCơ sở: {invoice.LocationName}\nPhòng: {invoice.RoomNumber}\nKỳ thanh toán: {invoice.BillingPeriod.ToString("MM/yyyy", CultureInfo.InvariantCulture)}\nHạn thanh toán: {invoice.DueDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}");
        }
        if (notice.EventType == "CONTRACT_EXPIRY_REMINDER" && notice.RelatedObjectType == "Contract")
        {
            var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleAsync(c => c.Id == notice.RelatedObjectId, t);
            var location = await db.Set<Location>().Where(l => l.Id == contract.Room.LocationId).Select(l => l.Name).SingleAsync(t);
            return (notice.Title, $"Hợp đồng đến kỳ xử lý gia hạn hoặc trả phòng.\n\nCơ sở: {location}\nPhòng: {contract.Room.RoomNumber}\nNgày hết hạn: {contract.EndDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}");
        }
        if (notice.EventType == "INCIDENT_EMERGENCY_SUBMITTED" && notice.RelatedObjectType == "Incident")
        {
            var incident = await db.Set<BHome.Domain.IncidentMaintenance.IncidentReport>().AsNoTracking()
                .Where(i => i.Id == notice.RelatedObjectId).Select(i => new { i.LocationId, i.RoomId }).SingleAsync(t);
            var location = await db.Set<Location>().Where(l => l.Id == incident.LocationId).Select(l => l.Name).SingleAsync(t);
            var room = await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r => r.Id == incident.RoomId).Select(r => r.RoomNumber).SingleOrDefaultAsync(t);
            return (notice.Title, $"Có sự cố khẩn cấp cần tiếp nhận.\n\nCơ sở: {location}\nPhòng: {room ?? "Khu vực chung"}\n\n{notice.Summary}");
        }
        // Existing announcement/security content already respects the application's recipient scope.
        // Payment templates above deliberately omit the internal reference present in the inbox summary.
        return (notice.Title, notice.Summary);
    }
}
