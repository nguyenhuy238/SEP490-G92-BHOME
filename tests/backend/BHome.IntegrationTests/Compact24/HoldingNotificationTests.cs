using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using BHome.Application.Storage;
using Microsoft.AspNetCore.Hosting;
using System.Security.Cryptography;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresTheory]
    [InlineData(ContractKind.Holding)]
    [InlineData(ContractKind.Main)]
    public async Task SubmissionNotifiesOnlyDesignatedOwnerOnceAndLinksToContract(ContractKind kind)
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var contract = await AddSyntheticHolding(db, w, active: false);
        contract.Kind = kind;
        var action = kind == ContractKind.Holding ? "HoldingSigningSubmitted" : "MainSigningSubmitted";
        var eventType = kind == ContractKind.Holding ? "HOLDING_OWNER_SIGNING_REQUIRED" : "MAIN_OWNER_SIGNING_REQUIRED";
        foreach (var _ in Enumerable.Range(0, 2)) db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = w.Staff.Id,
            Event = action,
            TargetId = contract.Id,
            TargetType = "Contract",
            Succeeded = true,
            OccurredAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var events = scope.ServiceProvider.GetRequiredService<CompactNotificationEvents>();
        await events.PublishOwnerSigningRequestsAsync(default);
        await events.PublishOwnerSigningRequestsAsync(default);
        await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);
        var notice = Assert.Single(await db.Set<BHome.Domain.Notifications.UserNotification>().AsNoTracking()
            .Where(n => n.RelatedObjectId == contract.Id && n.EventType == eventType).ToArrayAsync());
        Assert.Equal(w.Owner.Id, notice.RecipientUserId); Assert.Equal("Owner", notice.AudienceRole);
        Assert.Null(notice.ReadAt); Assert.Equal(kind == ContractKind.Holding ? "Hợp đồng giữ chỗ cần ký" : "Hợp đồng thuê cần ký", notice.Title);
        Assert.Contains("HOLD-101", notice.Summary); Assert.Equal("Contract", notice.RelatedObjectType);
        var target = await scope.ServiceProvider.GetRequiredService<INotificationRepository>().TargetAsync(
            new(w.Owner.Id, true, false, false, Today), notice.Id, default);
        Assert.NotNull(target); Assert.Equal(contract.Id, target.ObjectId);
        Assert.Empty(probe.Messages);
    }

    [CompactPostgresTheory]
    [InlineData(false, false, false, false)]
    [InlineData(true, false, false, false)]
    [InlineData(false, true, false, false)]
    [InlineData(false, false, true, false)]
    [InlineData(false, false, false, true)]
    public async Task HoldingActivationQueuesOneConfirmationToAcceptedInvitationEmailAndSmtpFailureDoesNotUndoHolding(
        bool smtpUnknown, bool corruptDocument, bool missingDocument, bool converted)
    {
        var w = await Seed(); var probe = new SmtpProbe
        {
            Failure = smtpUnknown ? new ChannelDeliveryException("email_submission_outcome_unknown", outcomeUnknown: true) : null
        };
        var storage = new Compact24WorkflowFixture.TestObjectStorage();
        using var emailHost = EmailHost(probe);
        using var host = emailHost.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<IObjectStorage>(storage)));
        Guid id, delivery;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var c = await AddSyntheticHolding(db, w, active: true, storage); id = c.Id;
            if (corruptDocument)
            {
                var key = AnonymousContractSigningService.AcceptedEvidence(c)!.FinalDocumentKey!;
                using var wrong = new MemoryStream("%PDF-1.7 ALTERED"u8.ToArray());
                await storage.PutAsync(key, wrong, wrong.Length, "application/pdf", default);
            }
            if (missingDocument) await storage.DeleteAsync(AnonymousContractSigningService.AcceptedEvidence(c)!.FinalDocumentKey!, default);
            var payment = Guid.NewGuid(); var allocation = Guid.NewGuid(); var operation = Guid.NewGuid();
            var reference = "SYNTHETIC-" + payment.ToString("N"); var now = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
                VALUES({payment},'SYNTHETIC','test',{reference},{reference},{now},1000000,'VND','VERIFIED','MANUAL',{w.Owner.Id},{now})
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
                VALUES({allocation},{payment},{id},1000000,{operation},1,{w.Owner.Id},{now},'Synthetic verified Holding deposit')
                """);
            foreach (var action in new[] { "HoldingActivated", "Automatic:HoldingActivated" }) db.SecurityAudit.Add(new SecurityAuditRecord
            {
                UserId = w.Owner.Id,
                Event = action,
                TargetId = id,
                TargetType = "Contract",
                Succeeded = true,
                OccurredAt = now
            });
            if (converted) c.Status = ContractStatus.Converted;
            await db.SaveChangesAsync();
            if (!converted)
            {
                var publisher = scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>();
                await publisher.PublishPendingAsync(default);
                await publisher.PublishPendingAsync(default);
            }
            else
            {
                // A converted Holding must still send with only the dedicated delivery pass.
                var channels = scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>();
                var events = scope.ServiceProvider.GetRequiredService<CompactNotificationEvents>();
                await channels.ProcessHoldingConfirmationsAsync(events, default);
                await channels.ProcessHoldingConfirmationsAsync(events, default);
            }
            delivery = Assert.Single(await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE record_kind='OUTBOX' AND event_key={"holding-confirmed:" + id.ToString("N")}").ToArrayAsync());
            if (!converted)
            {
                var notice = Assert.Single(await db.Set<BHome.Domain.Notifications.UserNotification>().AsNoTracking()
                    .Where(n => n.RelatedObjectId == id && n.EventType == "HOLDING_ACTIVATED").ToArrayAsync());
                Assert.Equal(w.Owner.Id, notice.RecipientUserId); Assert.Null(notice.ReadAt);
                var target = await scope.ServiceProvider.GetRequiredService<INotificationRepository>().TargetAsync(new(w.Owner.Id, true, false, false, Today), notice.Id, default);
                Assert.Equal(id, target!.ObjectId);
            }
        }
        await SendEmail(host, delivery); await SendEmail(host, delivery);
        if (!corruptDocument && !missingDocument)
        {
            var email = Assert.Single(probe.Messages);
            Assert.Equal("staff-entered@example.invalid", email.Destination);
            Assert.NotEqual(w.Tenants[0].Email, email.Destination);
            Assert.Equal("BHOME – Xác nhận giữ chỗ thành công", email.Title);
            Assert.Contains("1.000.000", email.Body); Assert.Contains(id.ToString("D"), email.Body);
            Assert.Equal(2, email.Attachments!.Count);
            if (converted) Assert.Contains("Đã chuyển sang hợp đồng thuê", email.Body);
            Assert.Equal("%PDF-1.7 SYNTHETIC BOTH SIGNED"u8.ToArray(), email.Attachments[0].Content);
            Assert.All(email.Attachments, a => Assert.Equal("application/pdf", a.ContentType));
            using var receipt = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(email.Attachments[1].Content)));
            var text = iText.Kernel.Pdf.Canvas.Parser.PdfTextExtractor.GetTextFromPage(receipt.GetPage(1));
            Assert.Contains("BIÊN NHẬN TIỀN GIỮ CHỖ", text); Assert.Contains("1.000.000", text); Assert.Contains(id.ToString("D"), text);
            Assert.Contains("Synthetic Holding Tenant", text); Assert.Contains("HOLD-101", text);
            if (!smtpUnknown && Environment.GetEnvironmentVariable("BHOME_HOLDING_RECEIPT_QA") is { Length: > 0 } qa)
            {
                Directory.CreateDirectory(qa);
                await File.WriteAllBytesAsync(Path.Combine(qa, "holding-receipt.pdf"), email.Attachments[1].Content);
                await File.WriteAllBytesAsync(Path.Combine(qa, "holding-receipt.png"),
                    new BHome.Infrastructure.Contracts.ContractSigningPages().RenderPage(email.Attachments[1].Content, 1, 1000));
            }
        }
        else Assert.Empty(probe.Messages);
        await using var check = host.Services.CreateAsyncScope();
        var data = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var state = await data.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.Equal(corruptDocument ? "PermanentlyFailed" : missingDocument ? "Pending" : smtpUnknown ? "PendingReview" : "Sent", state);
        var held = await data.Set<Contract>().Include(c => c.Room).SingleAsync(c => c.Id == id);
        Assert.Equal(converted ? ContractStatus.Converted : ContractStatus.Active, held.Status);
        Assert.Equal(RoomStatus.OnHold, held.Room.Status);
    }

    private static async Task<Contract> AddSyntheticHolding(Compact24DbContext db, Workspace w, bool active, IObjectStorage? storage = null)
    {
        var room = new Room { LocationId = w.Location, RoomNumber = "HOLD-101", Capacity = 1, Status = active ? RoomStatus.OnHold : RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic Holding Tenant", VerificationStatus = IdentityVerificationStatus.Verified };
        var c = new Contract
        {
            Kind = ContractKind.Holding,
            RoomId = room.Id,
            OwnerSignerId = w.Owner.Id,
            RepresentativeResidentId = resident.Id,
            SigningMode = ContractSigningModes.Internal,
            SnapshotHash = new string('A', 64),
            StartDate = Today,
            EndDate = Today.AddMonths(1),
            HoldingExpiryAt = DateTimeOffset.UtcNow.AddDays(2),
            RequiredDeposit = 1000000,
            Status = active ? ContractStatus.Active : ContractStatus.PendingSigning,
            ActivatedAt = active ? DateTimeOffset.UtcNow : null,
            ActivatedByUserId = active ? w.Owner.Id : null,
            Residents = [new ContractResident { ResidentId = resident.Id, ResidenceFrom = Today }]
        };
        db.AddRange(room, resident, c); await db.SaveChangesAsync();
        if (active)
        {
            var invitation = new ContractSigningInvitation
            {
                ContractId = c.Id,
                ResidentId = resident.Id,
                ApprovedByUserId = w.Owner.Id,
                SnapshotHash = c.SnapshotHash,
                TokenHash = new string('B', 64),
                DocumentHash = new string('C', 64),
                RecipientEmail = "staff-entered@example.invalid",
                ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
                AcceptedAt = DateTimeOffset.UtcNow,
                DeliveryStatus = "Accepted"
            };
            var signed = "%PDF-1.7 SYNTHETIC BOTH SIGNED"u8.ToArray();
            var signedKey = $"contracts/{c.Id:N}/internal/{invitation.Id:N}/accepted.pdf";
            var hash = Convert.ToHexString(SHA256.HashData(signed));
            using var bytes = new MemoryStream(signed);
            await storage!.PutAsync(signedKey, bytes, bytes.Length, "application/pdf", default);
            c.InternalAcceptance = JsonSerializer.Serialize(new InternalAcceptanceEvidence(invitation.Id, resident.Id, c.SnapshotHash,
                invitation.DocumentHash, "synthetic-stroke", signedKey, hash, DateTimeOffset.UtcNow,
                w.Owner.Id, DateTimeOffset.UtcNow, signedKey, hash));
            db.Add(invitation);
        }
        await db.SaveChangesAsync(); return c;
    }
}
