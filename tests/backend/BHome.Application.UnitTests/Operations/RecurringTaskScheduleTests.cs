using BHome.Application.Operations;

namespace BHome.Application.UnitTests.Operations;

public sealed class RecurringTaskScheduleTests
{
    [Fact]
    public void WeeklyScheduleAdvancesToTheSameWeekdayInVietnamTime()
    {
        var scheduled = new DateTimeOffset(2026, 11, 9, 1, 0, 0, TimeSpan.Zero); // Monday 08:00 ICT
        var template = Template("Weekly", 7, dayOfWeek: 1, nextRunAt: scheduled);

        Assert.Equal(new DateTimeOffset(2026, 11, 16, 1, 0, 0, TimeSpan.Zero),
            RecurringTaskSchedule.Next(template, scheduled));
    }

    [Fact]
    public void MonthlyScheduleKeepsTheSelectedDayAndSkipsMonthsWithoutIt()
    {
        var scheduled = new DateTimeOffset(2027, 1, 30, 1, 0, 0, TimeSpan.Zero); // 30 January 08:00 ICT
        var template = Template("Monthly", 1, dayOfMonth: 30, nextRunAt: scheduled);

        Assert.Equal(new DateTimeOffset(2027, 3, 30, 1, 0, 0, TimeSpan.Zero),
            RecurringTaskSchedule.Next(template, scheduled));
    }

    [Fact]
    public void ScheduleSelectorsMustMatchTheSubmittedNextRun()
    {
        var monday = new DateTimeOffset(2026, 11, 9, 1, 0, 0, TimeSpan.Zero);
        var input = new RecurringTaskTemplateWrite(Guid.NewGuid(), "Synthetic", "Synthetic requirements",
            "Normal", false, 7, monday, 24, true, ScheduleType: "Weekly", DayOfWeek: 2);

        Assert.False(RecurringTaskSchedule.IsValid(input));
    }

    private static RecurringTaskTemplateView Template(string scheduleType, int intervalDays,
        int? dayOfWeek = null, int? dayOfMonth = null, DateTimeOffset nextRunAt = default) =>
        new(Guid.NewGuid(), Guid.NewGuid(), "Synthetic", "Synthetic requirements", "Normal", false,
            intervalDays, nextRunAt, 24, true, 1, scheduleType, dayOfWeek, dayOfMonth);
}
