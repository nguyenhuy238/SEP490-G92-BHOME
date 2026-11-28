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
