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

    [HttpGet]
    public Task<ContractPage> List(CancellationToken t, [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] Guid? locationId = null, [FromQuery] string? status = null)
        => service.ListAsync(page, pageSize, locationId, status, t);

    [HttpGet("configuration")]
    public Task<ContractWorkflowConfiguration> Configuration(CancellationToken t) => service.ConfigurationAsync(t);
    [HttpGet("preparation"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<ContractPreparation> Preparation([FromQuery] Guid? locationId, CancellationToken t) => service.PreparationAsync(locationId, t);
    [HttpGet("preparation/accounts"), Authorize(Roles = Roles.Owner)]
    public Task<IReadOnlyList<ContractChoice>> TenantAccounts(CancellationToken t) => service.TenantAccountsAsync(t);
    [HttpPost("preparation/residents/{residentId:guid}/account"), Authorize(Roles = Roles.Owner)]
    public async Task<IActionResult> LinkTenant(Guid residentId, TenantAccountLink input, CancellationToken t)
    { await service.LinkTenantAccountAsync(residentId, input, t); return NoContent(); }
    [HttpGet("{id:guid}/history")]
    public Task<IReadOnlyList<ContractHistoryView>> History(Guid id, CancellationToken t) => service.HistoryAsync(id, t);
    [HttpGet("{id:guid}/versions")]
    public Task<IReadOnlyList<ContractVersionView>> Versions(Guid id,CancellationToken t)=>service.VersionsAsync(id,t);
    [HttpGet("move-out-assignments"),Authorize(Roles=Roles.Staff)]
    public Task<IReadOnlyList<MoveOutAssignment>> Assignments(CancellationToken t)=>service.AssignmentsAsync(t);
    [HttpGet("{id:guid}/move-out/history")]
    public Task<IReadOnlyList<MoveOutHistoryView>> MoveHistory(Guid id,CancellationToken t)=>service.MoveOutHistoryAsync(id,t);
    [HttpGet("{id:guid}/move-out/inspection-preparation"),Authorize(Roles=Roles.Owner+","+Roles.Staff)]
    public Task<InspectionPreparation> InspectionPreparation(Guid id,CancellationToken t)=>service.InspectionPreparationAsync(id,t);
    [HttpGet("{id:guid}/move-out/inspections")]
    public Task<IReadOnlyList<FinalInspectionView>> Inspections(Guid id,CancellationToken t)=>service.FinalInspectionsAsync(id,t);
    [HttpPost("{id:guid}/move-out/inspection-review"),Authorize(Roles=Roles.Owner)]
    public Task<MoveOutView> InspectionReview(Guid id,InspectionReviewInput x,CancellationToken t)=>service.ReviewInspectionAsync(id,x,Key(),t);
    [HttpGet("{id:guid}/move-out/settlement-summary"),Authorize(Roles=Roles.Owner+","+Roles.Tenant)]
    public Task<ContractSettlementSummary> SettlementSummary(Guid id,CancellationToken t)=>service.SettlementSummaryAsync(id,t);
    [HttpGet("{id:guid}/deposit-verifications"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<IReadOnlyList<DepositVerificationView>> Deposits(Guid id, CancellationToken t) => service.DepositsAsync(id, t);
    [HttpGet("{id:guid}/previews"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<IReadOnlyList<ContractDocumentView>> Previews(Guid id, CancellationToken t) => service.PreviewDocumentsAsync(id, t);
    [HttpPost("{id:guid}/previews"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public Task<ContractDocumentView> GeneratePreview(Guid id, CancellationToken t) => service.GeneratePreviewAsync(id, Key(), t);
    [HttpGet("{id:guid}/previews/{fileId:guid}"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
    public async Task<IActionResult> PreviewFile(Guid id, Guid fileId, CancellationToken t)
    { var buffer = new MemoryStream(); await service.CopyPreviewAsync(id, fileId, buffer, t); buffer.Position = 0; return File(buffer, "application/pdf", "ban-xem-truoc.pdf"); }

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
    [HttpGet("{id:guid}/handover")]
    public Task<HandoverView> Handover(Guid id, CancellationToken t) => service.GetHandoverAsync(id, t);
    [HttpGet("{id:guid}/handover/history")]
    public Task<IReadOnlyList<HandoverHistoryView>> HandoverHistory(Guid id, CancellationToken t) => service.HandoverHistoryAsync(id, t);
    [HttpGet("{id:guid}/handover/choices"), Authorize(Roles = Roles.Staff)]
    public Task<HandoverChoices> HandoverChoices(Guid id, CancellationToken t) => service.HandoverChoicesAsync(id, t);
    [HttpPost("{id:guid}/handover"), Authorize(Roles = Roles.Staff)]
    public Task<HandoverView> SaveHandover(Guid id, HandoverInput x, CancellationToken t) => service.SaveHandoverAsync(id, x, Key(), t);
    [HttpPost("{id:guid}/handover/tenant-confirmation"), Authorize(Roles = Roles.Tenant)]
    public Task<HandoverView> TenantHandover(Guid id, HandoverDecision x, CancellationToken t) => service.DecideHandoverAsync(id, x, Key(), false, false, t);
    [HttpPost("{id:guid}/handover/disputes"), Authorize(Roles = Roles.Tenant)]
    public Task<HandoverView> DisputeHandover(Guid id, HandoverDecision x, CancellationToken t) => service.DecideHandoverAsync(id, x, Key(), true, false, t);
    [HttpPost("{id:guid}/handover/staff-confirmation"), Authorize(Roles = Roles.Staff)]
    public Task<HandoverView> StaffHandover(Guid id, HandoverDecision x, CancellationToken t) => service.DecideHandoverAsync(id, x, Key(), false, true, t);
    [HttpPost("{id:guid}/handover/evidence"), Authorize(Roles = Roles.Staff), Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public Task<ContractId> UploadHandover(Guid id, CancellationToken t) => service.UploadHandoverEvidenceAsync(id, Request.Body, t);
    [HttpGet("{id:guid}/handover/evidence/{fileId:guid}")]
    public async Task<IActionResult> HandoverFile(Guid id, Guid fileId, CancellationToken t)
    { var buffer = new MemoryStream(); await service.CopyHandoverEvidenceAsync(id, fileId, buffer, t); buffer.Position = 0; return File(buffer, "application/octet-stream", "bang-chung-ban-giao"); }
    [HttpGet("{id:guid}/handover/meter-evidence/{readingId:guid}")]
    public async Task<IActionResult> HandoverMeterFile(Guid id, Guid readingId, CancellationToken t)
    { var buffer = new MemoryStream(); await service.CopyHandoverMeterEvidenceAsync(id, readingId, buffer, t); buffer.Position = 0; return File(buffer, "application/octet-stream", "chi-so-ban-giao"); }
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
