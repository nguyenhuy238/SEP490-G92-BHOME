using System.ComponentModel.DataAnnotations;

namespace BHome.Application.IdentityAccess;

public sealed record TenantInvitationRequest([Required, EmailAddress, StringLength(256)] string Email);
public sealed record TenantInvitationResult(Guid UserId, string DeliveryState);
public sealed record AcceptInvitationRequest([Required, StringLength(256)] string UserName,
    [Required, StringLength(4096)] string Token, [Required, StringLength(1024, MinimumLength = 12)] string NewPassword);
public interface IAccountInvitations
{
    Task<TenantInvitationResult> InviteAsync(Guid residentId, TenantInvitationRequest request, CancellationToken t);
    Task<TenantInvitationResult> InviteStaffAsync(Guid userId, CancellationToken t);
    Task<bool> AcceptAsync(AcceptInvitationRequest request, CancellationToken t);
}
