using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner), Route("api/v1")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LocationLegalRecordsController(LocationLegalRecordService service) : ControllerBase
{
    [HttpGet("locations/{location:guid}/legal-records")]
    public Task<SetupPage> List(Guid location, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken t = default) => service.RecordsAsync(location, page, pageSize, t);

    [HttpPut("locations/{location:guid}/legal-records/{id:guid}"), Consumes("multipart/form-data"), RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<SetupDocument> Save(Guid location, Guid id, [FromForm] string documentType, [FromForm] string name,
        [FromForm] DateOnly issuedOn, [FromForm] DateOnly? expiresOn, [FromForm] string? number, [FromForm] string? issuer,
        [FromForm] string? note, [FromForm] string status, [FromForm] int expectedVersion, IFormFile? file, CancellationToken t)
    {
        await using var stream = file?.OpenReadStream();
        return await service.SaveAsync(location, id, new(documentType, name, number, issuer, issuedOn, expiresOn, note, status, expectedVersion), stream, t);
    }

    [HttpGet("location-legal-records/{id:guid}/versions")]
    public Task<IReadOnlyList<SetupDocument>> Versions(Guid id, CancellationToken t) => service.VersionsAsync(id, t);

    [HttpGet("location-legal-records/{id:guid}/versions/{version:int}/file")]
    public async Task<IActionResult> FileVersion(Guid id, int version, CancellationToken t)
    {
        var buffer = new MemoryStream();
        try
        {
            var type = await service.CopyAsync(id, version, buffer, t); buffer.Position = 0;
            Response.Headers.XContentTypeOptions = "nosniff";
            Response.Headers.ContentSecurityPolicy = "sandbox";
            return File(buffer, type, $"document-v{version}" + (type == "application/pdf" ? ".pdf" : type == "image/png" ? ".png" : ".jpg"));
        }
        catch { await buffer.DisposeAsync(); throw; }
    }
}
