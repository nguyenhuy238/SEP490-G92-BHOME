using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Modules.StaffOperations.Persistence;

internal sealed class TaskHistoryConfiguration : IEntityTypeConfiguration<OperationalTaskHistory>
{
    public void Configure(EntityTypeBuilder<OperationalTaskHistory> e)
    {
        e.ToTable("OperationalTaskHistory");
        e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        e.Property(x => x.Action).HasMaxLength(50); e.Property(x => x.Note).HasMaxLength(8000);
        e.Property(x => x.ChangesJson).HasColumnType("jsonb");
        e.HasIndex(x => new { x.TaskId, x.OccurredAt });
    }
}
internal sealed class TaskEvidenceConfiguration : IEntityTypeConfiguration<OperationalTaskEvidence>
{
    public void Configure(EntityTypeBuilder<OperationalTaskEvidence> e)
    {
        e.ToTable("OperationalTaskEvidence");
        e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
        e.Property(x => x.ObjectKey).HasMaxLength(250); e.HasIndex(x => x.ObjectKey).IsUnique();
        e.Property(x => x.ContentType).HasMaxLength(100); e.Property(x => x.Sha256).HasMaxLength(64);
        e.HasIndex(x => new { x.TaskId, x.CreatedAt });
    }
}
internal sealed class TaskCommandConfiguration : IEntityTypeConfiguration<OperationalTaskCommand>
{
    public void Configure(EntityTypeBuilder<OperationalTaskCommand> e)
    {
        e.ToTable("OperationalTaskCommands");
        e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        e.HasIndex(x => new { x.ActorId, x.Key }).IsUnique();
        e.Property(x => x.Fingerprint).HasMaxLength(64); e.Property(x => x.ResponseJson).HasColumnType("jsonb");
    }
}
internal sealed class TaskNotificationConfiguration : IEntityTypeConfiguration<OperationalTaskNotification>
{
    public void Configure(EntityTypeBuilder<OperationalTaskNotification> e)
    {
        e.ToTable("OperationalTaskNotifications");
        e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RecipientUserId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<OperationalTaskHistory>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Restrict);
        e.HasIndex(x => new { x.EventId, x.RecipientUserId }).IsUnique();
        e.HasIndex(x => new { x.RecipientUserId, x.CreatedAt }); e.Property(x => x.Event).HasMaxLength(50);
    }
}
internal sealed class TaskFileUploadConfiguration : IEntityTypeConfiguration<OperationalTaskFileUpload>
{
    public void Configure(EntityTypeBuilder<OperationalTaskFileUpload> e)
    {
        e.ToTable("OperationalTaskFileUploads");
        e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
        e.Property(x => x.ObjectKey).HasMaxLength(250); e.HasIndex(x => x.ObjectKey).IsUnique();
        e.HasIndex(x => x.CleanupAfter);
    }
}
