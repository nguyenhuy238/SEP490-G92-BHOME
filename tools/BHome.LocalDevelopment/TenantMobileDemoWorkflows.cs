using System.Net.Http.Headers;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Operations;
using BHome.Application.PaymentsDebt;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;

namespace BHome.LocalDevelopment;

internal static partial class TenantMobileDemoSeed
{
    private static async Task SeedWorkflowsAsync(IServiceProvider sp, BHomePersistenceContext db, Guid tenant, Guid owner)
    {
        var actor = sp.GetRequiredService<LifecycleSeedActor>();
        actor.UserId = owner; actor.Role = Roles.Owner;
        var instructions = sp.GetRequiredService<TransferInstructionsService>();
        if (await instructions.GetAccountAsync(Id(10), default) is null)
            await instructions.SaveAccountAsync(new(Id(10), "970436", "000000000000", "BHOME SYNTHETIC TEST DO NOT PAY", true, true, true, 0), default);
        var payments = sp.GetRequiredService<PaymentService>();
        for (var i = 1; i <= 2; i++)
        {
            var reference = "BHOME-TEST-TENANT-V1-" + i;
            var existing = await db.Set<PaymentTransfer>().SingleOrDefaultAsync(x => x.ProviderIdentity == "BHOME:TEST" && x.NormalizedReference == reference);
            var transfer = existing?.Id ?? (await payments.RegisterAsync(new("BHOME:TEST", reference, i == 1 ? 1_000_000 : 3_600_000,
                "VND", DateTimeOffset.UtcNow.AddMinutes(-2), PaymentRules.InvoiceReference(Id(400 + i)), "[TEST] Synthetic statement, not a bank record",
                "[TEST] UI fixture only; no real funds transferred", Id(400 + i), true, true), Id(800 + i), default)).Id;
            if (!await db.Set<PaymentAllocation>().AnyAsync(a => a.TransferId == transfer))
                await payments.AllocateAsync(transfer, new(Id(400 + i), tenant, true), Id(810 + i), default);
        }
        actor.UserId = tenant; actor.Role = Roles.Tenant;
        var operations = sp.GetRequiredService<OperationsService>();
        var residence = await operations.ResidenceAsync(Id(40), Id(30), default);
        if (residence.Status == "Pending")
            await operations.UpdateResidenceAsync(Id(40), Id(30), new(Today.AddMonths(-1), "InProgress", null, "[TEST] Thử quy trình theo dõi; chưa đăng ký VNeID thực tế."), default);
        var residenceFiles = sp.GetRequiredService<IOperationsRepository>();
        var residenceFile = await residenceFiles.ResidenceEvidenceAsync(Id(40), Id(30), tenant, default);
        var residenceBytes = TestImage("SYNTHETIC UPLOAD - NOT VNEID EVIDENCE");
        var storage = sp.GetRequiredService<IObjectStorage>();
        if (residence.Status != "Completed" && (residenceFile is null || !await ObjectMatchesAsync(storage, residenceFile.ObjectKey, residenceBytes)))
        {
            using var residenceImage = new MemoryStream(residenceBytes);
            await operations.UploadResidenceEvidenceAsync(Id(40), Id(30), residenceImage, default);
        }
        var contracts = sp.GetRequiredService<ContractService>();
        foreach (var contractId in new[] { Id(40), Id(41), Id(42) })
        {
            if (!(await contracts.PreviewDocumentsAsync(contractId, default)).Any())
                await contracts.GeneratePreviewAsync(contractId, Id(900 + (contractId == Id(40) ? 0 : contractId == Id(41) ? 1 : 2)), default);
            // Recover only development preview objects created by this fixture after the initial storage credential failure.
            var contract = await db.Set<Contract>().Include(c => c.Residents).SingleAsync(c => c.Id == contractId);
            var previews = await db.Set<ContractDocumentFile>().Where(f => f.ContractId == contractId && f.Kind == ContractFileKind.Preview && f.DevelopmentOnly).ToListAsync();
            foreach (var preview in previews)
            {
                using var buffer = new MemoryStream();
                try { await storage.CopyToAsync(preview.ObjectKey, buffer, default); }
                catch (Minio.Exceptions.ObjectNotFoundException) { }
                if (buffer.Length == preview.Length && preview.FileHash == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(buffer.ToArray()))) continue;
                var document = new ContractDocument(contract.Id, contract.RoomId, owner, tenant, contract.RepresentativeResidentId,
                    contract.Residents.Select(r => r.ResidentId).Order().ToArray(), contract.StartDate, contract.EndDate, contract.MonthlyRent,
                    contract.RequiredDeposit, contract.HoldingContractId, contract.AppliedHoldingDeposit, contract.Terms, contract.SnapshotHash);
                var bytes = await sp.GetRequiredService<IContractDocumentRenderer>().RenderAsync(document, default);
                using var input = new MemoryStream(bytes); await storage.PutAsync(preview.ObjectKey, input, bytes.Length, "application/pdf", default);
                if (!await ObjectMatchesAsync(storage, preview.ObjectKey, bytes)) throw new LocalTestAccountException("Demo PDF upload failed verification.");
                preview.Length = bytes.Length; preview.FileHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
            }
            await db.SaveChangesAsync();
        }
        var incidents = sp.GetRequiredService<IncidentService>();
        for (var i = 0; i < 3; i++)
        {
            var description = new[] { "[TEST-TENANT-V1-0] Vòi nước nhỏ giọt, đề nghị kiểm tra. Dữ liệu tổng hợp.", "[TEST-TENANT-V1-1] Máy lạnh phát tiếng ồn, yêu cầu hỗ trợ. Dữ liệu tổng hợp.", "[TEST-TENANT-V1-2] Đèn phòng chập chờn, chưa có sự cố thật. Dữ liệu tổng hợp." }[i];
            if (await db.Set<IncidentReport>().AnyAsync(r => r.ReporterId == tenant && r.Description == description)) continue;
            await incidents.SubmitAsync(new(Id(10), Id(20), null, i == 0 ? Id(46) : Id(45), IncidentSeverity.Normal, description),
                [new(TestImage("SYNTHETIC INCIDENT PHOTO " + i))], Id(820 + i), default);
        }
        for (var i = 0; i < 3; i++)
        {
            var marker = "[TEST-TENANT-V1-" + i + "]";
            var incidentId = await db.Set<IncidentReport>().Where(r => r.ReporterId == tenant && r.Description.StartsWith(marker)).Select(r => r.Id).SingleAsync();
            foreach (var image in await db.Set<IncidentEvidence>().Where(e => e.IncidentId == incidentId).ToListAsync())
            {
                var bytes = TestImage("SYNTHETIC INCIDENT PHOTO " + i);
                if (image.Sha256 != Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes))) throw new LocalTestAccountException("Demo incident evidence differs; no overwrite.");
                if (!await ObjectMatchesAsync(storage, image.ObjectKey, bytes))
                { using var input = new MemoryStream(bytes); await storage.PutAsync(image.ObjectKey, input, bytes.Length, image.ContentType, default); }
            }
        }
        var adjustments = sp.GetRequiredService<AdjustmentService>();
        for (var i = 0; i < 3; i++)
        {
            var invoiceIndex = i == 2 ? 3 : i;
            var invoiceId = Id(400 + invoiceIndex);
            var reason = "[TEST-TENANT-V1-" + i + "] Đề nghị kiểm tra phí Internet tổng hợp, không phải khiếu nại thực tế.";
            if (await db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => r.RequesterId == tenant && r.InvoiceId == invoiceId && r.Reason == reason)) continue;
            var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(x => x.Id == invoiceId);
            using var evidenceStream = new MemoryStream(TestImage("SYNTHETIC ADJUSTMENT EVIDENCE"));
            var evidence = await adjustments.UploadAsync(invoiceId, evidenceStream, default);
            await adjustments.SubmitAsync(invoiceId, new(Id(500 + invoiceIndex * 10 + 3), 80_000, reason, [evidence.Id], invoice.Version), Id(830 + i), default);
        }
        var demoRequests = await db.Set<InvoiceAdjustmentRequest>().Where(r => r.RequesterId == tenant && r.Reason.StartsWith("[TEST-TENANT-V1-")).Select(r => r.Id).ToListAsync();
        foreach (var image in await db.Set<InvoiceAdjustmentEvidence>().Where(e => e.RequestId != null && demoRequests.Contains(e.RequestId.Value)).ToListAsync())
        {
            var bytes = TestImage("SYNTHETIC ADJUSTMENT EVIDENCE");
            if (image.Length != bytes.Length) throw new LocalTestAccountException("Demo adjustment evidence differs; no overwrite.");
            if (!await ObjectMatchesAsync(storage, image.ObjectKey, bytes))
            { using var input = new MemoryStream(bytes); await storage.PutAsync(image.ObjectKey, input, bytes.Length, image.ContentType, default); }
        }
        actor.UserId = owner; actor.Role = Roles.Owner;
        for (var i = 1; i < 3; i++)
        {
            var reason = "[TEST-TENANT-V1-" + i + "] Đề nghị kiểm tra phí Internet tổng hợp, không phải khiếu nại thực tế.";
            var request = await db.Set<InvoiceAdjustmentRequest>().SingleAsync(r => r.RequesterId == tenant && r.Reason == reason);
            var view = await adjustments.GetAsync(request.Id, default);
            if (view.Status == "Pending")
                await adjustments.DecideAsync(request.Id, i == 1, new(1, view.CurrentInvoice?.Version ?? view.InvoiceVersion, view.CurrentFinancialVersion,
                    i == 1 ? 80_000 : null, "INTERNET", "[TEST] Quyết định tổng hợp để kiểm tra trạng thái, không phải quyết định tài chính thực tế.", true), Id(840 + i), default);
        }
        var rejectTarget = await db.Set<IncidentReport>().SingleAsync(r => r.ReporterId == tenant && r.Description.StartsWith("[TEST-TENANT-V1-2]"));
        if (rejectTarget.Status == IncidentStatus.Submitted)
            await incidents.DecideAsync(rejectTarget.Id, "reject", new(rejectTarget.Version, "[TEST] Phiếu tổng hợp bị từ chối để thử bộ lọc."), Id(850), default);
        var progressTarget = await db.Set<IncidentReport>().AsNoTracking().SingleAsync(r => r.ReporterId == tenant && r.Description.StartsWith("[TEST-TENANT-V1-1]"));
        if (progressTarget.Status == IncidentStatus.Submitted)
        {
            if (progressTarget.Type is null || progressTarget.Category is null)
                await incidents.ReviewAsync(progressTarget.Id, new(progressTarget.Version, "[TEST] Thiết bị", "[TEST] Điều hòa"), Id(851), default);
            var updated = await incidents.GetAsync(progressTarget.Id, default);
            var staff = await db.Users.SingleAsync(u => u.Email == "staff.sample@example.invalid");
            await incidents.AssignAsync(progressTarget.Id, new(updated.Version, staff.Id, "[TEST] Kiểm tra thiết bị mẫu", DateTimeOffset.UtcNow.AddDays(2)), Id(852), default);
        }
        actor.UserId = null; actor.Role = "";
        Console.WriteLine("WORKFLOWS_READY: demo QR; one partially allocated invoice and one fully paid invoice through normal payment services; 3 adjustment requests with PNGs; 3 incident reports with PNGs; residence InProgress. No real funds or official evidence.");
    }

    private static async Task VerifyApiAsync(IServiceProvider sp, BHomePersistenceContext db, ApplicationUser tenant)
    {
        // Normal credential verification using the existing local demo secret. Never reset or print credentials.
        var password = sp.GetRequiredService<IConfiguration>()["BHOME_DEV_TEST_PASSWORD"];
        if (string.IsNullOrWhiteSpace(password)) throw new LocalTestAccountException("Demo data is ready, but the local test credential is missing; password unchanged.");
        var session = await sp.GetRequiredService<LoginService>().LoginAsync(Email, password, default, Marker + " API verification")
            ?? throw new LocalTestAccountException("Demo data is ready, but the local test credential did not match; password unchanged.");
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri("http://localhost:5240"), Timeout = TimeSpan.FromSeconds(30) };
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
            var paths = new[] { "/api/v1/auth/me", "/api/v1/account/profile", "/api/v1/contracts?page=1&pageSize=20", $"/api/v1/contracts/{Id(40)}",
                $"/api/v1/contracts/{Id(40)}/handover", "/api/v1/contracts/expiry-reminders", "/api/v1/invoices?page=1&pageSize=20", $"/api/v1/invoices/{Id(400)}",
                $"/api/v1/invoices/{Id(400)}/payment", $"/api/v1/invoices/{Id(400)}/transfer-instructions", "/api/v1/debts?page=1&pageSize=20", "/api/v1/payment-history?page=1&pageSize=20",
                "/api/v1/invoice-adjustments?page=1&pageSize=20", "/api/v1/incidents?page=1&pageSize=20", "/api/v1/residence-tasks?page=1&pageSize=20",
                "/api/v1/notifications?page=1&pageSize=20", "/api/v1/notifications/unread-count", $"/api/v1/contracts/{Id(40)}/previews",
                $"/api/v1/invoices/{Id(401)}/payment", $"/api/v1/invoices/{Id(402)}/payment", $"/api/v1/residence-tasks/{Id(40)}/{Id(30)}" };
            var demoIncidentIds = await db.Set<IncidentReport>().Where(r => r.ReporterId == tenant.Id && r.Description.StartsWith("[TEST-TENANT-V1-")).Select(r => r.Id).ToListAsync();
            var failures = 0;
            foreach (var path in paths.Concat(demoIncidentIds.SelectMany(id => new[] { $"/api/v1/incidents/{id}", $"/api/v1/incidents/{id}/history", $"/api/v1/incidents/{id}/evidence" })))
            {
                using var response = await http.GetAsync(path);
                Console.WriteLine($"API_VERIFY {(int)response.StatusCode} {path}");
                if (!response.IsSuccessStatusCode) { failures++; continue; }
                using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                if (json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty("totalCount", out var total)) Console.WriteLine("  totalCount=" + total.GetInt32());
                if (json.RootElement.ValueKind == JsonValueKind.Array) Console.WriteLine("  items=" + json.RootElement.GetArrayLength());
                if (json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty("paymentStatus", out var status)) Console.WriteLine("  paymentStatus=" + status.GetString());
                if (json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty("paidAmount", out var paid)) Console.WriteLine("  paidAmount=" + paid.GetString());
                if (path.EndsWith("transfer-instructions", StringComparison.Ordinal)) Console.WriteLine("  availability=" + json.RootElement.GetProperty("availability").GetString());
            }
            var files = new List<string> { $"/api/v1/contracts/{Id(40)}/handover/meter-evidence/{Id(350)}", $"/api/v1/contracts/{Id(40)}/handover/meter-evidence/{Id(351)}",
                $"/api/v1/residence-tasks/{Id(40)}/{Id(30)}/evidence" };
            var previews = await db.Set<ContractDocumentFile>().Where(f => new[] { Id(40), Id(41), Id(42) }.Contains(f.ContractId) && f.Kind == ContractFileKind.Preview).ToListAsync();
            files.AddRange(previews.Select(f => $"/api/v1/contracts/{f.ContractId}/previews/{f.Id}"));
            var incidentImages = await db.Set<IncidentEvidence>().Where(e => demoIncidentIds.Contains(e.IncidentId)).ToListAsync();
            files.AddRange(incidentImages.Select(e => $"/api/v1/incidents/{e.IncidentId}/evidence/{e.Id}"));
            var requestIds = await db.Set<InvoiceAdjustmentRequest>().Where(r => r.RequesterId == tenant.Id && r.Reason.StartsWith("[TEST-TENANT-V1-")).Select(r => r.Id).ToListAsync();
            var adjustmentImages = await db.Set<InvoiceAdjustmentEvidence>().Where(e => e.RequestId != null && requestIds.Contains(e.RequestId.Value)).ToListAsync();
            files.AddRange(adjustmentImages.Select(e => $"/api/v1/invoice-adjustments/{e.RequestId}/evidence/{e.Id}"));
            foreach (var path in files)
            {
                using var response = await http.GetAsync(path);
                var bytes = await response.Content.ReadAsByteArrayAsync();
                Console.WriteLine($"FILE_VERIFY {(int)response.StatusCode} bytes={bytes.Length} type={response.Content.Headers.ContentType} {path}");
                if (!response.IsSuccessStatusCode || bytes.Length < 100) failures++;
            }
            var storage = sp.GetRequiredService<IObjectStorage>();
            foreach (var preview in previews)
            {
                using var buffer = new MemoryStream(); await storage.CopyToAsync(preview.ObjectKey, buffer, default);
                Console.WriteLine($"OBJECT_CHECK preview length={preview.Length}/{buffer.Length}; hashMatch={preview.FileHash == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(buffer.ToArray()))}");
            }
            var evidence = await db.Set<BHome.Domain.Billing.MeterEvidence>().SingleAsync(e => e.Id == Id(250));
            using (var buffer = new MemoryStream())
            {
                await storage.CopyToAsync(evidence.ObjectKey, buffer, default);
                Console.WriteLine($"OBJECT_CHECK meter length={evidence.Length}/{buffer.Length}; hashMatch={evidence.ImageHash == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(buffer.ToArray()))}");
            }
            if (failures > 0) throw new LocalTestAccountException($"API verification failed for {failures} endpoints; credentials suppressed.");
            Console.WriteLine("TENANT_DEMO_VERIFIED: API reads succeeded; password/security stamp/role unchanged. Signed PDFs/provider signing and official VNeID evidence not manufactured.");
        }
        finally
        {
            await sp.GetRequiredService<IAuthenticationSessions>().RevokeAsync(tenant.Id, session.SessionId, false, default);
        }
    }
}
