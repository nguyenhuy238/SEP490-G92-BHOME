// The tests share one running API and one database (sessions, rate limit, lockout), so they run one at a time.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
