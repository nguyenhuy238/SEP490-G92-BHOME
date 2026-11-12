namespace BHome.Application.IdentityAccess;

public interface IEmailVerification
{
    Task RequestAsync(string userName, CancellationToken cancellationToken);
    Task<bool> ConfirmAsync(string userName, string token, CancellationToken cancellationToken);
}
