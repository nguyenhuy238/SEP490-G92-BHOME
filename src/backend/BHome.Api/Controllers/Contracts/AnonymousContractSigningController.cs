using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers;

[ApiController, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(262144)]
public sealed class AnonymousContractSigningController(AnonymousContractSigningService service) : ControllerBase
{
    [HttpGet("api/v1/contracts/{id:guid}/internal-signing"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<InternalSigningStatus> Status(Guid id, CancellationToken t) => service.StatusAsync(id, t);
    [HttpPost("api/v1/contracts/{id:guid}/internal-signing/tenant-simulation"), Authorize(Roles = Roles.Staff)]
    public Task<InternalSigningStatus> SimulateTenant(Guid id, CancellationToken t) => service.SimulateMainTenantAsync(id, t);
    [HttpPost("api/v1/contracts/{id:guid}/internal-signing/owner-simulation"), Authorize(Roles = Roles.Staff)]
    public Task<InternalSigningStatus> SimulateOwner(Guid id, InternalOwnerAcceptance input, CancellationToken t) => service.SimulateMainOwnerAsync(id, input, t);
    [HttpPost("api/v1/contracts/{id:guid}/signing-invitations"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public Task<SigningInvitationResult> Invite(Guid id, SigningInvitationInput input, CancellationToken t) => service.InviteAsync(id, input, t);
    [HttpDelete("api/v1/contracts/{id:guid}/signing-invitations/{invitationId:guid}"), Authorize(Roles = Roles.Owner)]
    public async Task<IActionResult> Revoke(Guid id, Guid invitationId, CancellationToken t)
    { await service.RevokeAsync(id, invitationId, t); return NoContent(); }
    [HttpPost("api/v1/contracts/{id:guid}/internal-signing/owner-confirmation"), Authorize(Roles = Roles.Owner)]
    public async Task<IActionResult> Confirm(Guid id, InternalOwnerAcceptance input, CancellationToken t)
    { await service.ConfirmOwnerAsync(id, input, t); return NoContent(); }
    [HttpPost("api/v1/contract-signing/info"), AllowAnonymous, EnableRateLimiting("SigningRead")]
    public Task<AnonymousSigningInfo> Info(AnonymousSigningToken input, CancellationToken t) => service.InfoAsync(input.Token, t);
    [HttpPost("api/v1/contract-signing/otp"), AllowAnonymous, EnableRateLimiting("SigningOtp")]
    public async Task<IActionResult> Otp(AnonymousSigningToken input, CancellationToken t)
    { await service.RequestOtpAsync(input.Token, t); return NoContent(); }
    [HttpPost("api/v1/contract-signing/verify"), AllowAnonymous, EnableRateLimiting("SigningVerify")]
    public Task<AnonymousSigningAccess> Verify(AnonymousOtpInput input, CancellationToken t) => service.VerifyOtpAsync(input, t);
    [HttpPost("api/v1/contract-signing/document"), AllowAnonymous, EnableRateLimiting("SigningRead")]
    public async Task<IActionResult> Document(AnonymousSigningSession input, CancellationToken t)
    {
        var (bytes, name) = await service.DownloadDocumentAsync(input, t);
        return File(bytes, "application/pdf", name);
    }
    [HttpPost("api/v1/contract-signing/accept"), AllowAnonymous, EnableRateLimiting("SigningVerify")]
    public async Task<IActionResult> Accept(AnonymousAcceptanceInput input, CancellationToken t)
    { await service.AcceptAsync(input, t); return NoContent(); }
    [HttpPost("api/v1/contract-signing/document/layout"), AllowAnonymous, EnableRateLimiting("SigningRead")]
    public Task<SigningLayoutInfo> Layout(AnonymousSigningSession input, CancellationToken t) => service.LayoutAsync(input, t);
    [HttpPost("api/v1/contract-signing/document/pages/{page:int}"), AllowAnonymous, EnableRateLimiting("SigningRead")]
    public async Task<IActionResult> Page(AnonymousSigningSession input, int page, CancellationToken t) =>
        File(await service.PageAsync(input, page, t), "image/png");
}
