using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using System.ComponentModel.DataAnnotations;

namespace BHome.IntegrationTests;

// Only added to the test host. These routes do not exist in the shipped API.
[ApiController]
[Route("test-probes")]
public sealed class TestProbeController : ControllerBase
{
    [HttpPost("validation")]
    [AllowAnonymous]
    public IActionResult Validate(ValidationProbe request) => Ok();
    [HttpGet("owner")]
    [Authorize(Policy = Roles.Owner)]
    public IActionResult Owner() => Ok();

    [HttpGet("permission-owner")]
    [Authorize(Policy = Permissions.StaffAccounts.Manage)]
    public IActionResult OwnerPermission() => Ok();

    [HttpGet("permission-staff")]
    [Authorize(Policy = Permissions.MeterReadings.Confirm)]
    public IActionResult StaffPermission() => Ok();

    [HttpGet("permission-tenant")]
    [Authorize(Policy = Permissions.InvoiceAdjustments.Request)]
    public IActionResult TenantPermission() => Ok();

    [HttpGet("permission-shared")]
    [Authorize(Policy = Permissions.Account.ViewOwn)]
    public IActionResult SharedPermission() => Ok();

    [HttpGet("error")]
    [AllowAnonymous]
    public IActionResult Error() => throw new InvalidOperationException("PRIVATE_TEST_DETAIL");

    [HttpGet("property-error/{status:int}")]
    [AllowAnonymous]
    public IActionResult PropertyError(int status) => throw new PropertyException(status, "synthetic_property_rejection");

    [HttpGet("oversized")]
    [AllowAnonymous]
    public IActionResult Oversized() => throw new BadHttpRequestException("PRIVATE_TEST_DETAIL", StatusCodes.Status413PayloadTooLarge);

    [HttpGet("ocr")]
    [AllowAnonymous]
    public async Task<IActionResult> Ocr([FromServices] IOcrService ocr, CancellationToken cancellationToken)
    {
        using var input = new MemoryStream();
        await ocr.ExtractAsync(input, OcrInputKind.IdentityCard, cancellationToken);
        return Ok();
    }
}

public sealed record ValidationProbe([Required, StringLength(10)] string? Name);
