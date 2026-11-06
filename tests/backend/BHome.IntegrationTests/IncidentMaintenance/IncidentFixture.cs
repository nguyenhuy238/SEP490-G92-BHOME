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
    private readonly BHome.IntegrationTests.Compact24.Compact24Fixture database = new();
    private WebApplicationFactory<Program>? host;
    public WebApplicationFactory<Program> Factory => host!;
    public IncidentMemoryStorage Storage { get; } = new();
    public string ConnectionString => database.Connection;
    public async Task InitializeAsync()
    {
        await database.InitializeAsync();
        if (database.Factory is null) return;
        host = database.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        { s.RemoveAll<IObjectStorage>(); s.AddSingleton<IObjectStorage>(Storage); }));
    }
    public async Task DisposeAsync()
    {
        if (host is not null) await host.DisposeAsync();
        await database.DisposeAsync();
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
