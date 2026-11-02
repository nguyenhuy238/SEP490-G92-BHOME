using System.Collections.Concurrent;
using BHome.Application.Storage;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests.IncidentMaintenance;

// Defaults to disposable PostgreSQL 16 Docker. A loopback administrator connection can instead
// create one random, disposable database on the local PostgreSQL server. Never migrates bhome.
public sealed class IncidentFixture : IAsyncLifetime
{
    private PostgreSqlContainer? postgres;
    private ApiFactory? root;
    private string? administrator;
    private readonly string database = "bhome_incident_test_" + Guid.NewGuid().ToString("N");
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public IncidentMemoryStorage Storage { get; } = new();
    public string ConnectionString { get; private set; } = "";
    public async Task InitializeAsync()
    {
        var connection = Environment.GetEnvironmentVariable("BHOME_INCIDENT_TEST_ADMIN");
        if (!string.IsNullOrWhiteSpace(connection))
        {
            var builder = new NpgsqlConnectionStringBuilder(connection);
            if (builder.Host is not ("localhost" or "127.0.0.1" or "::1")) throw new InvalidOperationException("Only loopback disposable databases are supported.");
            builder.Database = "postgres"; administrator = builder.ConnectionString;
            await using var admin = new NpgsqlConnection(administrator); await admin.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", admin); await command.ExecuteNonQueryAsync();
            builder.Database = database; ConnectionString = builder.ConnectionString;
        }
        else
        {
            postgres = new PostgreSqlBuilder("postgres:16-alpine").Build(); await postgres.StartAsync();
            ConnectionString = postgres.GetConnectionString();
        }
        root = new ApiFactory { ConnectionString = ConnectionString };
        Factory = root.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        { s.RemoveAll<IObjectStorage>(); s.AddSingleton<IObjectStorage>(Storage); }));
        await using var scope = Factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
    }
    public async Task DisposeAsync()
    {
        try
        { if (Factory is not null) await Factory.DisposeAsync(); if (root is not null) await root.DisposeAsync(); }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            if (administrator is not null)
            {
                // database is generated once above, with a constant prefix and UUID; never user input.
                await using var admin = new NpgsqlConnection(administrator); await admin.OpenAsync();
                await using var command = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)", admin); await command.ExecuteNonQueryAsync();
            }
            if (postgres is not null) await postgres.DisposeAsync();
        }
    }
}

public sealed class IncidentMemoryStorage : IObjectStorage
{
    public ConcurrentDictionary<string, byte[]> Objects { get; } = new();
    public bool FailWrites { get; set; }
    public async Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken cancellationToken)
    {
        using var memory = new MemoryStream(); await content.CopyToAsync(memory, cancellationToken);
        Objects[key] = memory.ToArray();
        if (FailWrites) throw new IOException("synthetic_partial_upload");
    }
    public Task CopyToAsync(string key, Stream destination, CancellationToken cancellationToken) =>
        Objects.TryGetValue(key, out var bytes) ? destination.WriteAsync(bytes, cancellationToken).AsTask() : throw new FileNotFoundException("synthetic_missing_object");
    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    { cancellationToken.ThrowIfCancellationRequested(); Objects.TryRemove(key, out _); return Task.CompletedTask; }
}
