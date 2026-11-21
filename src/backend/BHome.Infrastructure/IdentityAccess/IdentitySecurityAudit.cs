using BHome.Application.IdentityAccess;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class IdentitySecurityAudit(IIdentityPersistence db, IdentitySecurityStore security) : ISecurityAudit
{
    public async Task LoginFailedAsync(CancellationToken cancellationToken)
    {
        security.Audit("LoginFailed", false);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task ForbiddenAsync(Guid? userId, Guid? sessionId, CancellationToken cancellationToken)
    {
        security.Audit("Forbidden", false, userId, sessionId);
        await db.SaveChangesAsync(cancellationToken);
    }
}
