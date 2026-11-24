using System.Globalization;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Branding;
using Microsoft.EntityFrameworkCore;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using System.Security.Cryptography;
using iText.IO.Font;
using iText.Kernel.Colors;
using iText.Kernel.Font;
using iText.Kernel.Pdf;
using iText.Kernel.Geom;
using iText.Layout;
using iText.Layout.Element;
using iText.Layout.Properties;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

// Called only after the worker rechecks recipient scope and target entitlement.
internal sealed class NotificationEmailContent(Compact24DbContext db,
    IOptions<AuthenticationEmailOptions> authentication, IHostEnvironment environment,
    BHome.Application.Ocr.IIdentityProtection? identity = null,
    BHome.Application.PaymentsDebt.IMainInitialPaymentLedger? initialPayments = null, IObjectStorage? storage = null)
{
    internal async Task<(string Title, string Body)?> MainConfirmationAsync(Guid id, Guid? tenant, CancellationToken t)
    {
        var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).ThenInclude(r => r.Location)
            .SingleOrDefaultAsync(c => c.Id == id && c.Kind == ContractKind.Main && c.Status == ContractStatus.Active &&
                (tenant == null || c.TenantUserId == tenant), t);
        if (c is null || c.IsDevelopmentDemo || c.Room.Status != BHome.Domain.PropertyManagement.RoomStatus.Occupied ||
            c.TenantUserId is null || initialPayments is not null && !await initialPayments.SatisfiedAsync(c.Id, t)) return null;
        var account = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == c.TenantUserId && u.IsActive, t);
        if (account is null) return null;
        var amount = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(a.amount),0) AS "Value" FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
            WHERE (a.target_deposit_contract_id={id} OR a.target_initial_contract_id={id}) AND p.status='VERIFIED'
            """).SingleAsync(t);
        return ("BHOME – Hợp đồng thuê đã hoạt động",
            $"Hợp đồng thuê của bạn đã hoạt động. Thanh toán đã được xác minh.\n\n" +
            $"Cơ sở: {c.Room.Location.Name}\nPhòng: {c.Room.RoomNumber}\nHợp đồng: {c.Id:D}\n" +
            $"Thời hạn: {c.StartDate:dd/MM/yyyy} – {c.EndDate:dd/MM/yyyy}\n" +
            $"Số tiền thanh toán đã xác minh: {amount.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} VND\n" +
            $"Tiền giữ chỗ đã áp dụng: {c.AppliedHoldingDeposit.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} VND\n" +
            $"Trạng thái hợp đồng: Đang hoạt động\nTài khoản đăng nhập: {account.UserName}\nTrạng thái tài khoản: Đang hoạt động.\n");
    }
    internal async Task<IReadOnlyList<EmailAttachment>> MainAttachmentsAsync(Guid id, Guid tenant, string destination, CancellationToken t)
    {
        var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Signatures).Include(c => c.Room).ThenInclude(r => r.Location)
            .SingleOrDefaultAsync(c => c.Id == id && c.Kind == ContractKind.Main && c.Status == ContractStatus.Active &&
                c.TenantUserId == tenant && !c.IsDevelopmentDemo, t)
            ?? throw new ChannelDeliveryException("main_confirmation_document_invalid");
        string? key, hash;
        var evidence = AnonymousContractSigningService.AcceptedEvidence(c);
        if (evidence is not null)
        {
            if (!AnonymousContractSigningService.Complete(c) || evidence.SnapshotHash != c.SnapshotHash || evidence.OwnerId != c.OwnerSignerId)
                throw new ChannelDeliveryException("main_confirmation_document_invalid");
            var signedEmail = await db.Set<ContractSigningInvitation>().AsNoTracking()
                .Where(i => i.Id == evidence.InvitationId && i.ContractId == c.Id && i.ResidentId == c.RepresentativeResidentId &&
                    i.SnapshotHash == c.SnapshotHash && i.AcceptedAt != null && i.RevokedAt == null)
                .Select(i => i.RecipientEmail).SingleOrDefaultAsync(t);
            if (!string.Equals(signedEmail, destination, StringComparison.OrdinalIgnoreCase))
                throw new ChannelDeliveryException("main_confirmation_recipient_mismatch");
            key = evidence.FinalDocumentKey; hash = evidence.FinalDocumentHash;
        }
        else
        {
            var signed = c.Signatures.Where(s => s.Status == SignatureStatus.Signed && s.SnapshotHash == c.SnapshotHash &&
                s.SignedAt != null && s.SignedObjectKey != null && s.SignedHash != null && s.ProviderReference != null).ToArray();
            if (!new[] { c.OwnerSignerId, tenant }.All(party => signed.Any(s => s.SignerUserId == party)))
                throw new ChannelDeliveryException("main_confirmation_document_invalid");
            var final = signed.OrderBy(s => s.SignedAt).Last();
            key = final.SignedObjectKey; hash = final.SignedHash;
        }
        if (key is null || hash is null || !key.StartsWith($"contracts/{id:N}/", StringComparison.Ordinal))
            throw new ChannelDeliveryException("main_confirmation_document_invalid");
        if (storage is null) throw new ChannelDeliveryException("main_confirmation_storage_unavailable", retryable: true);
        using var document = new MemoryStream();
        try { await storage.CopyToAsync(key, document, t); }
        catch (Exception e) when (e is not OperationCanceledException and not OutOfMemoryException)
        { throw new ChannelDeliveryException("main_confirmation_document_unavailable", retryable: true); }
        var bytes = document.ToArray();
        if (bytes.Length is < 5 or > 10_485_760 || !bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8) ||
            !string.Equals(Convert.ToHexString(SHA256.HashData(bytes)), hash, StringComparison.OrdinalIgnoreCase))
            throw new ChannelDeliveryException("main_confirmation_document_invalid");
        var contract = new EmailAttachment($"Hop-dong-thue-{id:N}.pdf", "application/pdf", bytes);
        if (!c.InitialPaymentRequired) return [contract];
        var receipts = await db.Database.SqlQuery<ReceiptRow>($"""
            SELECT p.id AS "Id",COALESCE(p.verification_data->'sepay'->>'bankReference',p.transaction_reference) AS "Reference",
              sum(a.amount) AS "Amount",p.received_at AS "PaidAt"
            FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
            WHERE (a.target_deposit_contract_id={id} OR a.target_initial_contract_id={id}) AND p.status='VERIFIED'
            GROUP BY p.id ORDER BY p.received_at,p.id
            """).ToArrayAsync(t);
        if (receipts.Length == 0) return [contract];
        var receipt = PaymentReceipt(c, "Biên nhận thanh toán ban đầu", receipts,
            $"Tiền giữ chỗ đã cấn vào cọc: {c.AppliedHoldingDeposit.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} VND.");
        return [contract, new($"Bien-nhan-thanh-toan-{id:N}.pdf", "application/pdf", receipt)];
    }
    internal async Task<(string Destination, string Title, string Body, IReadOnlyList<EmailAttachment> Attachments)?> MainPaidConfirmationAsync(
        Guid id, Guid tenant, CancellationToken t)
    {
        if (initialPayments is null || !await db.Set<Contract>().AnyAsync(c => c.Id == id && c.TenantUserId == tenant &&
            c.InitialPaymentRequired && c.SigningMode == ContractSigningModes.Internal, t)) return null;
        if (await MainConfirmationAsync(id, tenant, t) is not { } confirmation) return null;
        var destination = await db.Users.AsNoTracking().Where(u => u.Id == tenant && u.IsActive).Select(u => u.Email).SingleOrDefaultAsync(t);
        if (!EmailOptions.ValidAddress(destination)) throw new ChannelDeliveryException("email_recipient_unavailable");
        var attachments = await MainAttachmentsAsync(id, tenant, destination!, t);
        return (destination!, confirmation.Title, confirmation.Body, attachments);
    }
    internal async Task<(string Destination, string Title, string Body, IReadOnlyList<EmailAttachment> Attachments)?> HoldingConfirmationAsync(Guid id, Guid owner, CancellationToken t)
    {
        var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).ThenInclude(r => r.Location)
            .Include(c => c.Signatures).SingleOrDefaultAsync(c => c.Id == id && c.OwnerSignerId == owner &&
                c.Kind == ContractKind.Holding && c.Status == ContractStatus.Active, t);
        if (c is null || c.Room.Status != BHome.Domain.PropertyManagement.RoomStatus.OnHold ||
            !BHome.Application.Contracts.AnonymousContractSigningService.HoldingOwnerHasSigned(c)) return null;
        var invitation = await db.Set<ContractSigningInvitation>().AsNoTracking()
            .Where(i => i.ContractId == id && i.ResidentId == c.RepresentativeResidentId && i.SnapshotHash == c.SnapshotHash &&
                i.AcceptedAt != null && i.RevokedAt == null).OrderByDescending(i => i.AcceptedAt).FirstOrDefaultAsync(t);
        if (invitation is null || !EmailOptions.ValidAddress(invitation.RecipientEmail)) return null;
        var amount = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(a.amount),0) AS "Value" FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
            WHERE a.target_deposit_contract_id={id} AND p.status='VERIFIED'
            """).SingleAsync(t);
        if (amount != c.RequiredDeposit || !BHome.Application.Contracts.AnonymousContractSigningService.Complete(c)) return null;
        var evidence = AnonymousContractSigningService.AcceptedEvidence(c)!;
        if (evidence.InvitationId != invitation.Id || evidence.SnapshotHash != c.SnapshotHash || evidence.OwnerId != owner ||
            evidence.FinalDocumentKey is not { } key || !key.StartsWith($"contracts/{id:N}/", StringComparison.Ordinal))
            throw new ChannelDeliveryException("holding_confirmation_document_invalid");
        if (storage is null) throw new ChannelDeliveryException("holding_confirmation_storage_unavailable", retryable: true);
        using var document = new MemoryStream();
        try { await storage.CopyToAsync(key, document, t); }
        catch (Exception e) when (e is not OperationCanceledException and not OutOfMemoryException)
        { throw new ChannelDeliveryException("holding_confirmation_document_unavailable", retryable: true); }
        var signedPdf = document.ToArray();
        if (signedPdf.Length is < 5 or > 10_485_760 || !signedPdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8) ||
            !string.Equals(Convert.ToHexString(SHA256.HashData(signedPdf)), evidence.FinalDocumentHash, StringComparison.OrdinalIgnoreCase))
            throw new ChannelDeliveryException("holding_confirmation_document_invalid");
        var resident = await db.Set<Resident>().AsNoTracking().SingleAsync(r => r.Id == c.RepresentativeResidentId, t);
        var tenant = resident.DisplayLabel;
        if (identity is not null && resident.IdentityData != "{}")
        {
            var envelope = System.Text.Json.JsonSerializer.Deserialize<BHome.Application.Ocr.EncryptedIdentity>(resident.IdentityData)!;
            var bytes = identity.Decrypt(envelope, new(resident.OwnerUserId, resident.Id));
            try { tenant = System.Text.Json.JsonSerializer.Deserialize<BHome.Application.Ocr.IdentityConfirmation>(bytes)!.FullName; }
            finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(bytes); }
        }
        var receipts = await db.Database.SqlQuery<ReceiptRow>($"""
            SELECT a.id AS "Id",COALESCE(p.verification_data->'sepay'->>'bankReference',p.transaction_reference) AS "Reference",
              a.amount AS "Amount",p.received_at AS "PaidAt"
            FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
            WHERE a.target_deposit_contract_id={id} AND p.status='VERIFIED' ORDER BY p.received_at,a.id
            """).ToArrayAsync(t);
        var receipt = PaymentReceipt(c, "Biên nhận tiền giữ chỗ", receipts, $"Người giữ chỗ: {tenant}");
        return (invitation.RecipientEmail, "BHOME – Xác nhận giữ chỗ thành công",
            $"Xin chào {tenant},\n\nHợp đồng giữ chỗ của bạn đã hoàn tất và thanh toán đã được xác minh.\n\n" +
            $"Thông tin:\n- Cơ sở: {c.Room.Location.Name}\n- Phòng: {c.Room.RoomNumber}\n- Hợp đồng: {c.Id:D}\n" +
            $"- Thời gian giữ chỗ: {c.StartDate:dd/MM/yyyy} – {c.EndDate:dd/MM/yyyy}\n" +
            $"- Số tiền giữ chỗ: {c.RequiredDeposit.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} VND\n" +
            "- Trạng thái: Đã giữ chỗ thành công\n\nĐính kèm: hợp đồng đã ký và biên nhận tiền giữ chỗ đã xác minh.\n\nTrân trọng,\nBHOME.",
            [new($"Hop-dong-giu-cho-{id:N}.pdf", "application/pdf", signedPdf),
             new($"Bien-nhan-giu-cho-{id:N}.pdf", "application/pdf", receipt)]);
    }

    private sealed record ReceiptRow(Guid Id, string Reference, decimal Amount, DateTimeOffset PaidAt);
    private static readonly Lazy<byte[]> ReceiptFont = new(() =>
    {
        using var source = typeof(NotificationEmailContent).Assembly.GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new ChannelDeliveryException("holding_receipt_font_unavailable");
        using var bytes = new MemoryStream(); source.CopyTo(bytes); return bytes.ToArray();
    });
    private static byte[] PaymentReceipt(Contract c, string title, IReadOnlyList<ReceiptRow> rows, string detail)
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var doc = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(ReceiptFont.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            doc.SetFont(font).SetFontSize(11).SetMargins(40, 40, 40, 40);
            pdf.GetDocumentInfo().SetTitle(title).SetCreator("BHome");
            doc.Add(new Paragraph($"BHome – {title.ToUpperInvariant()}").SetFontSize(17).SetFontColor(new DeviceRgb(25, 76, 187)));
            BrandAssets.AddPdfMark(doc, PageSize.A4.GetWidth() - 70, PageSize.A4.GetHeight() - 31, 26, BrandAssets.MarkPng);
            doc.Add(new Paragraph($"Hợp đồng: {c.Id:D}\nCơ sở: {c.Room.Location.Name}\nPhòng: {c.Room.RoomNumber}\nThời hạn: {c.StartDate:dd/MM/yyyy} – {c.EndDate:dd/MM/yyyy}\n{detail}"));
            var table = new Table(UnitValue.CreatePercentArray([30f, 45f, 25f])).UseAllAvailableWidth();
            foreach (var label in new[] { "Ngày giao dịch", "Tham chiếu giao dịch", "Số tiền ghi nhận (VND)" }) table.AddHeaderCell(new Cell().Add(new Paragraph(label)));
            foreach (var row in rows)
            {
                table.AddCell(new Paragraph(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(row.PaidAt, "Asia/Ho_Chi_Minh").ToString("HH:mm dd/MM/yyyy")));
                table.AddCell(new Paragraph(row.Reference));
                table.AddCell(new Paragraph(row.Amount.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))).SetTextAlignment(TextAlignment.RIGHT));
            }
            doc.Add(table);
            doc.Add(new Paragraph($"Tổng tiền đã xác minh: {rows.Sum(r => r.Amount).ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} VND").SetFontSize(13));
        }
        return output.ToArray();
    }
    internal async Task<(string Title, string Body)> BuildAsync(NotificationView notice, CancellationToken t)
    {
        if (notice.EventType == "CONTRACT_ACTIVATED" && notice.RelatedObjectType == "Contract" &&
            await MainConfirmationAsync(notice.RelatedObjectId, null, t) is { } main)
            return main;
        if (notice.EventType is "STAFF_ASSIGNMENT_CREATED" or "STAFF_ASSIGNMENT_UPDATED" or
            "STAFF_ASSIGNMENT_CANCELLED" or "STAFF_ASSIGNMENT_REMOVED" or
            "STAFF_ASSIGNMENT_ACTIVATED" or "STAFF_ASSIGNMENT_ENDED")
        {
            // Never build a login link from the request host, database or user-controlled input.
            var portal = authentication.Value.StaffPortalUrl;
            if (string.IsNullOrWhiteSpace(portal)) return (notice.Title, notice.Summary);
            if (!authentication.Value.Trusted(portal, environment.IsDevelopment()))
                throw new InvalidOperationException("staff_portal_url_invalid");
            return (notice.Title, $"{notice.Summary}\n\nCổng đăng nhập Staff: {portal}");
        }
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
