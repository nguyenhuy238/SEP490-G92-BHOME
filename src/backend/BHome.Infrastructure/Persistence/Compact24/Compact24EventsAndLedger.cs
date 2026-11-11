using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed partial class Compact24DbContext
{
    private async Task WriteNotificationAsync(EntityEntry entry, CompactRecordSql spec, string state, string envelope, string key, CancellationToken token)
    {
        var json = JsonNode.Parse(state)!.AsObject();
        object? Value(string name) => json[CompactRecordSql.Camel(name)]?.GetValueKind() switch
        {
            JsonValueKind.String => json[CompactRecordSql.Camel(name)]!.GetValue<string>(),
            _ => null
        };
        var id = entry.Metadata.FindProperty("Id") is not null ? (Guid)entry.Property("Id").CurrentValue! : DeterministicId(spec.Name + "/" + key);
        var inbox = entry.Entity as BHome.Domain.Notifications.UserNotification;
        if (entry.Entity is BHome.Domain.IncidentMaintenance.IncidentNotification incidentNotice && entry.State == EntityState.Modified)
        {
            if (entry.Properties.Any(p => p.IsModified && p.Metadata.Name is not
                ("ReadAt" or "DeliveryState" or "DeliveryReference" or "DeliveryError" or "UpdatedAt")))
                throw new InvalidOperationException("Incident notification event is immutable.");
            await ExecuteAsync("UPDATE notifications SET read_at=@read,delivery_status=@status,delivery_history=delivery_history||jsonb_build_array(@envelope::jsonb) WHERE id=@id AND record_kind='OUTBOX'", token,
                ("id", id), ("read", incidentNotice.ReadAt), ("status", incidentNotice.DeliveryState), ("envelope", envelope));
            return;
        }
        if (entry.Entity is BHome.Domain.StaffOperations.OperationalTaskNotification taskNotice && entry.State == EntityState.Modified)
        {
            if (entry.Properties.Any(p => p.IsModified && p.Metadata.Name is not ("ReadAt" or "UpdatedAt")))
                throw new InvalidOperationException("Task notification event is immutable.");
            await ExecuteAsync("UPDATE notifications SET read_at=@read,delivery_history=delivery_history||jsonb_build_array(@envelope::jsonb) WHERE id=@id AND record_kind='OUTBOX'", token,
                ("id", id), ("read", taskNotice.ReadAt), ("envelope", envelope));
            return;
        }
        if (inbox is not null && entry.State == EntityState.Modified)
        {
            var immutable = new[] { "RecipientUserId", "EventKey", "AudienceRole", "Category", "EventType", "Priority", "Source", "Channels", "Title", "Summary", "RelatedObjectType", "RelatedObjectId", "LocationId", "CreatedAt", "SourceTaskNotificationId" };
            if (immutable.Any(name => entry.Property(name).IsModified)) throw new InvalidOperationException("Notification event is immutable.");
            await ExecuteAsync("""
                UPDATE notifications SET read_at=@read,delivery_status=@status,next_delivery_at=@next,locked_until=@locked,lease_token=@lease,
                  delivery_history=delivery_history||jsonb_build_array(@envelope::jsonb) WHERE id=@id AND record_kind='INBOX'
                """, token, ("id", id), ("read", inbox.ReadAt), ("status", inbox.DeliveryState), ("next", inbox.NextDeliveryAt),
                ("locked", inbox.DeliveryLockedUntil), ("lease", inbox.DeliveryLeaseToken), ("envelope", envelope));
            return;
        }
        if (entry.State != EntityState.Added) throw new InvalidOperationException("Notification intent/audit is append-only.");
        var audit = entry.Entity as SecurityAuditRecord;
        var property = entry.Entity as BHome.Domain.PropertyManagement.PropertyChange;
        var kind = inbox is not null ? "INBOX" : audit is not null || property is not null ? "AUDIT" : "OUTBOX";
        var eventKey = inbox?.EventKey ?? spec.Name + ":" + key;
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = spec.Name,
            state = json,
            audienceRole = inbox?.AudienceRole,
            category = inbox?.Category,
            succeeded = audit?.Succeeded,
            sessionId = audit?.SessionId,
            targetUserId = audit?.TargetUserId
        }, RecordJson);
        var occurred = inbox?.CreatedAt ?? audit?.OccurredAt ?? property?.OccurredAt ??
            (Value("OccurredAt") is string time ? DateTimeOffset.Parse(time, System.Globalization.CultureInfo.InvariantCulture) :
             Value("PublishedAt") is string published ? DateTimeOffset.Parse(published, System.Globalization.CultureInfo.InvariantCulture) :
             Value("CreatedAt") is string created ? DateTimeOffset.Parse(created, System.Globalization.CultureInfo.InvariantCulture) : DateTimeOffset.UtcNow);
        await ExecuteAsync("""
            INSERT INTO notifications(id,record_kind,recipient_user_id,actor_user_id,location_id,event_key,notification_type,related_entity_type,related_entity_id,
              title,message,event_data,event_at,read_at,delivery_status,next_delivery_at,locked_until,lease_token)
            VALUES(@id,@kind,@recipient,@actor,@location,@key,@type,@targetType,@target,@title,@message,@data::jsonb,@at,@read,@delivery,@next,@locked,@lease)
            """, token, ("id", id), ("kind", kind), ("recipient", inbox?.RecipientUserId), ("actor", audit?.UserId ?? property?.ActorId),
            ("location", inbox?.LocationId ?? property?.LocationId), ("key", eventKey), ("type", audit?.Event ?? property?.Action ?? inbox?.Category ?? spec.Name),
            ("targetType", inbox?.RelatedObjectType ?? audit?.TargetType ?? property?.TargetType), ("target", inbox?.RelatedObjectId ?? audit?.TargetId ?? property?.TargetId),
            ("title", inbox?.Title), ("message", inbox?.Summary), ("data", data), ("at", occurred), ("read", entry.Entity is BHome.Domain.StaffOperations.OperationalTaskNotification oldTask ? oldTask.ReadAt : inbox?.ReadAt), ("delivery", inbox?.DeliveryState),
            ("next", inbox?.NextDeliveryAt), ("locked", inbox?.DeliveryLockedUntil), ("lease", inbox?.DeliveryLeaseToken));
    }

    private async Task AssignSequenceAsync(EntityEntry entry, CancellationToken token)
    {
        if (entry.State != EntityState.Added || entry.Metadata.FindProperty("Sequence") is null || Convert.ToInt64(entry.Property("Sequence").CurrentValue) != 0) return;
        var name = entry.Metadata.ClrType.Name;
        // Source identity sequences were global per record type. A parent-row lock alone
        // permits two different receipts/requests to choose the same next sequence.
        await Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"compact24-sequence:" + name},0))", token);
        var spec = Compact24Records.For(entry.Metadata.ClrType);
        var parentName = name == "InvoiceAdjustmentDecision" ? "RequestId" : spec.Parent;
        var parentId = (Guid)entry.Property(parentName).CurrentValue!;
        var source = name == "InvoiceAdjustmentDecision" ? "invoice_adjustments" : spec.Table;
        await ExecuteAsync($"SELECT id FROM {source} WHERE id=@id FOR UPDATE", token, ("id", parentId));
        await Database.OpenConnectionAsync(token);
        var container = name == "InvoiceAdjustmentDecision" ? "history" : spec.Container;
        await using var cmd = new NpgsqlCommand($"SELECT COALESCE(max((h->'state'->>'sequence')::bigint),0)+1 FROM {source} t CROSS JOIN LATERAL jsonb_array_elements(t.{container}) h WHERE h->>'recordType'=@type",
            (NpgsqlConnection)Database.GetDbConnection(), (NpgsqlTransaction?)Database.CurrentTransaction?.GetDbTransaction());
        cmd.Parameters.AddWithValue("type", name);
        var sequence = (long)(await cmd.ExecuteScalarAsync(token))!;
        entry.Property("Sequence").CurrentValue = entry.Property("Sequence").Metadata.ClrType == typeof(int) ? (object)checked((int)sequence) : sequence;
    }

    private static PostgresException LedgerConflict() => new("Compact24 financial invariant violated.", "ERROR", "ERROR", "23514");

    private async Task ValidateAllocationAsync(PaymentAllocation allocation, CancellationToken token)
    {
        await Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", token);
        if (allocation.DepositOffsetApprovalId is not null)
        {
            // The native guard verifies the immutable Owner approval, exact target,
            // remaining obligation and unreserved source funds in this transaction.
            if (allocation.TransferId is not null || allocation.SourceDepositContractId is null || allocation.TargetDepositContractId is not null || allocation.Amount <= 0)
                throw LedgerConflict();
            return;
        }
        if (allocation.TransferId is { } transferId)
        {
            if (allocation.SourceDepositContractId is not null ||
                (allocation.TargetDepositContractId is null ? 0 : 1) + (allocation.InvoiceId is null ? 0 : 1) + (allocation.TargetSettlementContractId is null ? 0 : 1) != 1 ||
                await Set<PaymentAllocation>().AnyAsync(a => a.TransferId == transferId, token)) throw LedgerConflict();
            var transfer = await Set<PaymentTransfer>().SingleAsync(p => p.Id == transferId, token);
            if (allocation.TargetSettlementContractId is { } settlementContract)
            {
                var charges = await BHome.Infrastructure.Contracts.SettlementChargeRecords.ReadAsync<BHome.Application.Contracts.SettlementReceivable>(this,
                    settlementContract, BHome.Infrastructure.Contracts.SettlementChargeRecords.ChargeKind, token);
                var charge = charges.SingleOrDefault(c => c.Id == allocation.SettlementReceivableId);
                var settled = await Set<PaymentAllocation>().Where(a => a.TargetSettlementContractId == settlementContract && a.SettlementReceivableId == allocation.SettlementReceivableId)
                    .SumAsync(a => (decimal?)a.Amount, token) ?? 0;
                if (charge is null || allocation.Amount <= 0 || allocation.Amount != Math.Min(transfer.Amount, charge.Amount - settled) ||
                    allocation.PaidByUserId is { } payer && !charge.RecipientUserIds.Contains(payer) ||
                    await Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == transfer.NormalizedReference, token)) throw LedgerConflict();
                return;
            }
            if (allocation.TargetDepositContractId is { } depositContractId)
            {
                var depositHolding = await Set<Contract>().SingleAsync(c => c.Id == depositContractId, token);
                var paymentReceived = await Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == depositContractId)
                    .SumAsync(a => (decimal?)a.Amount, token) ?? 0m;
                if (depositHolding.Kind != ContractKind.Holding || depositHolding.ApprovedAt is null || depositHolding.Status is ContractStatus.Expired or ContractStatus.Cancelled or ContractStatus.Converted ||
                    depositHolding.HoldingExpiryAt <= allocation.AllocatedAt || allocation.Amount <= 0 ||
                    allocation.Amount != Math.Min(transfer.Amount, depositHolding.RequiredDeposit - paymentReceived) ||
                    await Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == transfer.NormalizedReference, token)) throw LedgerConflict();
                return;
            }
            var invoice = await Set<Invoice>().SingleAsync(i => i.Id == allocation.InvoiceId, token);
            var paid = await Set<PaymentAllocation>().Where(a => a.InvoiceId == allocation.InvoiceId).SumAsync(a => (decimal?)a.Amount, token) ?? 0m;
            var adjustments = await Set<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == allocation.InvoiceId && d.Outcome == "Approved" && d.InvoiceStatus == InvoiceStatus.Final).SumAsync(d => (decimal?)d.Delta, token) ?? 0m;
            if (invoice.Status != InvoiceStatus.Final || allocation.Amount <= 0 || allocation.Amount != Math.Min(transfer.Amount, invoice.Total + adjustments - paid) ||
                await Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == transfer.NormalizedReference, token)) throw LedgerConflict();
            return;
        }
        if (allocation.TargetSettlementContractId is not null || allocation.SettlementReceivableId is not null) throw LedgerConflict();
        if (allocation.SourceDepositContractId is not { } source || allocation.TargetDepositContractId is not { } target || allocation.InvoiceId is not null ||
            allocation.Amount <= 0 || await Set<PaymentAllocation>().AnyAsync(a => a.SourceDepositContractId == source, token)) throw LedgerConflict();
        var holding = await Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == source, token);
        var main = ChangeTracker.Entries<Contract>().SingleOrDefault(e => e.Entity.Id == target)?.Entity ??
            await Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == target, token);
        var received = await Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == source).SumAsync(a => (decimal?)a.Amount, token) ?? 0m;
        if (holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active || main is null || main.Kind != ContractKind.Main ||
            main.HoldingContractId != source || main.RoomId != holding.RoomId || main.TenantUserId != holding.TenantUserId ||
            allocation.Amount != Math.Min(received, main.RequiredDeposit)) throw LedgerConflict();
    }

    private async Task ClaimReferenceAsync(Guid paymentId, Guid? allocationId, Guid? depositId, CancellationToken token)
    {
        await ExecuteAsync("""
            UPDATE payments SET history=history||jsonb_build_array(jsonb_build_object('schemaVersion',1,'recordType','BankReferenceClaim',
                'recordKey',upper(btrim(transaction_reference)), 'state',jsonb_build_object('normalizedReference',upper(btrim(transaction_reference)),
                 'allocationId',@allocation::uuid,'depositVerificationId',@deposit::uuid))) WHERE id=@id
            """, token, ("id", paymentId), ("allocation", allocationId), ("deposit", depositId));
    }

    private async Task WriteDepositAsync(DepositVerification deposit, string state, string envelope, CancellationToken token)
    {
        await Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", token);
        var reference = deposit.BankTransactionReference.Trim().ToUpperInvariant();
        if (!Importing && await Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == reference, token)) throw LedgerConflict();
        // Old deposits have no provider/account field. Preserve that fact explicitly; this namespace
        // cannot be used to auto-match a later provider callback or infer receiving bank details.
        await ExecuteAsync("""
            INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,
              verification_method,verified_by_user_id,verified_at,verification_data,history)
            VALUES(@id,'LEGACY_DEPOSIT','legacy-unscoped',@reference,@effect,@at,@amount,'VND','VERIFIED','MANUAL',@actor,@at,
              jsonb_build_object('schemaVersion',1,'origin','ContractDepositVerification'),jsonb_build_array(@envelope::jsonb))
            """, token, ("id", deposit.Id), ("reference", reference), ("effect", "deposit:" + reference), ("at", deposit.VerifiedAt),
            ("amount", deposit.Amount), ("actor", deposit.VerifiedByUserId), ("envelope", envelope));
        await ExecuteAsync("""
            INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
            VALUES(@id,@source,@contract,@amount,@source,1,@actor,@at,@reason)
            """, token, ("id", DeterministicId("depositAllocation/" + deposit.Id)), ("source", deposit.Id), ("contract", deposit.ContractId),
            ("amount", deposit.Amount), ("actor", deposit.VerifiedByUserId), ("at", deposit.VerifiedAt), ("reason", deposit.VerificationReason));
        if (!Importing) await ClaimReferenceAsync(deposit.Id, null, deposit.Id, token);
    }

    private async Task WriteImportedClaimAsync(BankReferenceClaim claim, string envelope, CancellationToken token)
    {
        if (!Importing) throw new InvalidOperationException("Bank references are claimed atomically with verified allocations.");
        var payment = claim.DepositVerificationId ?? await Set<PaymentAllocation>().Where(a => a.Id == claim.AllocationId).Select(a => a.TransferId).SingleAsync(token);
        await ExecuteAsync("UPDATE payments SET history=history||jsonb_build_array(@envelope::jsonb) WHERE id=@id", token, ("id", payment), ("envelope", envelope));
    }
}
