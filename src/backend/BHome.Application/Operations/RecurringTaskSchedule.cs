namespace BHome.Application.Operations;

public static class RecurringTaskSchedule
{
    private static readonly TimeZoneInfo Vietnam = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");

    public static bool IsValid(RecurringTaskTemplateWrite input)
    {
        if (input.ScheduleType is not ("IntervalDays" or "Daily" or "Weekly" or "Monthly")) return false;
        var local = TimeZoneInfo.ConvertTime(input.NextRunAt, Vietnam);
        return input.ScheduleType switch
        {
            "Daily" => input.IntervalDays == 1 && input.DayOfWeek is null && input.DayOfMonth is null,
            "Weekly" => input.IntervalDays == 7 && input.DayOfWeek is >= 1 and <= 7 &&
                input.DayOfMonth is null && IsoDay(local.DayOfWeek) == input.DayOfWeek,
            "Monthly" => input.IntervalDays == 1 && input.DayOfMonth is >= 1 and <= 31 &&
                input.DayOfWeek is null && local.Day == input.DayOfMonth,
            _ => input.IntervalDays is >= 1 and <= 365 && input.DayOfWeek is null && input.DayOfMonth is null
        };
    }

    public static DateTimeOffset Next(RecurringTaskTemplateView template, DateTimeOffset scheduled)
    {
        var local = TimeZoneInfo.ConvertTime(scheduled, Vietnam);
        return template.ScheduleType switch
        {
            "Daily" => AtLocal(local.DateTime.AddDays(1)),
            "Weekly" => AtLocal(local.DateTime.AddDays(7)),
            "Monthly" when template.DayOfMonth is { } day => NextMonthly(local.DateTime, day),
            _ => AtLocal(local.DateTime.AddDays(template.IntervalDays))
        };
    }

    private static DateTimeOffset NextMonthly(DateTime local, int day)
    {
        var month = new DateTime(local.Year, local.Month, 1, local.Hour, local.Minute, local.Second,
            DateTimeKind.Unspecified).AddMonths(1);
        while (day > DateTime.DaysInMonth(month.Year, month.Month)) month = month.AddMonths(1);
        return AtLocal(new DateTime(month.Year, month.Month, day, local.Hour, local.Minute, local.Second,
            DateTimeKind.Unspecified));
    }

    private static DateTimeOffset AtLocal(DateTime value)
    {
        var local = DateTime.SpecifyKind(value, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, Vietnam.GetUtcOffset(local)).ToUniversalTime();
    }

    private static int IsoDay(DayOfWeek value) => value == System.DayOfWeek.Sunday ? 7 : (int)value;
}
