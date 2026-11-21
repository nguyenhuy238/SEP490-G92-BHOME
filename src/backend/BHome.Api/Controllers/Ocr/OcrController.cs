using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.Ocr;

[ApiController]
[Route("api/v1/ocr")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class OcrController(OcrWorkflowService workflow) : ControllerBase
{
    // Binary body avoids ASP.NET multipart's automatic disk buffering of identity images.
    [HttpPost("identity/{residentId:guid}/{side}")]
    [Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    [Consumes("image/jpeg", "image/png")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public Task<ActionResult<OcrProposal>> Identity(Guid residentId, string side, CancellationToken token)
        => Execute(() => workflow.IdentityAsync(residentId, side switch
        {
            "front" => OcrDocumentKind.IdentityFront,
            "back" => OcrDocumentKind.IdentityBack,
            _ => throw new OcrInputException("invalid_identity_side")
        }, Request.Body, token));

    [HttpPost("meter-tasks/{taskId:guid}")]
    [Authorize(Roles = Roles.Staff)]
    [Consumes("image/jpeg", "image/png")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public Task<ActionResult<OcrProposal>> Meter(Guid taskId, CancellationToken token)
        => Execute(() => workflow.MeterAsync(taskId, Request.Body, token));

    private async Task<ActionResult<OcrProposal>> Execute(Func<Task<OcrProposal>> action)
    {
        try { return Ok(await action()); }
        catch (OcrInputException ex)
        {
            return Problem(statusCode: ex.Code == "image_too_large" ? 413 : 400,
                title: "Ảnh không hợp lệ. Vui lòng chụp lại hoặc nhập thủ công.");
        }
        catch (OcrAccessException) { return Problem(statusCode: 404, title: "Không tìm thấy tài nguyên."); }
        catch (OcrWorkflowStateException) { return Problem(statusCode: 409, title: "Tác vụ không cho phép ghi nhận dữ liệu."); }
    }
}
