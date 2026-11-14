using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/contracts/{id:guid}/move-out/receivables"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class SettlementReceivablesController(SettlementReceivablesService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty;
    [HttpGet] public Task<SettlementReceivablesView> Get(Guid id, CancellationToken token) => service.GetAsync(id, token);
    [HttpGet("charge-review"), Authorize(Roles = Roles.Owner)]
    public Task<SettlementChargeReviewPreview> Review(Guid id, CancellationToken token) => service.PreviewChargeReviewAsync(id, token);
    [HttpPost("charge-review"), Authorize(Roles = Roles.Owner)]
    public Task<SettlementChargeReview> ApproveReview(Guid id, SettlementChargeReviewInput input, CancellationToken token) => service.ApproveChargeReviewAsync(id, input, Key(), token);
    [HttpGet("final-fixed-charges"), Authorize(Roles = Roles.Owner)]
    public Task<IReadOnlyList<FinalFixedChargePreview>> FinalFixed(Guid id, CancellationToken token) => service.PreviewFinalFixedAsync(id, token);
    [HttpPost("final-fixed-charges"), Authorize(Roles = Roles.Owner)]
    public Task<SettlementReceivable> ApproveFinalFixed(Guid id, FinalFixedChargeApproval input, CancellationToken token) => service.ApproveFinalFixedAsync(id, input, Key(), token);
    [HttpGet("final-utilities"), Authorize(Roles = Roles.Owner)]
    public Task<IReadOnlyList<FinalUtilityPreview>> FinalUtilities(Guid id, CancellationToken token) => service.PreviewFinalUtilitiesAsync(id, token);
    [HttpPost("final-utilities"), Authorize(Roles = Roles.Owner)]
    public Task<SettlementReceivable> ApproveFinalUtility(Guid id, FinalUtilityApprovalInput input, CancellationToken token) => service.ApproveFinalUtilityAsync(id, input, Key(), token);
    [HttpPost("damage"), Authorize(Roles = Roles.Owner)]
    public Task<SettlementReceivable> Damage(Guid id, DamageChargeInput input, CancellationToken token) => service.ApproveDamageAsync(id, input, Key(), token);
    [HttpPost("deposit-offsets"), Authorize(Roles = Roles.Owner)]
    public Task<DepositOffsetApproval> Offset(Guid id, DepositOffsetInput input, CancellationToken token) => service.ApproveOffsetAsync(id, input, Key(), token);
    [HttpPost("{chargeId:guid}/bank-allocations"), Authorize(Roles = Roles.Owner)]
    public Task<SettlementBankAllocationResult> Allocate(Guid id, Guid chargeId, SettlementBankAllocationInput input, CancellationToken token) => service.AllocateBankAsync(id, chargeId, input, Key(), token);
    [HttpGet("{chargeId:guid}/transfer-instructions")]
    public Task<SettlementTransferInstructions> Instructions(Guid id, Guid chargeId, CancellationToken token) => service.TransferInstructionsAsync(id, chargeId, token);
}

[ApiController, Route("api/v1/tenant/settlement-receivables"), Authorize(Roles = Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TenantSettlementReceivablesController(SettlementReceivablesService service) : ControllerBase
{
    [HttpGet] public Task<SettlementReceivablePage> Get(CancellationToken token, [FromQuery] int page = 1, [FromQuery] int pageSize = 20) => service.TenantListAsync(page, pageSize, token);
}
