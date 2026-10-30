using System.Diagnostics;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Ocr;

// A development harness, with no Resident/Task access or persistence. Business OCR keeps its scope checks.
[ApiController, Route("api/v1/ocr/diagnostics")]
[Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class OcrDiagnosticsController(
    IWebHostEnvironment environment, IConfiguration configuration, IOcrService ocr) : ControllerBase
{
    private bool Enabled => environment.IsDevelopment() && configuration.GetValue<bool>("MobileDevelopment:Enabled");

    [HttpGet]
    public IActionResult Availability() => Enabled ? Ok(new { available = true }) : NotFound();

    [HttpPost("{profile}")]
    [Consumes("image/jpeg", "image/png")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<IActionResult> Extract(string profile, [FromQuery] string? decimalPlaces, CancellationToken token)
    {
        if (!Enabled) return NotFound();
        if (decimalPlaces is not null && (Request.Query["decimalPlaces"].Count != 1 || decimalPlaces.Length != 1 || decimalPlaces[0] is < '0' or > '4'))
            throw new OcrInputException("invalid_meter_precision");
        int? precision = decimalPlaces is null ? null : decimalPlaces[0] - '0';
        var kind = profile switch
        {
            "identity-front" => OcrDocumentKind.IdentityFront,
            "identity-back" => OcrDocumentKind.IdentityBack,
            "electricity-mechanical" => OcrDocumentKind.MechanicalElectricity,
            "electricity-digital" => OcrDocumentKind.DigitalElectricity,
            "water-mechanical" => OcrDocumentKind.MechanicalWater,
            "water-digital" => OcrDocumentKind.DigitalWater,
            _ => (OcrDocumentKind?)null
        };
        if (kind is null) throw new OcrInputException("unsupported_profile");
        if (decimalPlaces is not null && kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack)
            throw new OcrInputException("invalid_meter_precision");
        var elapsed = Stopwatch.StartNew();
        var proposal = await ocr.ExtractAsync(Request.Body, kind.Value, token);
        if (kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
            proposal = MeterReadingPrecision.Apply(proposal, precision);
        return Ok(new { proposal, elapsedMilliseconds = elapsed.ElapsedMilliseconds });
    }
}
