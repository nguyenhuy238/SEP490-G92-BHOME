namespace BHome.Application.Billing;
public static class BillingAutomationDates
{
    public const string TimeZone="Asia/Ho_Chi_Minh";
    public static DateOnly BusinessDate(DateTimeOffset instant)=>DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(instant,TimeZone).DateTime);
}
