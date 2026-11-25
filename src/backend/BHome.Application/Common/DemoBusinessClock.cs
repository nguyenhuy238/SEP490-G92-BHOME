namespace BHome.Application.Common;

public sealed record DemoClockState(bool Enabled, bool Simulated, DateOnly BusinessDate, long Version, bool CanChange = false);

// GetUtcNow deliberately stays real for security, leases, evidence TTL and external integrations.
public sealed class DemoBusinessClock(TimeProvider real) : TimeProvider
{
    private readonly object gate = new();
    private DateOnly? date;
    private long version;
    public override DateTimeOffset GetUtcNow() => real.GetUtcNow();
    public override long GetTimestamp() => real.GetTimestamp();
    public override long TimestampFrequency => real.TimestampFrequency;
    public override TimeZoneInfo LocalTimeZone => real.LocalTimeZone;
    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) => real.CreateTimer(callback, state, dueTime, period);
    private static DateOnly VietnamDate(DateTimeOffset now) => DateOnly.FromDateTime(now.ToOffset(TimeSpan.FromHours(7)).DateTime);
    public DateTimeOffset BusinessUtcNow()
    {
        lock (gate)
        {
            var now = real.GetUtcNow();
            if (date is null) return now;
            var local = now.ToOffset(TimeSpan.FromHours(7));
            return new DateTimeOffset(date.Value.ToDateTime(TimeOnly.FromDateTime(local.DateTime)), local.Offset).ToUniversalTime();
        }
    }
    public DemoClockState Read()
    {
        lock (gate) return new(true, date.HasValue, VietnamDate(BusinessUtcNow()), version);
    }
    public DemoClockState? Change(DateOnly? requested, long expectedVersion)
    {
        lock (gate)
        {
            if (version != expectedVersion) return null;
            date = requested;
            version++;
            return Read();
        }
    }
}

public static class BusinessTime
{
    public static DateTimeOffset BusinessUtcNow(this TimeProvider clock) => clock is DemoBusinessClock demo ? demo.BusinessUtcNow() : clock.GetUtcNow();
    public static DateOnly BusinessToday(this TimeProvider clock) => DateOnly.FromDateTime(clock.BusinessUtcNow().ToOffset(TimeSpan.FromHours(7)).DateTime);
}
