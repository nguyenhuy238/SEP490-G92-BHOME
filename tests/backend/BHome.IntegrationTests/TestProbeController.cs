using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Application.Common;
using BHome.Application.Storage;
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
    [HttpPost("staff-validation"), AllowAnonymous]
    public IActionResult ValidateStaff(BHome.Application.Operations.StaffCreate request) => Ok();
    [HttpPost("ocr-invalid-side"), AllowAnonymous]
    public Task<ActionResult<OcrProposal>> InvalidOcrSide(CancellationToken token) =>
        new BHome.Api.Controllers.Ocr.OcrController(null!, new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build()) { ControllerContext = ControllerContext }
            .Identity(Guid.NewGuid(), "unsupported", token);
    [HttpGet("ocr-input/{code}"), AllowAnonymous]
    public IActionResult OcrInput(string code) => throw new OcrInputException(code);
    [HttpGet("ocr-workflow-state"), AllowAnonymous]
    public IActionResult OcrState() => throw new OcrWorkflowStateException();
    [HttpGet("signing-error/{error}"), AllowAnonymous]
    public IActionResult SigningError(BHome.DigitalSigning.Application.DigitalSigningError error) =>
        throw new BHome.DigitalSigning.Application.DigitalSigningException(error,
            error == BHome.DigitalSigning.Application.DigitalSigningError.Invalid
                ? "Ảnh phải có nền trong suốt." : "PRIVATE_TEST_DETAIL");
    [HttpGet("capture-account-error/{known:bool}"), AllowAnonymous]
    public IActionResult CaptureAccountError(bool known) => throw BHome.Infrastructure.Ocr.CaptureRepository.AccountValidationFailure(
        known ? ["DuplicateEmail", "PasswordTooShort"] : ["PRIVATE_TEST_DETAIL synthetic@example.invalid"]);
    [HttpGet("rate-limited"), AllowAnonymous, Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("Auth")]
    public IActionResult RateLimited() => Ok();
    [HttpGet("stale-data"), AllowAnonymous]
    public IActionResult StaleData() => throw new Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException("PRIVATE_TEST_DETAIL");
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

    [HttpGet("private-object-missing")]
    [AllowAnonymous]
    public IActionResult PrivateObjectMissing() => throw new PrivateObjectNotFoundException();

    [HttpGet("unrelated-file-missing")]
    [AllowAnonymous]
    public IActionResult UnrelatedFileMissing() => throw new FileNotFoundException("PRIVATE_TEST_DETAIL");

    [HttpGet("private-storage-unavailable")]
    [AllowAnonymous]
    public IActionResult PrivateStorageUnavailable() => throw new IntegrationUnavailableException("PRIVATE_TEST_DETAIL");

    [HttpGet("schema-error/{state}/{wrapped:bool}")]
    [AllowAnonymous]
    public IActionResult SchemaError(string state, bool wrapped, string? constraintName = null)
    {
        var error = new Npgsql.PostgresException("PRIVATE_TEST_DETAIL", "ERROR", "ERROR", state, constraintName: constraintName);
        throw wrapped ? new Microsoft.EntityFrameworkCore.DbUpdateException("PRIVATE_TEST_DETAIL", error) : error;
    }

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
