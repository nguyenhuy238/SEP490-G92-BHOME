using System.Text.Json;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

// Explicit offline operation. Neither connection defaults to the API/live database.
if (args.Length != 2 || args[0] is not ("--initialize-target" or "--inspect" or "--copy-identity-fixture" or "--copy-all"))
{
    Console.Error.WriteLine("Use --initialize-target, --inspect, --copy-all or --copy-identity-fixture followed by <report.json>. Connections use BHOME_COMPACT24_SOURCE/TARGET, never arguments.");
    return 1;
}
var committed = false;
try
{
    var to = Environment.GetEnvironmentVariable("BHOME_COMPACT24_TARGET");
    if (string.IsNullOrWhiteSpace(to)) throw new Compact24MigrationException("target_connection_required");
    if (args[0] == "--initialize-target")
    {
        await Compact24Schema.InitializeAsync(to); committed = true;
        await WriteReport(new { Status = "EMPTY_TARGET_INITIALIZED", SchemaVersion = Compact24Schema.Version,
            Compact24Schema.ScriptSha256, BusinessTables = 24, Columns = 386, ForeignKeys = 83,
            TechnicalMigrationHistoryTables = 0, SourceRead = false, RuntimeConnectionChanged = false });
        Console.WriteLine("EMPTY_TARGET_INITIALIZED: 24 business tables; no accounts/data imported or runtime connection changed."); return 0;
    }
    var from = Environment.GetEnvironmentVariable("BHOME_COMPACT24_SOURCE");
    if (string.IsNullOrWhiteSpace(from)) throw new Compact24MigrationException("source_connection_required");
    var limitText = Environment.GetEnvironmentVariable("BHOME_COMPACT24_MAX_ROWS_PER_TABLE");
    var limit = string.IsNullOrWhiteSpace(limitText) ? 10000 : int.TryParse(limitText, out var supplied) && supplied > 0
        ? supplied : throw new Compact24MigrationException("positive_copy_limit_required");
    await using var source = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(from).Options);
    await using var target = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(to).Options);
    if (args[0] == "--copy-identity-fixture")
    {
        var copied = await new Compact24FixtureMigration(source, target).CopyIdentityFixtureAsync(); committed = true;
        await WriteReport(new { Status = "IDENTITY_FIXTURE_COPIED", IdentityCopy = copied,
            FullDataCopy = false, RuntimeConnectionChanged = false });
        Console.WriteLine("IDENTITY_FIXTURE_COPIED: focused fixture only."); return 0;
    }
    var migration = new Compact24DataMigration(source, target, limit);
    var inspection = await migration.InspectAsync();
    if (inspection.Blockers.Count > 0 || args[0] == "--inspect")
    {
        var ready = inspection.Blockers.Count == 0;
        await WriteReport(new { Status = ready ? "PREFLIGHT_READY" : "BLOCKED", MaximumRowsPerTable = limit,
            Tables = inspection.Tables.Select(t => new { t.Source, t.Target, t.Rows }), inspection.Blockers,
            SourceReadOnly = true, TargetWritten = false, RuntimeConnectionChanged = false });
        Console.WriteLine($"{(ready ? "PREFLIGHT_READY" : "BLOCKED")}: {inspection.Tables.Count} source tables inspected."); return ready ? 0 : 2;
    }
    var result = await migration.CopyAsync(); committed = true;
    await WriteReport(new { Status = "DATA_COPIED_AND_RECONCILED", SchemaVersion = Compact24Schema.Version,
        Compact24Schema.ScriptSha256, MaximumRowsPerTable = limit, DataMigration = result,
        RuntimeConnectionChanged = false, RuntimeVerificationPerformedByThisCommand = false });
    Console.WriteLine($"DATA_COPIED_AND_RECONCILED: {result.Tables.Count} source tables. Validate the deployment before changing its connection.");
    return 0;
}
catch (Exception error)
{
    // Provider messages may contain sensitive values. Only safe codes and aggregate evidence leave the process.
    var code = error is Compact24MigrationException rejected ? rejected.Code : "operation_failed";
    var status = committed ? "COMMITTED_REPORT_WRITE_FAILED" : "BLOCKED";
    Console.Error.WriteLine($"{status}: {code}; target committed: {committed}. Runtime connection unchanged.");
    try { await WriteReport(new { Status = status, Code = code, TargetCommitted = committed, RuntimeConnectionChanged = false }); }
    catch (IOException) { Console.Error.WriteLine("Report path unavailable."); }
    catch (UnauthorizedAccessException) { Console.Error.WriteLine("Report path unavailable."); }
    return 1;
}

Task WriteReport(object value) => File.WriteAllTextAsync(Path.GetFullPath(args[1]), JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true }));
