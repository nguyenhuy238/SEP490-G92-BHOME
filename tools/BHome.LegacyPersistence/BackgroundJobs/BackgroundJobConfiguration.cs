using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Jobs;

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
