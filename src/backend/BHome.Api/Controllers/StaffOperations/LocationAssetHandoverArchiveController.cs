using BHome.Application.StaffOperations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.StaffOperations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.StaffOperations;

[ApiController]
[Authorize(Policy = Permissions.OperationalTasks.View, Roles = Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/location-asset-handovers/archive")]
public sealed class LocationAssetHandoverArchiveController(LocationAssetHandoverService service) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<LocationAssetHandoverArchiveListItem>> List(CancellationToken token) =>
        service.ArchiveAsync(token);

    [HttpGet("{taskId:guid}/revisions/{revision:int}")]
    public Task<LocationAssetHandoverArchiveReportView> Revision(Guid taskId, int revision, CancellationToken token) =>
        service.ArchiveRevisionAsync(taskId, revision, token);

    [HttpGet("{taskId:guid}/revisions/{revision:int}/document")]
    public async Task<IActionResult> Document(Guid taskId, int revision, CancellationToken token)
    {
        var bytes = await service.ArchiveDocumentAsync(taskId, revision, token);
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "no-store";
        return File(bytes, "application/pdf", $"ban-giao-tai-san-{taskId:N}-v{revision}.pdf");
    }
}
