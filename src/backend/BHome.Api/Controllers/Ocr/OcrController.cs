using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Ocr;

[ApiController]
[Route("api/v1/ocr")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class OcrController(OcrWorkflowService workflow, IConfiguration configuration) : ControllerBase
{
    // Binary body avoids ASP.NET multipart's automatic disk buffering of identity images.
    [HttpPost("identity/{residentId:guid}/{side}")]
    [Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    [Consumes("image/jpeg", "image/png")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<ActionResult<OcrProposal>> Identity(Guid residentId, string side, CancellationToken token)
        => await workflow.IdentityAsync(residentId, side switch
        {
            "front" => OcrDocumentKind.IdentityFront,
            "back" => OcrDocumentKind.IdentityBack,
            _ => throw new OcrInputException("invalid_identity_side")
        }, Request.Body, token);

    [HttpPost("meter-tasks/{taskId:guid}")]
    [Authorize(Roles = Roles.Staff)]
    [Consumes("image/jpeg", "image/png")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<ActionResult<OcrProposal>> Meter(Guid taskId, CancellationToken token)
    {
        if (!configuration.GetValue<bool>("Ocr:MeterRecognitionEnabled")) return NotFound();
        return await workflow.MeterAsync(taskId, Request.Body, token);
    }
}
