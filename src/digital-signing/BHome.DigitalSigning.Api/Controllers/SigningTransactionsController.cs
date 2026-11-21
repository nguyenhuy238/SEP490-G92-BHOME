using System.ComponentModel.DataAnnotations;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace BHome.DigitalSigning.Api.Controllers;

// Remote signing of one PDF: POST starts it (Viettel pushes a confirmation to the signer's MySign app), then the screen
// GETs the transaction every few seconds; the GET that finds the signature embeds it. The signed PDF is then downloadable.
[ApiController]
[Route("api/v1/digital-signing/transactions")]
[Authorize(Roles = $"{Roles.Owner},{Roles.Staff},{Roles.Tenant}")]
public sealed class SigningTransactionsController(RemoteSigningService signing) : ControllerBase
{
    private const long MaxUploadBytes = 12 * 1024 * 1024;

    // Page/X/Y/Width place the visible box (fractions of the page from its top-left); leave them out to sign invisibly.
    public sealed class StartSigningForm
    {
        [Required] public Guid CertificateId { get; init; }
        [Required] public IFormFile? File { get; init; }
        [MaxLength(200)] public string? Description { get; init; }
        [Range(1, 10_000)] public int? Page { get; init; }
        [Range(0, 1)] public double? X { get; init; }
        [Range(0, 1)] public double? Y { get; init; }
        [Range(0.01, 1)] public double? Width { get; init; }
    }

    [HttpPost]
    [RequestSizeLimit(MaxUploadBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
    public async Task<ActionResult<SigningTransactionView>> Start([FromForm] StartSigningForm form,
        CancellationToken cancellationToken)
    {
        var file = form.File!;
        await using var upload = new MemoryStream();
        await file.CopyToAsync(upload, cancellationToken);
        var placement = form is { Page: { } page, X: { } x, Y: { } y, Width: { } width }
            ? new SignaturePlacement(page, x, y, width)
            : null;
        var started = await signing.StartAsync(
            new StartSigning(form.CertificateId, file.FileName, upload.ToArray(), form.Description, placement),
            cancellationToken);
        return Accepted(started);
    }

    [HttpGet("{id:guid}")]
    public Task<SigningTransactionView> Status(Guid id, CancellationToken cancellationToken)
        => signing.StatusAsync(id, cancellationToken);

    [HttpGet("{id:guid}/document")]
    public async Task<IActionResult> Document(Guid id, CancellationToken cancellationToken)
    {
        var document = await signing.DownloadAsync(id, cancellationToken);
        Response.Headers.CacheControl = "no-store";
        return File(document.Content, "application/pdf", document.FileName);
    }
}
