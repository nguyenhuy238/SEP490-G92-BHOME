using System.Security.Cryptography;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.LocalDevelopment;

// Explicit administrative command, never used by API startup or normal local seeding.
public static class SharedDevelopmentRoles
{
    public const string Group = "bhome_development_runtime";
    public static readonly string[] Names = Enumerable.Range(1, 5).Select(n => $"bhome_dev{n:00}").ToArray();

    public static async Task ProvisionAsync(string direct, string directory, CancellationToken token = default)
    {
        var admin = Compact24DbContextFactory.ValidateTarget(direct, "development");
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(admin.ConnectionString).Options);
        if (!await db.IsSchemaReadyAsync(token)) throw new LocalTestAccountException("Verify the Compact24 schema before provisioning runtime roles.");
        Directory.CreateDirectory(directory);
        await using var connection = new NpgsqlConnection(admin.ConnectionString);
        await connection.OpenAsync(token);
        await using var transaction = await connection.BeginTransactionAsync(token);
        async Task Execute(string sql)
        {
            await using var command = new NpgsqlCommand(sql, connection, transaction);
            await command.ExecuteNonQueryAsync(token);
        }
        async Task<bool> Exists(string name)
        {
            await using var query = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=@name)", connection, transaction);
            query.Parameters.AddWithValue("name", name);
            return (bool)(await query.ExecuteScalarAsync(token))!;
        }
        await Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-development-roles-v1',0))");
        if (!await Exists(Group)) await Execute($"CREATE ROLE {Group} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
        await using (var groupCheck = new NpgsqlCommand($"SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE rolname='{Group}'", connection, transaction))
            if ((bool)(await groupCheck.ExecuteScalarAsync(token))!)
                throw new LocalTestAccountException("The existing runtime group has unexpected login privileges or memberships.");
        foreach (var name in Names)
        {
            var path = Path.Combine(directory, name + ".env");
            var exists = await Exists(name);
            if (exists && !File.Exists(path))
                throw new LocalTestAccountException("An existing developer role has no matching local credential file; do not reset it automatically.");
            NpgsqlConnectionStringBuilder runtime;
            if (File.Exists(path))
            {
                var line = File.ReadLines(path).Single(x => x.StartsWith("ConnectionStrings__Database=", StringComparison.Ordinal));
                runtime = new(line["ConnectionStrings__Database=".Length..]);
                var expectedHost = admin.Host == Compact24DbContextFactory.DevelopmentDirectHost
                    ? "ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech" : admin.Host;
                if (runtime.Username != name || runtime.Database != admin.Database || runtime.Host != expectedHost ||
                    admin.Host == Compact24DbContextFactory.DevelopmentDirectHost &&
                    (runtime.SslMode != SslMode.VerifyFull || runtime.ChannelBinding != ChannelBinding.Require))
                    throw new LocalTestAccountException("Existing developer credential metadata does not match the intended role/database.");
            }
            else
            {
                runtime = new(admin.ConnectionString)
                {
                    Host = admin.Host == Compact24DbContextFactory.DevelopmentDirectHost
                        ? "ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech" : admin.Host,
                    Username = name,
                    Password = "Dev!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
                    Pooling = true,
                    MaxPoolSize = 5,
                    MinPoolSize = 0,
                    ApplicationName = "BHome.SharedDevelopment." + name
                };
                // Persist before committing credentials, so a filesystem failure cannot strand a new role.
                await File.WriteAllTextAsync(path, "ConnectionStrings__Database=" + runtime.ConnectionString + "\n", token);
            }
            if (!exists)
            {
                // Passwords are generated locally and are never returned or written to console/logging.
                await Execute($"CREATE ROLE {name} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{runtime.Password!.Replace("'", "''", StringComparison.Ordinal)}'");
            }
            await Execute($"GRANT {Group} TO {name}");
            await using var unsafeRole = new NpgsqlCommand("""
                SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR EXISTS(
                    SELECT 1 FROM pg_roles inherited WHERE inherited.rolname NOT IN (@name,@group)
                      AND pg_has_role(r.oid,inherited.oid,'MEMBER')) FROM pg_roles r WHERE r.rolname=@name
                """, connection, transaction);
            unsafeRole.Parameters.AddWithValue("name", name);
            unsafeRole.Parameters.AddWithValue("group", Group);
            if ((bool)(await unsafeRole.ExecuteScalarAsync(token))!)
                throw new LocalTestAccountException("An existing developer role has unexpected elevated privileges or memberships.");
        }
        var database = new NpgsqlCommandBuilder().QuoteIdentifier(admin.Database!);
        await Execute($"REVOKE CREATE, TEMPORARY ON DATABASE {database} FROM PUBLIC");
        await Execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
        await Execute($"GRANT CONNECT ON DATABASE {database} TO {Group}");
        await Execute($"GRANT USAGE ON SCHEMA public, bhome_meta TO {Group}");
        await Execute($"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {Group}");
        await Execute($"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {Group}");
        await Execute($"GRANT SELECT ON TABLE bhome_meta.\"__EFMigrationsHistory\" TO {Group}");
        await Execute($"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {Group}");
        await Execute($"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {Group}");
        await transaction.CommitAsync(token);
    }
}
