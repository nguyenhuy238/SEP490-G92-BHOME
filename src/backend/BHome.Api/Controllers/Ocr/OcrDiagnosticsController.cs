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
    public async Task<IActionResult> Extract(string profile, CancellationToken token)
    {
        if (!Enabled) return NotFound();
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
        var elapsed = Stopwatch.StartNew();
        var proposal = await ocr.ExtractAsync(Request.Body, kind.Value, token);
        return Ok(new { proposal, elapsedMilliseconds = elapsed.ElapsedMilliseconds });
    }
}
