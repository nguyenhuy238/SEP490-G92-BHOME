using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

try
{
    var checkOnly = args.Length == 1 && args[0] == "--check";
    if (args.Length > 0 && !checkOnly) throw new InvalidOperationException("Use --check for read-only migration inspection.");
    var connection = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__Database"));
    if (connection.Host is not ("localhost" or "127.0.0.1" or "::1") || connection.Database != "bhome")
        throw new InvalidOperationException("Only the documented loopback development database bhome is supported.");
    await using var db = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(connection.ConnectionString).Options);
    if (checkOnly)
    {
        var missing = (await db.Database.GetPendingMigrationsAsync()).ToArray();
        Console.WriteLine($"Local database: {missing.Length} pending migration(s). Read-only check; no changes made.");
        foreach (var migration in missing) Console.WriteLine(migration);
        return missing.Length == 0 ? 0 : 2;
    }
    // The archive, import and all remaining migrations commit together or all roll back.
    await using var transaction = await db.Database.BeginTransactionAsync();
    await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(490920261028)");
    var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
    var known = db.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
    var unknown = applied.Where(id => !known.Contains(id) && id != "20261028103339_CaptureWorkflows").ToArray();
    if (unknown.Length > 0) throw new InvalidOperationException("Unrecognized migration history. Review the schema before upgrading.");
    var pending = (await db.Database.GetPendingMigrationsAsync()).ToArray();
    Console.WriteLine($"Local database: {pending.Length} pending migration(s). Existing data and migration history are preserved.");
    await db.Database.MigrateAsync();
    if ((await db.Database.GetPendingMigrationsAsync()).Any()) throw new InvalidOperationException("Migration verification failed.");
    await transaction.CommitAsync();
    Console.WriteLine("PASS: atomic local upgrade committed; no pending migrations.");
    return 0;
}
catch (Exception error)
{
    // Do not print connections, user data, SQL parameter values or provider exception details.
    Console.Error.WriteLine($"Local database operation failed ({error.GetType().Name}). No changes committed; do not reset the database.");
    if (error is InvalidOperationException && error.Message is
        "Only the documented loopback development database bhome is supported." or
        "Unrecognized migration history. Review the schema before upgrading.") Console.Error.WriteLine(error.Message);
    if (error is PostgresException postgres) Console.Error.WriteLine($"SQLSTATE: {postgres.SqlState}. Review the supported legacy preconditions in IPHONE_CONNECTIVITY.md.");
    return 1;
}
