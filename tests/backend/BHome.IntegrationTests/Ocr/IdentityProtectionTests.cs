using System.Security.Cryptography;
using System.Text;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Ocr;

public sealed class IdentityProtectionTests
{
    private static IdentityProtectionOptions Keys() => new()
    {
        ActiveEncryptionVersion = "v2",
        ActiveHmacVersion = "h1",
        EncryptionKeys = new() { ["v1"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), ["v2"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) },
        HmacKeys = new() { ["h1"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) }
    };

    [Fact]
    public void RoundTripUsesRandomNonceAndAuthenticatedScope()
    {
        var service = new IdentityProtection(Options.Create(Keys()));
        var scope = new IdentityProtectionScope(Guid.NewGuid(), Guid.NewGuid());
        var plain = Encoding.UTF8.GetBytes("{\"fullName\":\"NGƯỜI KIỂM THỬ\",\"dateOfBirth\":\"2000-01-01\"}");
        var first = service.Encrypt(plain, scope); var second = service.Encrypt(plain, scope);
        Assert.Equal(plain, service.Decrypt(first, scope));
        Assert.NotEqual(first.Nonce, second.Nonce); Assert.NotEqual(first.Ciphertext, second.Ciphertext);
        Assert.DoesNotContain("2000-01-01", first.Ciphertext);
        Assert.ThrowsAny<CryptographicException>(() => service.Decrypt(first, scope with { ResidentId = Guid.NewGuid() }));
        Assert.ThrowsAny<CryptographicException>(() => service.Decrypt(first, scope with { OwnerId = Guid.NewGuid() }));
        var cipher = Convert.FromBase64String(first.Ciphertext); cipher[0] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => service.Decrypt(first with { Ciphertext = Convert.ToBase64String(cipher) }, scope));
        var tag = Convert.FromBase64String(first.Tag); tag[0] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => service.Decrypt(first with { Tag = Convert.ToBase64String(tag) }, scope));
        Assert.ThrowsAny<CryptographicException>(() => service.Decrypt(first with { KeyVersion = "v1" }, scope));
    }

    [Fact]
    public void RotationKeepsOldDecryptionAndScopedDeterministicMatching()
    {
        var settings = Keys(); settings.ActiveEncryptionVersion = "v1";
        var service = new IdentityProtection(Options.Create(settings));
        var scope = new IdentityProtectionScope(Guid.NewGuid(), Guid.NewGuid());
        var plain = Encoding.UTF8.GetBytes("{\"citizenIdentityNumber\":\"000000000000\"}");
        var old = service.Encrypt(plain, scope);
        settings.ActiveEncryptionVersion = "v2";
        Assert.Equal(plain, service.Decrypt(old, scope));
        Assert.Equal("v2", service.Encrypt(plain, scope).KeyVersion);
        var digest = service.CreateMatchIndex("000000000000", scope.OwnerId);
        Assert.Equal(digest, service.CreateMatchIndex(" 000000000000 ", scope.OwnerId));
        Assert.NotEqual(digest, service.CreateMatchIndex("000000000000", Guid.NewGuid()));
        Assert.Throws<ArgumentException>(() => service.CreateMatchIndex("００００００００００００", scope.OwnerId));
        Assert.Throws<ArgumentException>(() => service.CreateMatchIndex("000-000000000", scope.OwnerId));
    }

    [Fact]
    public void MissingWeakAndReusedKeysAreRejected()
    {
        var scope = new IdentityProtectionScope(Guid.NewGuid(), Guid.NewGuid());
        var settings = Keys(); settings.EncryptionKeys["v2"] = settings.HmacKeys["h1"];
        var service = new IdentityProtection(Options.Create(settings));
        Assert.Throws<InvalidOperationException>(() => service.Encrypt("{}"u8, scope));
        Assert.Throws<InvalidOperationException>(() => service.CreateMatchIndex("000000000000", scope.OwnerId));
        settings.EncryptionKeys["v2"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        Assert.Throws<InvalidOperationException>(() => service.Encrypt("{}"u8, scope));
        settings.ActiveEncryptionVersion = "missing";
        Assert.Throws<InvalidOperationException>(() => service.Encrypt("{}"u8, scope));
    }
}
