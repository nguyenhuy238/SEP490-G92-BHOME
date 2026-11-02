using BHome.Domain.Locations;
using BHome.Domain.Notifications;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Modules.Notifications.Persistence;
internal sealed class UserNotificationConfiguration:IEntityTypeConfiguration<UserNotification>
{
    public void Configure(EntityTypeBuilder<UserNotification> e)
    {
        e.ToTable("UserNotifications");e.HasKey(n=>n.Id);e.HasIndex(n=>new{n.RecipientUserId,n.EventKey}).IsUnique();e.HasIndex(n=>new{n.RecipientUserId,n.ReadAt,n.CreatedAt});
        e.Property(n=>n.AudienceRole).HasMaxLength(20);e.Property(n=>n.Category).HasMaxLength(30);e.Property(n=>n.Title).HasMaxLength(150);e.Property(n=>n.Summary).HasMaxLength(1000);e.Property(n=>n.RelatedObjectType).HasMaxLength(40);e.Property(n=>n.EventKey).HasMaxLength(220);e.Property(n=>n.DeliveryState).HasMaxLength(30);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(n=>n.RecipientUserId).OnDelete(DeleteBehavior.Restrict);e.HasOne<Location>().WithMany().HasForeignKey(n=>n.LocationId).OnDelete(DeleteBehavior.Restrict);e.HasOne<OperationalTaskNotification>().WithMany().HasForeignKey(n=>n.SourceTaskNotificationId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class NotificationPublicationConfiguration:IEntityTypeConfiguration<NotificationPublication>
{
    public void Configure(EntityTypeBuilder<NotificationPublication> e){e.ToTable("NotificationPublications");e.HasKey(n=>n.EventKey);e.Property(n=>n.EventKey).HasMaxLength(220);}
}
