using System.ComponentModel.DataAnnotations;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/digital-signing/certificates"), Authorize(Roles = Roles.Owner + "," + Roles.Tenant)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(4096)]
public sealed class ContractSigningCertificatesController(SigningCertificateService service) : ControllerBase
{
    [HttpGet] public Task<IReadOnlyList<CertificateView>> Mine(CancellationToken t) => service.MineAsync(t);
    [HttpPost]
    public async Task<IActionResult> Declare(ContractCertificateInput x, CancellationToken t)
        => StatusCode(201, await service.DeclareAsync(new DeclareCertificate(x.ProviderUserId, x.SerialNumber), t));
    [HttpPost("{id:guid}/lock")]
    public async Task<IActionResult> Lock(Guid id, ContractCertificateLockInput x, CancellationToken t)
    { await service.LockAsync(id, x.Locked, t); return NoContent(); }
}
public sealed record ContractCertificateInput([Required, StringLength(100)] string ProviderUserId, [StringLength(100)] string? SerialNumber);
public sealed record ContractCertificateLockInput(bool Locked);
