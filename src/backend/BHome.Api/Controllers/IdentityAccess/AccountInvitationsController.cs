using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers.IdentityAccess;

[ApiController, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(16384), EnableRateLimiting("Auth")]
public sealed class AccountInvitationsController(IAccountInvitations invitations) : ControllerBase
{
    [HttpPost("api/v1/residents/{id:guid}/invitation"), Authorize(Roles = Roles.Owner)]
    public Task<TenantInvitationResult> Invite(Guid id, TenantInvitationRequest input, CancellationToken t) => invitations.InviteAsync(id, input, t);
    [HttpPost("api/v1/staff/{id:guid}/invitation"), Authorize(Roles = Roles.Owner)]
    public Task<TenantInvitationResult> InviteStaff(Guid id, CancellationToken t) => invitations.InviteStaffAsync(id, t);
    [HttpPost("api/v1/auth/accept-invitation"), AllowAnonymous]
    public async Task<IActionResult> Accept(AcceptInvitationRequest input, CancellationToken t) => await invitations.AcceptAsync(input, t)
        ? NoContent() : Problem(statusCode: 400, title: "Lời mời không khả dụng.");
}
