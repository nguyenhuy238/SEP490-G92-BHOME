using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace BHome.DigitalSigning.Api.Controllers;

// "Ảnh chữ ký" of the signed-in signer: a transparent PNG drawn where they place their signature.
[ApiController]
[Route("api/v1/digital-signing/signature-image")]
[Authorize(Roles = $"{Roles.Owner},{Roles.Staff},{Roles.Tenant}")]
public sealed class SignatureImageController(SignatureImageService images) : ControllerBase
{
    private const long MaxUploadBytes = 2 * 1024 * 1024;

    [HttpGet]
    public Task<SignatureImageView> Mine(CancellationToken cancellationToken) => images.MineAsync(cancellationToken);

    [HttpGet("content")]
    public async Task<IActionResult> Content(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return File(await images.ContentAsync(cancellationToken), "image/png");
    }

    [HttpPut]
    [RequestSizeLimit(MaxUploadBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
    public async Task<SignatureImageView> Save(IFormFile file, CancellationToken cancellationToken)
    {
        await using var upload = new MemoryStream();
        await file.CopyToAsync(upload, cancellationToken);
        return await images.SaveAsync(upload.ToArray(), cancellationToken);
    }

    [HttpDelete]
    public async Task<IActionResult> Remove(CancellationToken cancellationToken)
    {
        await images.RemoveAsync(cancellationToken);
        return NoContent();
    }
}
