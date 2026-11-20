using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresTheory]
    [InlineData("valid", "Sent")]
    [InlineData("missing", "Pending")]
    [InlineData("altered", "PermanentlyFailed")]
    [InlineData("other-contract", "PermanentlyFailed")]
    public async Task ExistingTenantActivationEmailIncludesExactSignedPdfAndRejectsMissingOrUntrustedDocuments(string scenario, string expectedState)
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var c = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contracts[0]);
        var evidence = AnonymousContractSigningService.AcceptedEvidence(c)!;
        if (scenario == "missing") await confirmationStorage.DeleteAsync(evidence.FinalDocumentKey!, default);
        if (scenario == "altered")
        {
            using var changed = new MemoryStream("%PDF-1.7 ALTERED"u8.ToArray());
            await confirmationStorage.PutAsync(evidence.FinalDocumentKey!, changed, changed.Length, "application/pdf", default);
        }
        if (scenario == "other-contract")
            c.InternalAcceptance = JsonSerializer.Serialize(evidence with { FinalDocumentKey = $"contracts/{w.Contracts[1]:N}/internal/synthetic-accepted.pdf" });
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = w.Owner.Id,
            Event = "ContractActivated",
            TargetId = c.Id,
            TargetType = "Contract",
            Succeeded = true,
            OccurredAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);
        var user = w.Tenants[0].Id;
        var notice = await db.Set<BHome.Domain.Notifications.UserNotification>().SingleAsync(n => n.RelatedObjectId == c.Id &&
            n.RecipientUserId == user && n.EventType == "CONTRACT_ACTIVATED");
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().EnqueueDueAsync(default);
        var delivery = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'notificationId'={notice.Id.ToString()} AND event_data->>'channel'='EMAIL'
            """).SingleAsync();
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().DeliverAsync(delivery, default);
        var state = await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.Equal(expectedState, state);
        if (scenario == "valid")
        {
            var mail = Assert.Single(probe.Messages);
            Assert.Equal(w.Tenants[0].Email, mail.Destination);
            Assert.Null(mail.ActionUrl);
            Assert.Contains("Trạng thái tài khoản: Đang hoạt động", mail.Body);
            var file = Assert.Single(mail.Attachments!);
            Assert.Equal("%PDF-1.7 SYNTHETIC MAIN BOTH SIGNED"u8.ToArray(), file.Content);
            Assert.Equal("application/pdf", file.ContentType);
            await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().DeliverAsync(delivery, default);
            Assert.Single(probe.Messages);
        }
        else Assert.Empty(probe.Messages);
        Assert.Equal(ContractStatus.Active, c.Status);
    }

    [CompactPostgresFact]
    public async Task MainActivationAttachmentCannotReadAnotherTenantsContract()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        await using var scope = host.Services.CreateAsyncScope();
        var content = scope.ServiceProvider.GetRequiredService<NotificationEmailContent>();
        var error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => content.MainAttachmentsAsync(w.Contracts[0], w.Tenants[1].Id, default));
        Assert.Equal("main_confirmation_document_invalid", error.Code);
        Assert.Empty(probe.Messages);
    }
}
