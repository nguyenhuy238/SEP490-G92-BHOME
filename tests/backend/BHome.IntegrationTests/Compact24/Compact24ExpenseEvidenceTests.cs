using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.Storage;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24ExpenseTests
{
    private sealed class EvidenceStorage : IObjectStorage
    {
        public readonly ConcurrentDictionary<string, byte[]> Files = new();
        public bool FailAfterWrite;
        public async Task PutAsync(string key, Stream data, long length, string type, CancellationToken t)
        { using var buffer = new MemoryStream(); await data.CopyToAsync(buffer, t); Files[key] = buffer.ToArray(); if (FailAfterWrite) { FailAfterWrite = false; throw new IOException("Synthetic storage interruption"); } }
        public Task CopyToAsync(string key, Stream output, CancellationToken t) => output.WriteAsync(Files[key], t).AsTask();
        public Task DeleteAsync(string key, CancellationToken t) { Files.TryRemove(key, out _); return Task.CompletedTask; }
    }
    private static byte[] EvidenceImage(bool changed = false)
    { using var image = new Mat(40, 100, MatType.CV_8UC3, changed ? Scalar.Black : Scalar.White); return image.ImEncode(".png"); }
    private static Task<HttpResponseMessage> UploadEvidence(HttpClient client, Guid id, byte[] bytes, Guid key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"{Root}/{id}/evidence") { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new("image/png"); request.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(request);
    }
    [CompactPostgresFact]
    public async Task PrivateExpenseEvidencePreservesLegacyMetadataReplaysAndRejectsTamperingAndOtherRoles()
    {
        var (original, input) = await Setup(); var expense = await Value(await Create(original, input, Guid.NewGuid())); var store = new EvidenceStorage();
        var signingKey = fixture.Factory!.Services.GetRequiredService<IConfiguration>()["Jwt:SigningKey"];
        await using var host = fixture.Factory.WithWebHostBuilder(b => { b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string,string?> { ["Jwt:SigningKey"] = signingKey })); b.ConfigureTestServices(s => { s.RemoveAll<IObjectStorage>(); s.AddSingleton<IObjectStorage>(store); }); });
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization;
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE expenses SET evidence='[{{\"legacyReference\":\"preserve-verbatim\"}}]'::jsonb WHERE id={expense.Id}");
        var bytes = EvidenceImage(); var key = Guid.NewGuid();
        var results = await Task.WhenAll(UploadEvidence(owner, expense.Id, bytes, key), UploadEvidence(owner, expense.Id, bytes, key));
        foreach (var result in results) Assert.True(result.IsSuccessStatusCode, await result.Content.ReadAsStringAsync());
        var file = (await results[0].Content.ReadFromJsonAsync<ExpenseEvidenceView>())!;
        Assert.Equal(file.Id, (await results[1].Content.ReadFromJsonAsync<ExpenseEvidenceView>())!.Id); Assert.Equal("Uploaded", file.Status);
        var list = await owner.GetFromJsonAsync<ExpenseEvidenceView[]>($"{Root}/{expense.Id}/evidence"); Assert.Single(list!);
        var metadata = await owner.GetStringAsync($"{Root}/{expense.Id}/evidence"); Assert.DoesNotContain("objectKey", metadata); Assert.DoesNotContain("expenses/", metadata);
        Assert.Equal(bytes, await owner.GetByteArrayAsync($"{Root}/{expense.Id}/evidence/{file.Id}"));
        Assert.Equal(HttpStatusCode.Conflict, (await UploadEvidence(owner, expense.Id, EvidenceImage(true), key)).StatusCode);
        using var staff = await User("Staff"); using var tenant = await User("Tenant");
        foreach (var actor in new[] { staff, tenant })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await actor.GetAsync($"{Root}/{expense.Id}/evidence")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await actor.GetAsync($"{Root}/{expense.Id}/evidence/{file.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await UploadEvidence(actor, expense.Id, bytes, Guid.NewGuid())).StatusCode);
        }
        var another = await Value(await Create(owner, input, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"{Root}/{another.Id}/evidence/{file.Id}")).StatusCode);
        store.Files[Assert.Single(store.Files.Keys)] = EvidenceImage(true);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync($"{Root}/{expense.Id}/evidence/{file.Id}")).StatusCode);
        var raw = await db.Database.SqlQuery<string>($"SELECT evidence::text AS \"Value\" FROM expenses WHERE id={expense.Id}").SingleAsync(); Assert.Contains("preserve-verbatim", raw);
        Assert.Equal(1, (await owner.GetFromJsonAsync<ExpenseView>($"{Root}/{expense.Id}"))!.Version);
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == expense.Id && a.Event == "ExpenseEvidenceUploaded"));
        Assert.True(await db.IsSchemaReadyAsync());
    }
    [CompactPostgresFact]
    public async Task InterruptedExpenseUploadHasDurablePendingIntentAndRecoversWithTheSameKey()
    {
        var (original, input) = await Setup(); var expense = await Value(await Create(original, input, Guid.NewGuid())); var store = new EvidenceStorage { FailAfterWrite = true };
        var signingKey = fixture.Factory!.Services.GetRequiredService<IConfiguration>()["Jwt:SigningKey"];
        await using var host = fixture.Factory.WithWebHostBuilder(b => { b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string,string?> { ["Jwt:SigningKey"] = signingKey })); b.ConfigureTestServices(s => { s.RemoveAll<IObjectStorage>(); s.AddSingleton<IObjectStorage>(store); }); });
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization;
        var key = Guid.NewGuid(); var bytes = EvidenceImage();
        Assert.Equal(HttpStatusCode.InternalServerError, (await UploadEvidence(owner, expense.Id, bytes, key)).StatusCode);
        var pending = Assert.Single((await owner.GetFromJsonAsync<ExpenseEvidenceView[]>($"{Root}/{expense.Id}/evidence"))!); Assert.Equal("PendingUpload", pending.Status);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"{Root}/{expense.Id}/evidence/{pending.Id}")).StatusCode);
        var retried = await UploadEvidence(owner, expense.Id, bytes, key); retried.EnsureSuccessStatusCode();
        var complete = (await retried.Content.ReadFromJsonAsync<ExpenseEvidenceView>())!; Assert.Equal(pending.Id, complete.Id); Assert.Equal("Uploaded", complete.Status); Assert.Single(store.Files);
        Assert.Equal(bytes, await owner.GetByteArrayAsync($"{Root}/{expense.Id}/evidence/{complete.Id}"));
        Assert.Equal(HttpStatusCode.BadRequest, (await UploadEvidence(owner, expense.Id, "not-an-image"u8.ToArray(), Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await UploadEvidence(owner, expense.Id, new byte[5 * 1024 * 1024 + 1], Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await UploadEvidence(owner, Guid.NewGuid(), bytes, Guid.NewGuid())).StatusCode);
        Assert.Single((await owner.GetFromJsonAsync<ExpenseEvidenceView[]>($"{Root}/{expense.Id}/evidence"))!);
    }
}
