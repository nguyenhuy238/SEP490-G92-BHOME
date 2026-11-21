using System.Security.Cryptography;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application.Contracts;

namespace BHome.DigitalSigning.Application.Services;

// "Ảnh chữ ký": the picture a signer's signature shows on the page. Each signer keeps at most one.
public sealed class SignatureImageService(ICurrentUser user, ISignatureImageStore store, TimeProvider clock)
{
    private const int MaxBytes = 1024 * 1024;
    private const int MinSide = 40;
    private const int MaxSide = 4000;

    public async Task<SignatureImageView> MineAsync(CancellationToken cancellationToken)
        => View(await store.FindAsync(SignerAccess.RequireSigner(user), cancellationToken));

    public async Task<byte[]> ContentAsync(CancellationToken cancellationToken)
        => (await store.FindAsync(SignerAccess.RequireSigner(user), cancellationToken))?.Content
           ?? throw DigitalSigningException.NotFound("ảnh chữ ký");

    // Refuses, in words for the person uploading, a picture that cannot sit over a page.
    public async Task<SignatureImageView> SaveAsync(byte[] content, CancellationToken cancellationToken)
    {
        var owner = SignerAccess.RequireSigner(user);
        if (content.Length == 0) throw DigitalSigningException.Invalid("Chọn một tệp ảnh PNG.");
        if (content.Length > MaxBytes) throw DigitalSigningException.Invalid($"Ảnh lớn hơn {MaxBytes / 1024} KB.");
        if (!PngHeader.IsPng(content)) throw DigitalSigningException.Invalid("Ảnh phải là tệp PNG.");
        var (width, height) = PngHeader.Size(content);
        if (width is < MinSide or > MaxSide || height is < MinSide or > MaxSide)
            throw DigitalSigningException.Invalid(
                $"Mỗi cạnh của ảnh phải từ {MinSide} đến {MaxSide} điểm ảnh (ảnh này {width} × {height}).");
        if (!PngHeader.HasTransparency(content)) throw DigitalSigningException.Invalid("Ảnh phải có nền trong suốt.");

        var image = new SignatureImage(content, width, height, Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant(),
            clock.GetUtcNow());
        await store.SaveAsync(owner, image, cancellationToken);
        return View(image);
    }

    public async Task RemoveAsync(CancellationToken cancellationToken)
        => await store.DeleteAsync(SignerAccess.RequireSigner(user), cancellationToken);

    // Version changes with the picture, so a screen knows when to fetch it again.
    private static SignatureImageView View(SignatureImage? image) => image is null
        ? new SignatureImageView(false, 0, 0, null, null)
        : new SignatureImageView(true, image.Width, image.Height, image.Sha256[..12], image.UpdatedAt);
}
