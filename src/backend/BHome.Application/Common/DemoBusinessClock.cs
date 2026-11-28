namespace BHome.Application.Common;

public sealed record DemoClockState(bool Enabled, bool Simulated, DateOnly BusinessDate, long Version, bool CanChange = false,
    DateTimeOffset? BusinessTime = null, DateTimeOffset? RealTime = null);

// GetUtcNow deliberately stays real for security, leases, evidence TTL and external integrations.
public sealed class DemoBusinessClock(TimeProvider real) : TimeProvider
{
    private readonly object gate = new();
    private TimeSpan? shift;
    private long version;
    public override DateTimeOffset GetUtcNow() => real.GetUtcNow();
    public override long GetTimestamp() => real.GetTimestamp();
    public override long TimestampFrequency => real.TimestampFrequency;
    public override TimeZoneInfo LocalTimeZone => real.LocalTimeZone;
    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) => real.CreateTimer(callback, state, dueTime, period);
    private static readonly TimeSpan VietnamOffset = TimeSpan.FromHours(7);
    public DateTimeOffset BusinessUtcNow()
    {
        lock (gate) return real.GetUtcNow().Add(shift ?? TimeSpan.Zero);
    }
    public DemoClockState Read()
    {
        lock (gate)
        {
            var now = real.GetUtcNow();
            var business = now.Add(shift ?? TimeSpan.Zero).ToOffset(VietnamOffset);
            return new(true, shift.HasValue, DateOnly.FromDateTime(business.DateTime), version,
                BusinessTime: business, RealTime: now.ToOffset(VietnamOffset));
        }
    }
    public DemoClockState? Change(DateOnly? requested, long expectedVersion)
    {
        lock (gate)
        {
            var local = BusinessUtcNow().ToOffset(VietnamOffset);
            return ChangeTime(requested is { } day ? new DateTimeOffset(day.ToDateTime(TimeOnly.FromDateTime(local.DateTime)), VietnamOffset) : null, expectedVersion);
        }
    }
    public DemoClockState? ChangeTime(DateTimeOffset? requested, long expectedVersion)
    {
        lock (gate)
        {
            if (version != expectedVersion) return null;
            shift = requested is { } target ? target.ToUniversalTime() - real.GetUtcNow() : null;
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
