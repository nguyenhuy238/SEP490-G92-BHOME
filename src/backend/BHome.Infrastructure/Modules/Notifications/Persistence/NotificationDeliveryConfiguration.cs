using BHome.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Modules.Notifications.Persistence;
internal sealed class NotificationDeliveryConfiguration:IEntityTypeConfiguration<UserNotification>
{
    public void Configure(EntityTypeBuilder<UserNotification> e){e.Property(n=>n.DeliveryLastErrorCode).HasMaxLength(120);e.Property(n=>n.DeliveryProviderReference).HasMaxLength(200);e.HasIndex(n=>new{n.DeliveryState,n.NextDeliveryAt});}
}
internal sealed class NotificationDeliveryAttemptConfiguration:IEntityTypeConfiguration<NotificationDeliveryAttempt>
{
    public void Configure(EntityTypeBuilder<NotificationDeliveryAttempt> e){e.ToTable("NotificationDeliveryAttempts");e.HasKey(n=>n.Id);e.HasIndex(n=>new{n.NotificationId,n.Sequence}).IsUnique();e.Property(n=>n.Outcome).HasMaxLength(30);e.Property(n=>n.ErrorCode).HasMaxLength(120);e.HasOne<UserNotification>().WithMany().HasForeignKey(n=>n.NotificationId).OnDelete(DeleteBehavior.Restrict);}
}
