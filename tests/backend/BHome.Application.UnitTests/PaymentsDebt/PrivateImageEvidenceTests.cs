using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using NSubstitute;

namespace BHome.Application.UnitTests.PaymentsDebt;

public sealed class PrivateImageEvidenceTests
{
    private sealed class FakeStorage : IObjectStorage
    {
        public readonly Dictionary<string, byte[]> Objects = [];
        public bool Corrupt;
        public async Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken t)
        {
            using var bytes = new MemoryStream();
            await content.CopyToAsync(bytes, t);
            Objects[key] = bytes.ToArray();
        }
        public Task CopyToAsync(string key, Stream output, CancellationToken t) =>
            output.WriteAsync(Corrupt ? new byte[] { 0 } : Objects[key], t).AsTask();
        public Task DeleteAsync(string key, CancellationToken t) { Objects.Remove(key); return Task.CompletedTask; }
    }

    [Fact]
    public async Task SharedReadUsesImageValidatorAndComputesStableSha256()
    {
        var validator = Substitute.For<IContractImageValidator>();
        var bytes = new byte[] { 137, 80, 78, 71, 1, 2, 3, 4 };
        validator.Validate(Arg.Any<byte[]>()).Returns("image/png");
        var image = await PrivateImageEvidence.ReadValidatedAsync(new MemoryStream(bytes), validator, default);
        Assert.Equal("image/png", image.ContentType);
        Assert.Equal(bytes.Length, image.Length);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)), image.Sha256);
        validator.Received(1).Validate(Arg.Is<byte[]>(content => content.SequenceEqual(bytes)));
    }

    [Fact]
    public async Task SharedReadRejectsOversizedImageBeforeValidatingOrStoring()
    {
        var validator = Substitute.For<IContractImageValidator>();
        var bytes = new byte[PrivateImageEvidence.MaximumBytes + 1];
        await Assert.ThrowsAsync<PrivateImageTooLargeException>(() =>
            PrivateImageEvidence.ReadValidatedAsync(new MemoryStream(bytes), validator, default));
        validator.DidNotReceiveWithAnyArgs().Validate(default!);
    }

    [Fact]
    public async Task SharedWriteAndReadRecheckShaAndNeverReturnTamperedBytes()
    {
        var validator = Substitute.For<IContractImageValidator>();
        validator.Validate(Arg.Any<byte[]>()).Returns("image/jpeg");
        var file = await PrivateImageEvidence.ReadValidatedAsync(new MemoryStream([255, 216, 255, 1, 2]), validator, default);
        var storage = new FakeStorage();
        await PrivateImageEvidence.PutVerifiedAsync(storage, "private/test", file, default);
        using var original = new MemoryStream();
        await PrivateImageEvidence.CopyVerifiedAsync(storage, "private/test", file.Length, file.Sha256, original, default);
        Assert.Equal(file.Bytes, original.ToArray());
        storage.Corrupt = true;
        using var leaked = new MemoryStream();
        await Assert.ThrowsAsync<PrivateImageIntegrityException>(() =>
            PrivateImageEvidence.CopyVerifiedAsync(storage, "private/test", file.Length, file.Sha256, leaked, default));
        Assert.Equal(0, leaked.Length);
    }
}
