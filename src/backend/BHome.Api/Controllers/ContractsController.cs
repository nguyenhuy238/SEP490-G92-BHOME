using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/contracts"), Authorize(Roles = Roles.Owner + "," + Roles.Staff + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(65536)]
public sealed class ContractsController(ContractService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty
        ? key : throw ContractException.Invalid("idempotency_key_required");

    [HttpPost, Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public async Task<IActionResult> Create(ContractDraftInput x, CancellationToken t)
    { var result = await service.CreateAsync(x, Key(), t); return CreatedAtAction(nameof(Get), new { id = result.Id }, result); }
    [HttpGet("{id:guid}")]
    public Task<ContractView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpGet("{id:guid}/activation-readiness"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<ActivationReadiness> Readiness(Guid id, CancellationToken t) => service.ReadinessAsync(id, t);
    [HttpPost("{id:guid}/activate"), Authorize(Roles = Roles.Owner)]
    public Task<ContractView> Activate(Guid id, CancellationToken t) => service.ActivateAsync(id, Key(), t);
    [HttpPost("{id:guid}/deposit-verifications"), Authorize(Roles = Roles.Owner)]
    public Task<ContractId> Deposit(Guid id, DepositInput x, CancellationToken t) => service.VerifyDepositAsync(id, x, Key(), t);
    [HttpPost("{id:guid}/signing"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<SignatureView> Sign(Guid id, SigningInput x, CancellationToken t) => service.RequestSigningAsync(id, x, Key(), t);
    [HttpPost("{id:guid}/signing/sync"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<ContractView> Sync(Guid id, CancellationToken t) => service.SyncSigningAsync(id, t);
    [HttpPost("{id:guid}/signing/recover"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<ContractView> Recover(Guid id, SigningRecoveryInput x, CancellationToken t) => service.RecoverSigningAsync(id, x, Key(), t);
    [HttpGet("{id:guid}/document"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public async Task<IActionResult> Document(Guid id, CancellationToken t)
    { var buffer = new MemoryStream(); await service.CopyDocumentAsync(id, buffer, t); buffer.Position = 0; return File(buffer, "application/pdf", "hop-dong.pdf"); }
    [HttpPost("{id:guid}/renewals"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public async Task<IActionResult> Renewal(Guid id, RenewalInput x, CancellationToken t)
    { var result = await service.RenewAsync(id, x, Key(), t); return CreatedAtAction(nameof(Get), new { id = result.Id }, result); }
    [HttpPost("{id:guid}/renewal-cancellation"), Authorize(Roles = Roles.Owner)]
    public Task<ContractView> CancelRenewal(Guid id, CancellationToken t) => service.CancelRenewalAsync(id, Key(), t);
    [HttpPost("{id:guid}/termination-requests"), Authorize(Roles = Roles.Tenant)]
    public Task<MoveOutView> Termination(Guid id, TerminationInput x, CancellationToken t) => service.RequestTerminationAsync(id, x, Key(), false, t);
    [HttpPost("{id:guid}/expiry-move-out"), Authorize(Roles = Roles.Owner)]
    public Task<MoveOutView> Expiry(Guid id, TerminationInput x, CancellationToken t) => service.RequestTerminationAsync(id, x, Key(), true, t);
    [HttpGet("{id:guid}/move-out")]
    public Task<MoveOutView> MoveOut(Guid id, CancellationToken t) => service.GetMoveOutAsync(id, t);
    [HttpPost("{id:guid}/move-out/approve"), Authorize(Roles = Roles.Owner)]
    public Task<MoveOutView> Approve(Guid id, CancellationToken t) => service.ApproveTerminationAsync(id, Key(), t);
    [HttpPost("{id:guid}/move-out/schedule"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<MoveOutView> Schedule(Guid id, InspectionScheduleInput x, CancellationToken t) => service.ScheduleInspectionAsync(id, x, Key(), t);
    [HttpPost("{id:guid}/move-out/inspection"), Authorize(Roles = Roles.Staff)]
    public Task<MoveOutView> Inspect(Guid id, InspectionInput x, CancellationToken t) => service.InspectAsync(id, x, Key(), t);
    [HttpPost("{id:guid}/move-out/evidence"), Authorize(Roles = Roles.Staff), Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public Task<ContractId> UploadEvidence(Guid id, CancellationToken t) => service.UploadInspectionEvidenceAsync(id, Request.Body, t);
    [HttpGet("{id:guid}/move-out/evidence/{evidenceId:guid}")]
    public async Task<IActionResult> Evidence(Guid id, Guid evidenceId, CancellationToken t)
    { var buffer = new MemoryStream(); await service.CopyInspectionEvidenceAsync(id, evidenceId, buffer, t); buffer.Position = 0; return File(buffer, "application/octet-stream", "bang-chung-kiem-tra"); }
    [HttpPost("{id:guid}/move-out/settlement"), Authorize(Roles = Roles.Owner)]
    public Task<MoveOutView> Settle(Guid id, SettlementInput x, CancellationToken t) => service.SettleAsync(id, x, Key(), t);
    [HttpGet("{id:guid}/move-out/settlement-history"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<IReadOnlyList<SettlementReviewView>> SettlementHistory(Guid id, CancellationToken t) => service.SettlementHistoryAsync(id, t);
    [HttpPost("{id:guid}/move-out/complete"), Authorize(Roles = Roles.Owner)]
    public Task<ContractView> Complete(Guid id, CompletionInput x, CancellationToken t) => service.CompleteAsync(id, x, Key(), t);
}
