using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Jobs;

internal sealed class BackgroundJobRecord
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string IdempotencyKey { get; set; } = "";
    public string PayloadJson { get; set; } = "{}";
    public string State { get; set; } = "Pending";
    public int Attempts { get; set; }
    public DateTimeOffset AvailableAt { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public Guid? LockToken { get; set; }
    public string? LastErrorCode { get; set; }
}

internal sealed class BackgroundJobConfiguration : IEntityTypeConfiguration<BackgroundJobRecord>
{
    public void Configure(EntityTypeBuilder<BackgroundJobRecord> builder)
    {
        builder.ToTable("BackgroundJobs");
        builder.HasKey(job => job.Id);
        builder.Property(job => job.Name).HasMaxLength(100);
        builder.Property(job => job.IdempotencyKey).HasMaxLength(200);
        builder.Property(job => job.State).HasMaxLength(20);
        builder.Property(job => job.PayloadJson).HasColumnType("jsonb");
        builder.Property(job => job.LastErrorCode).HasMaxLength(200);
        builder.HasIndex(job => new { job.Name, job.IdempotencyKey }).IsUnique();
        builder.HasIndex(job => new { job.State, job.AvailableAt });
    }
}
