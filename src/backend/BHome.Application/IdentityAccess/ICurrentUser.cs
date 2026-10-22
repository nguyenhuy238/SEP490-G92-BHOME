namespace BHome.Application.IdentityAccess;

public interface ICurrentUser
{
    Guid? UserId { get; }
    bool IsInRole(string role);
}
