using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.PaymentsDebt;
using BHome.Application.Storage;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    private sealed class SyntheticBankProofStorage : IObjectStorage
    {
        public readonly ConcurrentDictionary<string, byte[]> Files = new();
        public bool FailWrite;
        public bool CorruptRead;
        public async Task PutAsync(string key, Stream stream, long length, string mime, CancellationToken token)
        {
            if (FailWrite) throw new IOException("Synthetic MinIO failure");
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, token);
            Files[key] = buffer.ToArray();
        }
        public Task CopyToAsync(string key, Stream destination, CancellationToken token) =>
            destination.WriteAsync(CorruptRead ? new byte[] { 0 } : Files[key], token).AsTask();
        public Task DeleteAsync(string key, CancellationToken token)
        { Files.TryRemove(key, out _); return Task.CompletedTask; }
    }

    private static byte[] SyntheticBankImage(bool variant = false)
    {
        using var image = new Mat(40, 80, MatType.CV_8UC3, variant ? Scalar.Black : Scalar.White);
        return image.ImEncode(".png");
    }

    private static Task<HttpResponseMessage> RegisterWithBankImage(HttpClient client, PaymentTransferInput input, byte[] bytes, Guid key, string mime = "image/png")
    {
        var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(JsonSerializer.Serialize(input, new JsonSerializerOptions(JsonSerializerDefaults.Web))), "input");
        var proof = new ByteArrayContent(bytes);
        proof.Headers.ContentType = new(mime);
        multipart.Add(proof, "evidence", "synthetic-bank-proof.png");
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payment-transactions/manual-with-evidence") { Content = multipart };
        request.Headers.Add("Idempotency-Key", key.ToString());
        return client.SendAsync(request);
    }

    [Fact]
    public async Task OwnerRegistersAndReadsPrivateStatementWithoutExposingObjectKeyToOtherRoles()
    {
        var w = await Setup();
        using var originalOwner = await Client(w.Owner);
        using var originalStaff = await Client(w.Staff);
        using var originalTenant = await Client(w.Tenants[0]);
        var storage = new SyntheticBankProofStorage();
        var key = fixture.Factory.Services.GetRequiredService<IConfiguration>()["Jwt:SigningKey"];
        await using var host = fixture.Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:SigningKey"] = key }));
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IObjectStorage>(); services.AddSingleton<IObjectStorage>(storage);
            });
        });
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = originalOwner.DefaultRequestHeaders.Authorization;
        using var staff = host.CreateClient(); staff.DefaultRequestHeaders.Authorization = originalStaff.DefaultRequestHeaders.Authorization;
        using var tenant = host.CreateClient(); tenant.DefaultRequestHeaders.Authorization = originalTenant.DefaultRequestHeaders.Authorization;
        using var anonymous = host.CreateClient();
        var input = Input(w) with { StatementReference = "FAKE CLIENT TEXT" };
        var image = SyntheticBankImage(); var operation = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Unauthorized, (await RegisterWithBankImage(anonymous, input, image, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await RegisterWithBankImage(staff, input, image, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await RegisterWithBankImage(tenant, input, image, Guid.NewGuid())).StatusCode);

        var registered = await RegisterWithBankImage(owner, input, image, operation);
        registered.EnsureSuccessStatusCode();
        var transfer = (await registered.Content.ReadFromJsonAsync<TransferView>())!;
        Assert.StartsWith("MANUAL_IMAGE/", transfer.StatementReference);
        Assert.Equal("PendingReview", transfer.Status);
        Assert.NotNull(transfer.StatementEvidence);
        Assert.Equal(image.Length, transfer.StatementEvidence.Length);
        Assert.Single(storage.Files);
        var detail = await owner.GetStringAsync($"/api/v1/payment-transactions/{transfer.Id}");
        Assert.DoesNotContain("objectKey", detail, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("payments/manual-statements", detail);
        Assert.Equal(image, await owner.GetByteArrayAsync($"/api/v1/payment-transactions/{transfer.Id}/evidence"));
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"/api/v1/payment-transactions/{transfer.Id}/evidence")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"/api/v1/payment-transactions/{transfer.Id}/evidence")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/v1/payment-transactions/{transfer.Id}/evidence")).StatusCode);
        var replay = await RegisterWithBankImage(owner, input, image, operation); replay.EnsureSuccessStatusCode();
        Assert.Equal(transfer.Id, (await replay.Content.ReadFromJsonAsync<TransferView>())!.Id);
        Assert.Single(storage.Files);
        Assert.Equal(HttpStatusCode.Conflict, (await RegisterWithBankImage(owner, input, SyntheticBankImage(true), operation)).StatusCode);
        Assert.Single(storage.Files);
        storage.CorruptRead = true;
        Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync($"/api/v1/payment-transactions/{transfer.Id}/evidence")).StatusCode);
    }

    [Fact]
    public async Task BadScreenshotOrUnreachableStorageCannotCreateVerifiedReceipt()
    {
        var w = await Setup(); using var original = await Client(w.Owner);
        var storage = new SyntheticBankProofStorage();
        var key = fixture.Factory.Services.GetRequiredService<IConfiguration>()["Jwt:SigningKey"];
        await using var host = fixture.Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:SigningKey"] = key }));
            builder.ConfigureTestServices(services => { services.RemoveAll<IObjectStorage>(); services.AddSingleton<IObjectStorage>(storage); });
        });
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization;
        var input = Input(w);
        Assert.Equal(HttpStatusCode.BadRequest, (await RegisterWithBankImage(owner, input, "not-image"u8.ToArray(), Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await RegisterWithBankImage(owner, input, SyntheticBankImage(), Guid.NewGuid(), "image/svg+xml")).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await RegisterWithBankImage(owner, input, new byte[5 * 1024 * 1024 + 1], Guid.NewGuid())).StatusCode);
        storage.FailWrite = true;
        Assert.Equal(HttpStatusCode.InternalServerError, (await RegisterWithBankImage(owner, input, SyntheticBankImage(), Guid.NewGuid())).StatusCode);
        Assert.Empty(storage.Files);
        storage.FailWrite = false;
        var success = await RegisterWithBankImage(owner, input, SyntheticBankImage(), Guid.NewGuid());
        success.EnsureSuccessStatusCode();
        Assert.NotNull((await success.Content.ReadFromJsonAsync<TransferView>())!.StatementEvidence);
    }
}
