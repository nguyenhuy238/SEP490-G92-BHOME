using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;

namespace BHome.DigitalSigning.UnitTests;

// A stand-in CA: a self-signed RSA certificate whose key signs the digest the way Viettel would (PKCS#1 v1.5, SHA-256).
internal sealed class FakeCa : IDisposable
{
    private readonly RSA key = RSA.Create(2048);

    public FakeCa(string commonName = "Nguyễn Văn A")
    {
        var request = new CertificateRequest($"CN={commonName}, O=BHome Test", key, HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        using var withKey = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        // Only the public certificate leaves the CA, as with Viettel.
        Certificate = new X509Certificate2(withKey.Export(X509ContentType.Cert));
    }

    public X509Certificate2 Certificate { get; }
    public IReadOnlyList<X509Certificate2> Chain => [Certificate];

    public byte[] Sign(byte[] digest) => key.SignHash(digest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

    public void Dispose()
    {
        key.Dispose();
        Certificate.Dispose();
    }
}

internal static class Pdfs
{
    public static byte[] Simple(int pages = 1)
    {
        using var output = new MemoryStream();
        using (var document = new Document(new PdfDocument(new PdfWriter(output))))
        {
            for (var page = 1; page <= pages; page++)
            {
                if (page > 1) document.Add(new AreaBreak());
                document.Add(new Paragraph($"Hop dong thue phong - trang {page}"));
            }
        }
        return output.ToArray();
    }

    public static int SignatureCount(byte[] pdf)
    {
        using var document = new PdfDocument(new PdfReader(new MemoryStream(pdf)));
        return new iText.Signatures.SignatureUtil(document).GetSignatureNames().Count;
    }
}

// Minimal PNG encoder for tests: a solid blue mark on a transparent (RGBA) or white (RGB) ground.
internal static class Pngs
{
    public static byte[] Create(int width, int height, bool transparent = true)
    {
        var channels = transparent ? 4 : 3;
        var raw = new byte[height * (1 + width * channels)];
        for (var y = 0; y < height; y++)
        {
            var row = y * (1 + width * channels);
            for (var x = 0; x < width; x++)
            {
                var inside = x > width / 4 && x < width * 3 / 4 && y > height / 4 && y < height * 3 / 4;
                var pixel = row + 1 + x * channels;
                raw[pixel] = (byte)(inside ? 0 : 255);
                raw[pixel + 1] = (byte)(inside ? 0 : 255);
                raw[pixel + 2] = 255;
                if (transparent) raw[pixel + 3] = (byte)(inside ? 255 : 0);
            }
        }
        using var compressed = new MemoryStream();
        using (var zlib = new System.IO.Compression.ZLibStream(compressed, System.IO.Compression.CompressionLevel.Fastest))
            zlib.Write(raw);

        using var png = new MemoryStream();
        png.Write([0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        var header = new byte[13];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(header, (uint)width);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(4), (uint)height);
        header[8] = 8;
        header[9] = (byte)(transparent ? 6 : 2);
        Chunk(png, "IHDR", header);
        Chunk(png, "IDAT", compressed.ToArray());
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    private static void Chunk(Stream output, string type, byte[] data)
    {
        var length = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(length, (uint)data.Length);
        output.Write(length);
        var typed = System.Text.Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
        output.Write(typed);
        var crc = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(crc, Crc(typed));
        output.Write(crc);
    }

    private static uint Crc(byte[] bytes)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var value in bytes)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++) crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
        }
        return crc ^ 0xFFFFFFFFu;
    }
}

internal sealed class MutableClock(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;
    public override DateTimeOffset GetUtcNow() => Now;
}

// The store as plain memory, with the same conditional moves the EF store makes.
internal sealed class InMemoryStore : IDigitalSigningStore
{
    public Dictionary<Guid, SigningCertificate> Certificates { get; } = [];
    public Dictionary<Guid, SigningTransaction> Transactions { get; } = [];

    public Task<IReadOnlyList<SigningCertificate>> CertificatesOfAsync(Guid ownerUserId, CancellationToken cancellationToken)
        => Task.FromResult<IReadOnlyList<SigningCertificate>>(
            Certificates.Values.Where(certificate => certificate.OwnerUserId == ownerUserId).ToList());

    public Task<SigningCertificate?> CertificateAsync(Guid id, CancellationToken cancellationToken)
        => Task.FromResult(Certificates.GetValueOrDefault(id));

    public Task<SigningCertificate?> CertificateAsync(string provider, string serialNumber, CancellationToken cancellationToken)
        => Task.FromResult(Certificates.Values.SingleOrDefault(
            certificate => certificate.Provider == provider && certificate.SerialNumber == serialNumber));

    public Task AddCertificateAsync(SigningCertificate certificate, CancellationToken cancellationToken)
    {
        Certificates.Add(certificate.Id, certificate);
        return Task.CompletedTask;
    }

    public Task RemoveCertificateAsync(Guid id, CancellationToken cancellationToken)
    {
        Certificates.Remove(id);
        return Task.CompletedTask;
    }

    public Task SetLockedAsync(Guid id, bool locked, CancellationToken cancellationToken)
    {
        Certificates[id].Locked = locked;
        return Task.CompletedTask;
    }

    public Task AddTransactionAsync(SigningTransaction transaction, CancellationToken cancellationToken)
    {
        Transactions.Add(transaction.Id, transaction);
        return Task.CompletedTask;
    }

    public Task<SigningTransaction?> TransactionAsync(Guid id, CancellationToken cancellationToken)
        => Task.FromResult(Transactions.GetValueOrDefault(id));

    public Task SetProviderTransactionAsync(Guid id, string providerTransactionId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        Transactions[id].ProviderTransactionId = providerTransactionId;
        return Task.CompletedTask;
    }

    public Task<bool> MoveAsync(Guid id, SigningTransactionStatus from, SigningTransactionStatus to, string? errorCode,
        string? errorMessage, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var transaction = Transactions[id];
        if (transaction.Status != from) return Task.FromResult(false);
        transaction.Status = to;
        transaction.ErrorCode = errorCode;
        transaction.ErrorMessage = errorMessage;
        transaction.UpdatedAt = now;
        return Task.FromResult(true);
    }

    public Task<bool> CompleteAsync(Guid id, byte[] signedPdf, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var transaction = Transactions[id];
        if (transaction.Status != SigningTransactionStatus.Signing) return Task.FromResult(false);
        transaction.Status = SigningTransactionStatus.Signed;
        transaction.SignedPdf = signedPdf;
        transaction.UpdatedAt = now;
        return Task.FromResult(true);
    }
}
