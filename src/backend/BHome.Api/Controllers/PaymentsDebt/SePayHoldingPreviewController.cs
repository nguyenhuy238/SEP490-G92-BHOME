using System.Text.RegularExpressions;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace BHome.Api.Controllers.PaymentsDebt;

// Explicit fixture simulation in an isolated SePay Test database. Never legal signing evidence.
[ApiController, Route("api/v1/integrations/sepay/testing/holdings/{id:guid}")]
[Authorize(Roles = Roles.Owner + "," + Roles.Staff), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SePayHoldingPreviewController(IPaymentRepository repository, ITransferQrGenerator qr, SePayOptions options,
    IConfiguration configuration, IHostEnvironment environment, TimeProvider clock,
    ContractService contracts, IContractRepository contractRepository, ICurrentUser actor, IPaymentCodeRegistry codes) : ControllerBase
{
    private bool Available()
    {
        if (!options.TestingAvailable(environment.EnvironmentName) || !options.Valid(environment.EnvironmentName)) return false;
        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
        var pattern = environment.IsEnvironment("Testing") ? "^bhome_compact24_(?:dev_)?[a-f0-9]{32}$" : "^bhome_compact24_dev_[a-f0-9]{32}$";
        return target.Host is "localhost" or "127.0.0.1" or "::1" && Regex.IsMatch(target.Database ?? "", pattern);
    }
    private async Task<Contract> Scoped(Guid id, CancellationToken token)
    {
        if (!Available()) throw new PaymentException(404, "sandbox_unavailable");
        await contracts.GetAsync(id, token); // Existing role/location authorization, including Staff assignment.
        var c = await contractRepository.FindAsync(id, token);
        if (c is null || c.Kind != ContractKind.Holding || !c.IsDevelopmentDemo) throw new PaymentException(404, "contract_not_found");
        return c;
    }
    private static SandboxSignatures Read(Contract c)
    {
        try
        {
            var stored = JsonSerializer.Deserialize<SandboxSignatures>(c.DraftMetadata);
            if (stored?.SandboxOnly == true && stored.SnapshotHash == c.SnapshotHash) return stored;
        }
        catch (JsonException) { }
        return new(true, c.SnapshotHash, null, null);
    }
    private async Task<HoldingSandboxState> State(Contract c, CancellationToken token)
    {
        var signs = Read(c);
        var verified = await contractRepository.DepositTotalAsync(c.Id, token);
        return new("Test", c.Id, signs.OwnerAt is not null, signs.TenantAt is not null,
            signs.OwnerAt is not null && signs.TenantAt is not null, c.RequiredDeposit > 0 && verified == c.RequiredDeposit,
            c.RequiredDeposit.ToString("0", System.Globalization.CultureInfo.InvariantCulture), verified.ToString("0", System.Globalization.CultureInfo.InvariantCulture),
            c.Status == ContractStatus.Active && c.Room.Status == RoomStatus.OnHold, c.Status.ToString());
    }
    [HttpGet("simulation")]
    public async Task<ActionResult<HoldingSandboxState>> Simulation(Guid id, CancellationToken token)
    {
        if (!Available()) return NotFound();
        return await State(await Scoped(id, token), token);
    }
    [HttpPost("simulation/signatures")]
    public async Task<HoldingSandboxState> Simulate(Guid id, SandboxSignatureInput input, CancellationToken token)
    {
        var before = await Scoped(id, token);
        if (!input.SimulationOnly || input.Participant is not ("Owner" or "Tenant")) throw new PaymentException(400, "sandbox_simulation_input_required");
        return await contractRepository.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await Scoped(id, token);
            if (c.ApprovedAt is null || c.HoldingExpiryAt <= clock.GetUtcNow() || c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning))
                throw new PaymentException(409, "sandbox_holding_not_ready");
            var signs = Read(c); var now = clock.GetUtcNow();
            var changed = input.Participant == "Owner" ? signs.OwnerAt is null : signs.TenantAt is null;
            signs = input.Participant == "Owner" ? signs with { OwnerAt = signs.OwnerAt ?? now } : signs with { TenantAt = signs.TenantAt ?? now };
            c.DraftMetadata = JsonSerializer.Serialize(signs);
            if (changed) contractRepository.Audit(actor.UserId!.Value, "Sandbox" + input.Participant + "SigningSimulated", id, now);
            // Deliberately not ContractSignature or InternalAcceptance: no real signing evidence is created.
            return await State(c, token);
        }, token);
    }
    [HttpPost("simulation/activate")]
    public async Task<HoldingSandboxState> ActivateSimulation(Guid id, CancellationToken token)
    {
        var before = await Scoped(id, token);
        return await contractRepository.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await Scoped(id, token); var state = await State(c, token);
            if (state.OnHold) return state;
            if (!state.CanShowQr || !state.DepositVerified || c.ApprovedAt is null || c.HoldingExpiryAt <= clock.GetUtcNow() ||
                c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation) ||
                !c.Room.Location.IsActive || c.Room.RoomType is { IsActive: false } ||
                !PropertyRules.CanChangeRoomStatus(c.Room.Status, RoomStatus.OnHold, RoomTransitionSource.HoldingActivation) ||
                await contractRepository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, token))
                throw new PaymentException(409, "sandbox_verified_deposit_and_simulation_required");
            var now = clock.GetUtcNow(); var room = c.Room;
            var previous = JsonSerializer.Serialize(new { room.Status, room.Version });
            room.Status = RoomStatus.OnHold; room.Version++;
            c.Status = ContractStatus.Active; c.ActivatedAt = now; c.ActivatedByUserId = actor.UserId!.Value;
            contractRepository.Add(new PropertyChange { ActorId = actor.UserId.Value, LocationId = room.LocationId,
                TargetId = room.Id, TargetType = nameof(Room), Action = "SandboxHoldingActivated", Reason = "TEST ONLY: simulated signing and verified deposit",
                Before = previous, After = JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = id }), OccurredAt = now });
            contractRepository.Audit(actor.UserId.Value, "SandboxHoldingActivatedWithoutLegalSignatures", id, now);
            return await State(c, token);
        }, token);
    }
    [HttpGet("transfer-instructions")]
    public async Task<IActionResult> Get(Guid id, CancellationToken token)
    {
        if (!Available()) return NotFound();
        var contract = await Scoped(id, token);
        if (contract.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation) ||
            contract.HoldingExpiryAt is null || contract.HoldingExpiryAt <= clock.GetUtcNow())
            throw new PaymentException(409, "holding_not_payable");
        if (actor.IsInRole(Roles.Staff) && !(await State(contract, token)).CanShowQr)
            throw new PaymentException(409, "sandbox_simulated_signatures_required");
        var binding = options.ReceivingAccounts.SingleOrDefault(x => x.LocationId == contract.Room.LocationId);
        var account = await repository.ReceivingAccountAsync(contract.Room.LocationId, token);
        if (binding is null || account is null || !account.Enabled || !account.IsDevelopmentDemo ||
            account.BankIdentifier != binding.BankIdentifier || account.AccountNumber != binding.AccountNumber)
            throw new PaymentException(409, "sandbox_receiving_account_unavailable");
        var received = await contractRepository.DepositTotalAsync(id, token);
        var code = await codes.IssueAsync("Deposit", id, contract.Room.LocationId, token);
        var position = new { TransferReference = code ?? "", Remaining = Math.Max(0, contract.RequiredDeposit - received).ToString("0", System.Globalization.CultureInfo.InvariantCulture) };
        if (!Regex.IsMatch(position.TransferReference, "^BH[0-9]{8}$"))
            throw new PaymentException(409, "sandbox_payment_code_required");
        var remaining = decimal.Parse(position.Remaining, System.Globalization.CultureInfo.InvariantCulture);
        var rendered = remaining > 0 ? qr.Generate(account.BankIdentifier, account.AccountNumber, remaining, position.TransferReference) : null;
        return Ok(new HoldingTestTransferInstructions(contract.Id, contract.Room.LocationId, "Test", contract.Status.ToString(),
            true, remaining <= 0 ? "Settled" : rendered is null ? "InstructionsOnly" : "Available",
            account.BankIdentifier, account.AccountNumber, account.AccountHolder, position.Remaining,
            position.TransferReference, rendered?.Payload, rendered?.PngDataUri));
    }
}

public sealed record HoldingTestTransferInstructions(Guid ContractId, Guid LocationId, string Mode, string ContractStatus,
    bool SignatureRequiredForActivation, string Availability, string BankIdentifier, string AccountNumber, string AccountHolder,
    string OutstandingAmount, string TransferReference, string? QrPayload, string? QrImageDataUri);

public sealed record SandboxSignatureInput(string Participant, bool SimulationOnly);
public sealed record SandboxSignatures(bool SandboxOnly, string SnapshotHash, DateTimeOffset? OwnerAt, DateTimeOffset? TenantAt);
public sealed record HoldingSandboxState(string Mode, Guid ContractId, bool OwnerSimulated, bool TenantSimulated,
    bool CanShowQr, bool DepositVerified, string Required, string Verified, bool OnHold, string ContractStatus);
