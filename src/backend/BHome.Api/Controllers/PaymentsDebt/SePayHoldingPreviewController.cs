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
    ContractService contracts, IContractRepository contractRepository, ICurrentUser actor, IPaymentCodeRegistry codes,
    IHoldingTestScope? testScope = null) : ControllerBase
{
    private bool Available()
    {
        if (environment.EnvironmentName is not ("Development" or "Testing" or "Staging") || !options.TestingAvailable(environment.EnvironmentName) || !options.Valid(environment.EnvironmentName)) return false;
        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
        var pattern = environment.IsEnvironment("Testing") ? "^bhome_compact24_(?:dev_)?[a-f0-9]{32}$" : "^bhome_compact24_dev_[a-f0-9]{32}$";
        return (target.Host is "localhost" or "127.0.0.1" or "::1" && Regex.IsMatch(target.Database ?? "", pattern)) ||
            testScope?.AllowsExternalDatabase == true;
    }
    private async Task<Contract> Scoped(Guid id, CancellationToken token, bool allowRealQrPreview = false)
    {
        if (!Available()) throw new PaymentException(404, "sandbox_unavailable");
        await contracts.GetAsync(id, token); // Existing role/location authorization, including Staff assignment.
        var c = await contractRepository.FindAsync(id, token);
        if (c is null || c.Kind != ContractKind.Holding || !c.IsDevelopmentDemo && !allowRealQrPreview) throw new PaymentException(404, "contract_not_found");
        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
        if (target.Host is not ("localhost" or "127.0.0.1" or "::1") && testScope?.Allows(c.Room.LocationId) != true &&
            !(allowRealQrPreview && options.Bound(c.Room.LocationId, c.OwnerSignerId)))
            throw new PaymentException(404, "contract_not_found");
        return c;
    }
    private async Task<HoldingSandboxState> State(Contract c, CancellationToken token)
    {
        var previewOnly = PreviewOnly(c);
        var signs = SandboxSignatures.Read(c);
        var evidence = AnonymousContractSigningService.AcceptedEvidence(c);
        var ownerConfirmed = AnonymousContractSigningService.Complete(c) || signs.OwnerConfirmed(c);
        var tenantAccepted = evidence?.SnapshotHash == c.SnapshotHashOrEmpty || signs.TenantAt is not null;
        var verified = await contractRepository.DepositTotalAsync(c.Id, token);
        return new("Test", c.Id, false, signs.TenantAt is not null,
            previewOnly || ownerConfirmed && tenantAccepted, c.RequiredDeposit > 0 && verified == c.RequiredDeposit,
            c.RequiredDeposit.ToString("0", System.Globalization.CultureInfo.InvariantCulture), verified.ToString("0", System.Globalization.CultureInfo.InvariantCulture),
            c.Status == ContractStatus.Active && c.Room.Status == RoomStatus.OnHold, c.Status.ToString());
    }
    private static bool PreviewOnly(Contract c)
    {
        try
        {
            using var json = JsonDocument.Parse(c.DraftMetadata);
            return json.RootElement.TryGetProperty("SandboxQrPreviewOnly", out var value) &&
                value.GetProperty("SnapshotHash").GetString() == c.SnapshotHashOrEmpty &&
                value.GetProperty("RequestedBy").GetGuid() != Guid.Empty;
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException) { return false; }
    }
    [HttpPost("simulation/skip-signing-preview")]
    public async Task<HoldingSandboxState> SkipSigningPreview(Guid id, SandboxPreviewInput input, CancellationToken token)
    {
        if (!input.PreviewOnly) throw new PaymentException(400, "sandbox_simulation_input_required");
        var before = await Scoped(id, token);
        return await contractRepository.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await Scoped(id, token);
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation) || c.HoldingExpiryAt <= clock.GetUtcNow())
                throw new PaymentException(409, "holding_not_payable");
            if (!PreviewOnly(c))
            {
                var data = System.Text.Json.Nodes.JsonNode.Parse(c.DraftMetadata)!.AsObject();
                data["SandboxQrPreviewOnly"] = JsonSerializer.SerializeToNode(new { SnapshotHash = c.SnapshotHashOrEmpty, RequestedBy = actor.UserId, RequestedAt = clock.GetUtcNow() });
                c.DraftMetadata = data.ToJsonString();
                contractRepository.Audit(actor.UserId!.Value, "SandboxHoldingQrPreviewWithoutSigning", id, clock.GetUtcNow());
            }
            return await State(c, token);
        }, token);
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
        if (input.Participant == "Owner") throw new PaymentException(403, "owner_confirmation_required");
        if (!input.SimulationOnly || input.Participant != "Tenant") throw new PaymentException(400, "sandbox_simulation_input_required");
        return await contractRepository.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await Scoped(id, token);
            if (c.HoldingExpiryAt <= clock.GetUtcNow() || c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation))
                throw new PaymentException(409, "sandbox_holding_not_ready");
            if (c.Signatures.Count > 0 || c.InternalAcceptance != "{}")
                throw new PaymentException(409, "sandbox_existing_signing_evidence");
            var signs = SandboxSignatures.Read(c); var now = clock.GetUtcNow();
            var changed = signs.TenantAt is null;
            signs = signs with { TenantAt = signs.TenantAt ?? now };
            c.DraftMetadata = JsonSerializer.Serialize(signs);
            if (signs.OwnerConfirmed(c)) c.Status = ContractStatus.PendingActivation;
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
            if (!state.CanShowQr || !state.DepositVerified || !SandboxSignatures.Read(c).OwnerConfirmed(c) || c.HoldingExpiryAt <= clock.GetUtcNow() ||
                c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation) ||
                !c.Room.Location.IsActive || c.Room.RoomType is { IsActive: false } ||
                !PropertyRules.CanChangeRoomStatus(c.Room.Status, RoomStatus.OnHold, RoomTransitionSource.HoldingActivation) ||
                await contractRepository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, token))
                throw new PaymentException(409, "sandbox_verified_deposit_and_simulation_required");
            var now = clock.GetUtcNow(); var room = c.Room;
            var previous = JsonSerializer.Serialize(new { room.Status, room.Version });
            room.Status = RoomStatus.OnHold; room.Version++;
            c.Status = ContractStatus.Active; c.ActivatedAt = now; c.ActivatedByUserId = actor.UserId!.Value;
            contractRepository.Add(new PropertyChange
            {
                ActorId = actor.UserId.Value,
                LocationId = room.LocationId,
                TargetId = room.Id,
                TargetType = nameof(Room),
                Action = "SandboxHoldingActivated",
                Reason = "TEST ONLY: simulated signing and verified deposit",
                Before = previous,
                After = JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = id }),
                OccurredAt = now
            });
            contractRepository.Audit(actor.UserId.Value, "SandboxHoldingActivatedWithoutLegalSignatures", id, now);
            return await State(c, token);
        }, token);
    }
    [HttpGet("transfer-instructions")]
    public async Task<IActionResult> Get(Guid id, CancellationToken token)
    {
        if (!Available()) return NotFound();
        // QR preview alone may be used on a genuinely signed contract in an explicitly scoped Test location.
        // All simulation/activation endpoints still require a demo contract; Test receipts cannot pay a real contract.
        var contract = await Scoped(id, token, allowRealQrPreview: true);
        if (!contract.IsDevelopmentDemo && !AnonymousContractSigningService.HoldingOwnerHasSigned(contract))
            throw new PaymentException(409, "holding_owner_signature_required");
        if (!contract.IsDevelopmentDemo && (!AnonymousContractSigningService.Complete(contract) &&
            !new[] { contract.OwnerSignerId, contract.TenantUserId }.All(signer => signer is not null &&
                contract.Signatures.Any(s => s.SignerUserId == signer && s.Status == SignatureStatus.Signed && s.SnapshotHash == contract.SnapshotHashOrEmpty))))
            throw new PaymentException(409, "verified_signature_evidence_required");
        if (!contract.IsDevelopmentDemo && !ContractChargeSnapshot.IsIntact(contract)) throw new PaymentException(409, "signed_terms_changed");
        if (contract.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation) ||
            contract.HoldingExpiryAt is null || contract.HoldingExpiryAt <= clock.GetUtcNow())
            throw new PaymentException(409, "holding_not_payable");
        if (contract.IsDevelopmentDemo && actor.IsInRole(Roles.Staff) && !(await State(contract, token)).CanShowQr)
            throw new PaymentException(409, "sandbox_simulated_signatures_required");
        var account = await codes.AccountAsync("Deposit", id, contract.Room.LocationId, token) ?? await repository.ReceivingAccountForModeAsync(contract.Room.LocationId, "Test", token);
        if (account is null || !options.Matches(contract.Room.LocationId, account) ||
            !account.Enabled || !account.IsDevelopmentDemo)
            throw new PaymentException(409, "sandbox_receiving_account_unavailable");
        var received = await contractRepository.DepositTotalAsync(id, token);
        var code = await codes.IssueAsync("Deposit", id, contract.Room.LocationId, token);
        var position = new { TransferReference = code ?? "", Remaining = Math.Max(0, contract.RequiredDeposit - received).ToString("0", System.Globalization.CultureInfo.InvariantCulture) };
        if (!Regex.IsMatch(position.TransferReference, "^BH(?:[0-9]{8}|[A-Z0-9]{4}[TL][A-F0-9]{16})$"))
            throw new PaymentException(409, "sandbox_payment_code_required");
        var remaining = decimal.Parse(position.Remaining, System.Globalization.CultureInfo.InvariantCulture);
        var rendered = remaining > 0 ? qr.Generate(account.BankIdentifier, account.AccountNumber, remaining, position.TransferReference) : null;
        return Ok(new HoldingTestTransferInstructions(contract.Id, contract.Room.LocationId, "Test", contract.Status.ToString(),
            true, remaining <= 0 ? "Settled" : rendered is null ? "InstructionsOnly" : "Available",
            account.BankIdentifier, account.AccountNumber, account.AccountHolder, position.Remaining,
            position.TransferReference, rendered?.Payload, rendered?.PngDataUri, PreviewOnly: !ContractPaymentModes.IsTest(contract)));
    }
}

public sealed record HoldingTestTransferInstructions(Guid ContractId, Guid LocationId, string Mode, string ContractStatus,
    bool SignatureRequiredForActivation, string Availability, string BankIdentifier, string AccountNumber, string AccountHolder,
    string OutstandingAmount, string TransferReference, string? QrPayload, string? QrImageDataUri, bool PreviewOnly = false);

public sealed record SandboxSignatureInput(string Participant, bool SimulationOnly);
public sealed record SandboxPreviewInput(bool PreviewOnly);
public sealed record HoldingSandboxState(string Mode, Guid ContractId, bool OwnerSimulated, bool TenantSimulated,
    bool CanShowQr, bool DepositVerified, string Required, string Verified, bool OnHold, string ContractStatus);
