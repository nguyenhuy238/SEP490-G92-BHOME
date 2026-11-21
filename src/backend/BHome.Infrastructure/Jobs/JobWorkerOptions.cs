namespace BHome.Infrastructure.Jobs;

public sealed class JobWorkerOptions
{
    public bool Enabled { get; set; }
    public int PollSeconds { get; set; } = 5;
}
