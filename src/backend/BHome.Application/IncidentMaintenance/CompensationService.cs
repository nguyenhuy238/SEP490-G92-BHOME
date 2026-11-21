using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CompensationInput(Guid ContractId, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    string CollectionMethod, DateOnly? DueDate, string Reason, Guid[] EvidenceIds);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CompensationDecision(int Version, string Reason);
public sealed record CompensationContract(Guid Id, string Status, DateOnly StartDate, DateOnly EndDate);
public sealed record CompensationSource(MaintenanceWorkOrder Work, Guid ContractId, Guid DepositContractId,
    Guid[] Recipients, string RoomNumber, string LocationName, decimal AvailableDeposit, bool MoveOutReady);
public sealed record CompensationView(Guid Id, Guid WorkOrderId, Guid ContractId, string CollectionMethod, string Status,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal ActualRepairCost,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount, string Reason, Guid? InvoiceId,
    Guid DecidedById, DateTimeOffset DecidedAt, DateTimeOffset? DeductedAt, int Version);

public interface ICompensationRepository
{
    Task<bool> ActiveOwnerAsync(Guid actor, CancellationToken t);
    Task<T> TransactionAsync<T>(Guid workOrder, Guid actor, Guid key, Func<Task<T>> work, CancellationToken t);
    Task<MaintenanceWorkOrder?> WorkAsync(Guid id, CancellationToken t);
    Task<IReadOnlyList<CompensationContract>> ContractsAsync(Guid room, CancellationToken t);
    Task<CompensationSource> SourceAsync(Guid workOrder, Guid contract, CancellationToken t);
    Task<MaintenanceCompensation?> FindAsync(Guid workOrder, CancellationToken t);
    Task<IReadOnlyList<CompensationView>> HistoryAsync(Guid workOrder, CancellationToken t);
    Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t);
    Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid workOrder, CancellationToken t);
    Task<bool> InvoiceHasMoneyAsync(Guid invoice, CancellationToken t);
    Task FlushAsync(CancellationToken t);
    void Add(object entity);
    void Audit(Guid actor, string action, Guid target, DateTimeOffset now);
}

public sealed class CompensationService(ICompensationRepository repository, ICurrentUser user, IIncidentFiles files, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new IncidentException(401, "authentication_required");
    private DateTimeOffset Now => clock.GetUtcNow();
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(Now, "Asia/Ho_Chi_Minh").DateTime);
    private async Task Owner(CancellationToken t)
    {
        if (!user.IsInRole(Roles.Owner) || !await repository.ActiveOwnerAsync(Actor, t)) throw new IncidentException(403, "incident_permission_denied");
    }
    private static string Reason(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length > 2000) throw IncidentException.Invalid("compensation_reason_required");
        return value.Trim();
    }
    public async Task<IReadOnlyList<CompensationContract>> ContractsAsync(Guid id, CancellationToken t)
    {
        await Owner(t);
        var work = await repository.WorkAsync(id, t) ?? throw IncidentException.Missing();
        return work.RoomId is { } room ? await repository.ContractsAsync(room, t) : [];
    }
    public async Task<CompensationView?> GetAsync(Guid workOrder, CancellationToken t)
    {
        await Owner(t);
        _ = await repository.WorkAsync(workOrder, t) ?? throw IncidentException.Missing();
        var row = await repository.FindAsync(workOrder, t);
        if (row is null) return null;
        var view = View(row);
        if (row.InvoiceId is { } invoice && await repository.InvoiceHasMoneyAsync(invoice, t)) view = view with { Status = "PaymentRecorded" };
        return view;
    }
    public async Task<IReadOnlyList<CompensationView>> HistoryAsync(Guid workOrder, CancellationToken t)
    {
        await Owner(t);
        _ = await repository.WorkAsync(workOrder, t) ?? throw IncidentException.Missing();
        return await repository.HistoryAsync(workOrder, t);
    }
    private async Task<CompensationView> Command(Guid id, Guid key, string operation, object input,
        Func<Task<MaintenanceCompensation>> mutation, CancellationToken t)
    {
        await Owner(t);
        if (key == Guid.Empty) throw IncidentException.Invalid("idempotency_key_required");
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { id, operation, input })));
        return await repository.TransactionAsync(id, Actor, key, async () =>
        {
            await Owner(t);
            var previous = await repository.CommandAsync(Actor, key, t);
            if (previous is not null)
            {
                if (previous.Fingerprint != fingerprint) throw IncidentException.Conflict("idempotency_conflict");
                return JsonSerializer.Deserialize<CompensationView>(previous.ResponseJson)!;
            }
            var row = await mutation(); var result = View(row);
            repository.Add(new IncidentCommand
            {
                ActorId = Actor,
                Key = key,
                IncidentId = row.IncidentId,
                Fingerprint = fingerprint,
                ResponseJson = JsonSerializer.Serialize(result)
            });
            repository.Audit(Actor, "MaintenanceCompensation_" + operation, row.Id, Now);
            return result;
        }, t);
    }
    public Task<CompensationView> CreateAsync(Guid id, CompensationInput input, Guid key, CancellationToken t) =>
        Command(id, key, "create", input, async () =>
        {
            var source = await repository.SourceAsync(id, input.ContractId, t);
            if (source.Work.Status != WorkOrderStatus.Verified || source.Work.RoomId is null || source.Work.ActualCost is not { } actual)
                throw IncidentException.Conflict("verified_room_maintenance_required");
            if (input.Amount <= 0 || input.Amount > actual || decimal.Truncate(input.Amount) != input.Amount)
                throw IncidentException.Invalid("invalid_compensation_amount");
            if (input.CollectionMethod is not ("Invoice" or "Deposit")) throw IncidentException.Invalid("invalid_compensation_method");
            if (await repository.FindAsync(id, t) is not null) throw IncidentException.Conflict("compensation_already_decided");
            if (input.EvidenceIds is null || input.EvidenceIds.Length is < 1 or > 5 || input.EvidenceIds.Distinct().Count() != input.EvidenceIds.Length)
                throw IncidentException.Invalid("invalid_incident_evidence");
            var evidence = await repository.EvidenceAsync(id, t);
            foreach (var evidenceId in input.EvidenceIds)
            {
                var image = evidence.SingleOrDefault(e => e.Id == evidenceId && e.ActivityId is not null) ?? throw IncidentException.Invalid("invalid_incident_evidence");
                await VerifyEvidenceAsync(image, t);
            }
            if (input.CollectionMethod == "Deposit" && (input.DueDate is not null || source.AvailableDeposit < input.Amount))
                throw IncidentException.Conflict("compensation_deposit_insufficient");
            var row = new MaintenanceCompensation
            {
                WorkOrderId = id,
                IncidentId = source.Work.IncidentId,
                LocationId = source.Work.LocationId,
                RoomId = source.Work.RoomId.Value,
                ContractId = input.ContractId,
                DepositContractId = source.DepositContractId,
                ActualRepairCost = actual,
                Amount = input.Amount,
                Reason = Reason(input.Reason),
                CollectionMethod = input.CollectionMethod,
                Status = input.CollectionMethod == "Invoice" ? "InvoiceIssued" : "DepositPending",
                EvidenceIdsJson = JsonSerializer.Serialize(input.EvidenceIds),
                DecidedById = Actor,
                DecidedAt = Now
            };
            if (input.CollectionMethod == "Invoice")
            {
                if (input.DueDate is not { } due || due < Today || source.Recipients.Length == 0) throw IncidentException.Invalid("compensation_invoice_due_date_required");
                var invoice = new Invoice
                {
                    Type = "AD_HOC",
                    RoomId = row.RoomId,
                    LocationId = row.LocationId,
                    RoomNumber = source.RoomNumber,
                    LocationName = source.LocationName,
                    RepresentativeContractId = input.ContractId,
                    RepresentativeTenantUserId = source.Recipients[0],
                    BillingPeriod = new(Today.Year, Today.Month, 1),
                    Status = InvoiceStatus.Draft,
                    Total = row.Amount,
                    ScheduledFinalDate = Today,
                    DueDate = due,
                    CreatedByUserId = Actor,
                    FinalizedByUserId = Actor,
                    FinalizedAt = Now,
                    ScheduleSnapshot = JsonSerializer.Serialize(new { CompensationId = row.Id, WorkOrderId = id }),
                    Recipients = source.Recipients.Select(r => new InvoiceRecipient { TenantUserId = r }).ToList()
                };
                invoice.Lines.Add(new InvoiceLine
                {
                    InvoiceId = invoice.Id,
                    Category = ChargeCategory.ServiceFee,
                    ChargeCode = "TENANT_DAMAGE",
                    Name = "Bồi thường thiệt hại phòng",
                    RateDate = Today,
                    Rate = row.Amount,
                    Quantity = 1,
                    Amount = row.Amount,
                    CalculatedAmount = row.Amount
                });
                foreach (var recipient in invoice.Recipients) recipient.InvoiceId = invoice.Id;
                repository.Add(invoice); await repository.FlushAsync(t);
                invoice.Status = InvoiceStatus.Final; invoice.Version++;
                await repository.FlushAsync(t);
                repository.Add(new InvoiceIssuedEvent { InvoiceId = invoice.Id, OwnerUserId = Actor, OccurredAt = Now });
                row.InvoiceId = invoice.Id;
            }
            repository.Add(row); return row;
        }, t);

    public Task<CompensationView> DecideAsync(Guid id, string operation, CompensationDecision input, Guid key, CancellationToken t) =>
        Command(id, key, operation, input, async () =>
        {
            var row = await repository.FindAsync(id, t) ?? throw IncidentException.Missing();
            if (input.Version != row.Version) throw IncidentException.Conflict("stale_version");
            if (row.Status != "DepositPending" || row.InvoiceId is not null)
                throw IncidentException.Conflict("compensation_collected_or_invoice_adjustment_required");
            var reason = Reason(input.Reason);
            if (operation == "deduct")
            {
                var ids = JsonSerializer.Deserialize<Guid[]>(row.EvidenceIdsJson)!;
                var images = await repository.EvidenceAsync(id, t);
                foreach (var evidenceId in ids)
                    await VerifyEvidenceAsync(images.SingleOrDefault(e => e.Id == evidenceId) ?? throw IncidentException.Missing(), t);
                var source = await repository.SourceAsync(id, row.ContractId, t);
                if (!source.MoveOutReady) throw IncidentException.Conflict("compensation_move_out_required");
                if (source.AvailableDeposit < row.Amount) throw IncidentException.Conflict("compensation_deposit_insufficient");
                row.Status = "Deducted"; row.DeductedAt = Now;
            }
            else if (operation == "cancel") row.Status = "Cancelled";
            else throw IncidentException.Invalid("invalid_compensation_decision");
            row.Reason = reason; row.DecidedById = Actor; row.DecidedAt = Now; row.Version++;
            return row;
        }, t);

    private static CompensationView View(MaintenanceCompensation row) => new(row.Id, row.WorkOrderId, row.ContractId,
        row.CollectionMethod, row.Status, row.ActualRepairCost, row.Amount, row.Reason, row.InvoiceId,
        row.DecidedById, row.DecidedAt, row.DeductedAt, row.Version);
    private async Task VerifyEvidenceAsync(IncidentEvidence image, CancellationToken t)
    {
        using var content = new MemoryStream();
        await files.CopyAsync(image.ObjectKey, content, t);
        if (content.Length != image.Length || Convert.ToHexString(SHA256.HashData(content.GetBuffer().AsSpan(0, (int)content.Length))) != image.Sha256)
            throw IncidentException.Conflict("compensation_evidence_changed");
    }
}
