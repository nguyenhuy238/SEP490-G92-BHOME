using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.DigitalSigning.Application.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace BHome.DigitalSigning.Api.Controllers;

// A signer's own Viettel MySign certificates. A certificate signs only for the user who declared it.
[ApiController]
[Route("api/v1/digital-signing/certificates")]
[Authorize(Roles = $"{SigningRoles.Owner},{SigningRoles.Staff},{SigningRoles.Tenant}")]
public sealed class SigningCertificatesController(SigningCertificateService certificates) : ControllerBase
{
    public sealed record LockRequest(bool Locked);

    [HttpGet]
    public Task<IReadOnlyList<CertificateView>> Mine(CancellationToken cancellationToken)
        => certificates.MineAsync(cancellationToken);

    [HttpPost]
    public async Task<ActionResult<CertificateView>> Declare(DeclareCertificate request, CancellationToken cancellationToken)
        => StatusCode(StatusCodes.Status201Created, await certificates.DeclareAsync(request, cancellationToken));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Remove(Guid id, CancellationToken cancellationToken)
    {
        await certificates.RemoveAsync(id, cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:guid}/lock")]
    public async Task<IActionResult> Lock(Guid id, LockRequest request, CancellationToken cancellationToken)
    {
        await certificates.LockAsync(id, request.Locked, cancellationToken);
        return NoContent();
    }
}
