using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Storage;

namespace BHome.Infrastructure.IdentityAccess;

// Persistence seam for the existing session/password algorithms. No role or credential policy here.
internal interface IIdentityPersistence
{
    Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken token);
    Task<int> SaveChangesAsync(CancellationToken token);
    Task<ApplicationUser?> LockUserAsync(Guid userId, CancellationToken token);
    Task<string[]> RolesAsync(Guid userId, CancellationToken token);
    void Audit(SecurityAuditRecord record);
    Task RevokeAllAsync(Guid userId, string reason, DateTimeOffset now, CancellationToken token);
    Task<Guid?> TokenOwnerAsync(string hash, CancellationToken token);
    Task<RefreshTokenRecord> TokenAsync(string hash, CancellationToken token);
    Task<AuthenticationSession?> SessionAsync(Guid id, Guid? userId, CancellationToken token);
    void AddSession(AuthenticationSession session);
    void AddToken(RefreshTokenRecord refresh);
    Guid IssuedTokenId(string hash);
    Task<bool> ValidSessionAsync(SessionIdentity identity, string stamp, DateTimeOffset now, CancellationToken token);
    Task<int> TouchSessionAsync(Guid id, DateTimeOffset now, CancellationToken token);
    Task<bool> CurrentSessionAsync(Guid userId, Guid sessionId, string? stamp, DateTimeOffset now, CancellationToken token);
    Task<PasswordResetGrant?> ResetGrantAsync(Guid userId, CancellationToken token);
    void AddResetGrant(PasswordResetGrant grant);
    Task ConsumeResetGrantsAsync(Guid userId, DateTimeOffset now, CancellationToken token);
}
