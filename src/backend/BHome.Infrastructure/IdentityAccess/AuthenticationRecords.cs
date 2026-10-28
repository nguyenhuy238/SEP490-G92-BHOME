using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.IdentityAccess;

public sealed class AuthenticationSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string SecurityStamp { get; set; } = "";
    public string? Device { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastActivityAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevocationReason { get; set; }
}

public sealed class RefreshTokenRecord
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public Guid? ReplacedByTokenId { get; set; }
}

public sealed class PasswordResetGrant
{
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
}

public sealed class SecurityAuditRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public Guid? TargetUserId { get; set; }
    public Guid? SessionId { get; set; }
    public string Event { get; set; } = "";
    public bool Succeeded { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

internal sealed class AuthenticationSessionConfiguration : IEntityTypeConfiguration<AuthenticationSession>
{
    public void Configure(EntityTypeBuilder<AuthenticationSession> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.SecurityStamp).HasMaxLength(256).IsRequired();
        builder.Property(x => x.Device).HasMaxLength(256);
        builder.Property(x => x.RevocationReason).HasMaxLength(50);
        builder.HasIndex(x => new { x.UserId, x.RevokedAt });
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshTokenRecord>
{
    public void Configure(EntityTypeBuilder<RefreshTokenRecord> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(x => x.TokenHash).IsUnique();
        builder.HasOne<AuthenticationSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RefreshTokenRecord>().WithMany().HasForeignKey(x => x.ReplacedByTokenId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class PasswordResetGrantConfiguration : IEntityTypeConfiguration<PasswordResetGrant>
{
    public void Configure(EntityTypeBuilder<PasswordResetGrant> builder)
    {
        builder.HasKey(x => x.UserId);
        builder.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(x => x.TokenHash).IsUnique();
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class SecurityAuditConfiguration : IEntityTypeConfiguration<SecurityAuditRecord>
{
    public void Configure(EntityTypeBuilder<SecurityAuditRecord> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Event).HasMaxLength(50).IsRequired();
        builder.HasIndex(x => new { x.UserId, x.OccurredAt });
        // No cascading FK: retain security history independently of account lifecycle.
    }
}
