namespace BHome.Domain.Notifications;
public sealed class UserNotification
{
    public Guid Id{get;set;}=Guid.NewGuid();
    public Guid RecipientUserId{get;set;}
    public string AudienceRole{get;set;}="";
    public Guid? LocationId{get;set;}
    public string Category{get;set;}="";
    public string Title{get;set;}="";
    public string Summary{get;set;}="";
    public string RelatedObjectType{get;set;}="";
    public Guid RelatedObjectId{get;set;}
    public string EventKey{get;set;}="";
    public Guid? SourceTaskNotificationId{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset? ReadAt{get;set;}
    public string DeliveryState{get;set;}="Unconfigured";
}
public sealed class NotificationPublication
{
    public string EventKey{get;set;}="";
    public DateTimeOffset PublishedAt{get;set;}
    public int RecipientCount{get;set;}
}
