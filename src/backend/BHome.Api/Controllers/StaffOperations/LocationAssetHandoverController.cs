using BHome.Application.StaffOperations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.StaffOperations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.StaffOperations;

[ApiController]
[Authorize(Policy = Permissions.OperationalTasks.View)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(65536)]
[Route("api/v1/operational-tasks/{taskId:guid}/location-asset-handover")]
public sealed class LocationAssetHandoverController(LocationAssetHandoverService service) : ControllerBase
{
    [HttpGet]
    public Task<LocationAssetHandoverReportView> Get(Guid taskId, CancellationToken token) =>
        service.GetAsync(taskId, token);

    [HttpPost("approve"), Authorize(Policy = Permissions.OperationalTasks.Verify)]
    public Task<LocationAssetHandoverReportView> Approve(Guid taskId,
        LocationAssetHandoverApprove input, CancellationToken token) =>
        service.ApproveAsync(taskId, input, token);

    [HttpPost("rework"), Authorize(Policy = Permissions.OperationalTasks.Verify)]
    public Task<LocationAssetInventoryView> Rework(Guid taskId,
        LocationAssetHandoverRework input, CancellationToken token) =>
        service.ReworkAsync(taskId, input, token);

    [HttpPost("sign")]
    public Task<LocationAssetHandoverReportView> Sign(Guid taskId,
        LocationAssetHandoverSign input, CancellationToken token) =>
        service.SignAsync(taskId, input, token);

    [HttpGet("document")]
    public async Task<IActionResult> Document(Guid taskId, CancellationToken token)
    {
        var bytes = await service.DocumentAsync(taskId, token);
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "no-store";
        return File(bytes, "application/pdf", $"ban-giao-tai-san-{taskId:N}.pdf");
    }
}
