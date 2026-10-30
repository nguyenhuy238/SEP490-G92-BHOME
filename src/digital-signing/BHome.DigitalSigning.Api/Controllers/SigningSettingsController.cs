using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.DigitalSigning.Api.Controllers;

// "Tài khoản ký số": the deployment's Viettel MySign account (address, client_id, profile_id, client_secret).
// A saved change applies to the next call to Viettel.
[ApiController]
[Route("api/v1/digital-signing/settings/viettel")]
[Authorize(Roles = Roles.Owner)]
public sealed class SigningSettingsController(SigningAccountService accounts, ISigningProvider provider) : ControllerBase
{
    // Viettel signs in per signer, so checking the account takes the user_id of one registered signer.
    public sealed record TestRequest(string? UserId);

    [HttpGet]
    public Task<ViettelSettingsView> View(CancellationToken cancellationToken) => accounts.ViewAsync(cancellationToken);

    [HttpPut]
    public Task<ViettelSettingsView> Save(SaveViettelSettings request, CancellationToken cancellationToken)
        => accounts.SaveAsync(request, cancellationToken);

    // "Dùng cấu hình của máy chủ".
    [HttpDelete]
    public Task<ViettelSettingsView> Reset(CancellationToken cancellationToken) => accounts.ResetAsync(cancellationToken);

    [HttpPost("test")]
    public Task<ConnectionTestResult> Test(TestRequest request, CancellationToken cancellationToken)
        => accounts.TestAsync(provider, request.UserId, cancellationToken);
}
