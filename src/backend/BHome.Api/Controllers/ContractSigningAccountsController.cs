using System.ComponentModel.DataAnnotations;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

// "Ảnh chữ ký" of the signed-in contract signer (Owner or Tenant): a transparent PNG shown above "Ký bởi / Ngày ký"
// in their visible signature. Upload a PNG, or generate one from a typed name.
[ApiController, Route("api/v1/digital-signing/signature-image"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ContractSignatureImageController(SignatureImageService images) : ControllerBase
{
    private const long MaxUploadBytes = 2 * 1024 * 1024;

    [HttpGet] public Task<SignatureImageView> Mine(CancellationToken t) => images.MineAsync(t);

    [HttpGet("content")]
    public async Task<IActionResult> Content(CancellationToken t) => File(await images.ContentAsync(t), "image/png");

    // The PNG itself as the body (Content-Type: image/png), the way web and mobile both send bytes.
    [HttpPut, Consumes("image/png"), RequestSizeLimit(MaxUploadBytes)]
    public async Task<SignatureImageView> Save(CancellationToken t)
    {
        await using var upload = new MemoryStream();
        await Request.Body.CopyToAsync(upload, t);
        return await images.SaveAsync(upload.ToArray(), t);
    }

    [HttpPost("generate"), RequestSizeLimit(4096)]
    public Task<SignatureImageView> Generate(GenerateSignatureInput x, [FromServices] SignaturePictureGenerator generator, CancellationToken t)
        => images.SaveAsync(generator.FromName(x.Name), t);

    // A signature drawn with a finger (mobile) or the mouse (web): the strokes, turned into a transparent PNG here.
    [HttpPost("drawn"), RequestSizeLimit(512 * 1024)]
    public Task<SignatureImageView> Drawn(DrawnSignatureInput x, [FromServices] SignaturePictureGenerator generator, CancellationToken t)
        => images.SaveAsync(generator.FromStrokes(x), t);

    [HttpDelete]
    public async Task<IActionResult> Remove(CancellationToken t) { await images.RemoveAsync(t); return NoContent(); }
}
public sealed record GenerateSignatureInput([Required, StringLength(60, MinimumLength = 2)] string Name);

// "Tài khoản ký số Viettel MySign" of the deployment, saved by the Owner over the server configuration.
// The client secret is stored encrypted (AES-256-GCM) and only its last four characters are ever returned.
[ApiController, Route("api/v1/digital-signing/settings/viettel"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(8192), ViettelMySignEnabled]
public sealed class ContractSigningSettingsController(SigningAccountService accounts, ISigningProvider provider) : ControllerBase
{
    [HttpGet] public Task<ViettelSettingsView> View(CancellationToken t) => accounts.ViewAsync(t);

    [HttpPut]
    public async Task<ViettelSettingsView> Save(SaveViettelSettings x, CancellationToken t)
    {
        try { return await accounts.SaveAsync(x, t); }
        catch (InvalidOperationException e) when (e.Message.Contains("SecretKey", StringComparison.Ordinal))
        {
            throw new DigitalSigningException(DigitalSigningError.ProviderUnavailable,
                "Máy chủ chưa cấu hình DigitalSigning__SecretKey (ít nhất 32 ký tự) nên chưa lưu được client secret.");
        }
    }

    // "Dùng cấu hình của máy chủ": forget the saved values.
    [HttpDelete] public Task<ViettelSettingsView> Reset(CancellationToken t) => accounts.ResetAsync(t);

    // Logs in to Viettel as one subscriber; signs nothing and sends nothing to the phone.
    [HttpPost("test")]
    public Task<ConnectionTestResult> Test(SigningConnectionTestInput x, CancellationToken t) => accounts.TestAsync(provider, x.UserId, t);
}
public sealed record SigningConnectionTestInput([StringLength(100)] string? UserId);
