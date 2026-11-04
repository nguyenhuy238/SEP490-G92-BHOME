using BHome.Infrastructure.Persistence.Compact24;

try
{
    var checkOnly = args.SequenceEqual(new[] { "--check" });
    var archiveLegacy = args.SequenceEqual(new[] { "--archive-legacy" });
    if (args.Length > 0 && !checkOnly && !archiveLegacy)
        throw new DevelopmentDatabaseException("use_check_or_archive_legacy");
    var result = await Compact24DevelopmentDatabase.PrepareAsync(
        Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
        Environment.GetEnvironmentVariable("ConnectionStrings__Database") ?? "", archiveLegacy, checkOnly);
    Console.WriteLine($"Compact24: {result.State}; schema {Compact24Schema.Version}; 24 tables, 386 columns, 83 foreign keys when ready.");
    if (result.BackupDatabase is not null)
        Console.WriteLine($"Preserved complete legacy database as {result.BackupDatabase}. No tables dropped or old accounts imported.");
    return result.State is "MISSING" or "EMPTY" or "LEGACY_REQUIRES_RECREATE" ? 2 : 0;
}
catch (DevelopmentDatabaseException error)
{
    Console.Error.WriteLine(error.Message); return 1;
}
catch (Exception error)
{
    Console.Error.WriteLine($"Development database preparation failed ({error.GetType().Name}). Inspect database names before retrying; no database is dropped.");
    return 1;
}
