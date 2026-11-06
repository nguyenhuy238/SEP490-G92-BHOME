using BHome.Infrastructure.Persistence.Compact24;

try
{
    if (args.SequenceEqual(new[] { "--inspect-schema" }))
    {
        var settings = new Npgsql.NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__Database") ?? "");
        if (settings.Host is not ("127.0.0.1" or "localhost" or "::1") || settings.Database != "bhome")
            throw new DevelopmentDatabaseException("dedicated_loopback_development_database_required");
        await using var schemaConnection = new Npgsql.NpgsqlConnection(settings.ConnectionString); await schemaConnection.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position", schemaConnection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) Console.WriteLine($"{reader.GetString(0)}.{reader.GetString(1)}:{reader.GetString(2)}:{reader.GetString(3)}");
        return 0;
    }
    var checkOnly = args.SequenceEqual(new[] { "--check" });
    var archiveLegacy = args.SequenceEqual(new[] { "--archive-legacy" });
    var upgradeProperty = args.SequenceEqual(new[] { "--upgrade-property-schema" });
    if (args.Length > 0 && !checkOnly && !archiveLegacy && !upgradeProperty)
        throw new DevelopmentDatabaseException("use_check_archive_legacy_or_upgrade_property_schema");
    var environment = Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
    var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Database") ?? "";
    var result = upgradeProperty ? await Compact24PropertyUpgrade.ApplyAsync(environment, connection) : await Compact24DevelopmentDatabase.PrepareAsync(
        Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
        Environment.GetEnvironmentVariable("ConnectionStrings__Database") ?? "", archiveLegacy, checkOnly);
    Console.WriteLine($"Compact24: {result.State}; schema {Compact24Schema.Version}; 24 tables, 383 columns, 83 foreign keys when ready.");
    if (result.BackupDatabase is not null)
        Console.WriteLine($"Preserved complete legacy database as {result.BackupDatabase}. No tables dropped or old accounts imported.");
    return result.State is "MISSING" or "EMPTY" or "LEGACY_REQUIRES_RECREATE" or "PROPERTY_UPGRADE_REQUIRED" ? 2 : 0;
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
