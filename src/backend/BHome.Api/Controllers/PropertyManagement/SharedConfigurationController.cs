using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Route("api/v1/shared-configuration/{resource}"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(131072)]
public sealed class SharedConfigurationController(SharedConfigurationService service) : ControllerBase
{
    [HttpGet] public Task<SharedPage> List(string resource, CancellationToken t, [FromQuery] string search = "", [FromQuery] string status = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 20) => service.ListAsync(resource, search, status, page, pageSize, t);
    [HttpGet("{id:guid}")] public Task<SharedDocument> Get(string resource, Guid id, CancellationToken t) => service.GetAsync(resource, id, t);
    [HttpPost] public Task<SharedDocument> Create(string resource, SharedWrite input, CancellationToken t) => service.SaveAsync(resource, null, input, t);
    [HttpPut("{id:guid}")] public Task<SharedDocument> Update(string resource, Guid id, SharedWrite input, CancellationToken t) => service.SaveAsync(resource, id, input, t);
    [HttpPost("{id:guid}/publish")] public Task<SharedDocument> Publish(string resource, Guid id, SharedVersion input, CancellationToken t) => service.TransitionAsync(resource, id, input, false, t);
    [HttpPost("{id:guid}/archive")] public Task<SharedDocument> Archive(string resource, Guid id, SharedVersion input, CancellationToken t) => service.TransitionAsync(resource, id, input, true, t);
    [HttpPost("{id:guid}/restore")] public Task<SharedDocument> Restore(string resource, Guid id, SharedVersion input, CancellationToken t) => service.RestoreAsync(resource, id, input, t);
    [HttpPost("{id:guid}/duplicate")] public Task<SharedDocument> Duplicate(string resource, Guid id, SharedDuplicate input, CancellationToken t) => service.DeriveAsync(resource, id, input, false, t);
    [HttpPost("{id:guid}/versions")] public Task<SharedDocument> Edition(string resource, Guid id, SharedVersion input, CancellationToken t) => service.DeriveAsync(resource, id, new("", input.ExpectedVersion), true, t);
    [HttpGet("{id:guid}/versions")] public Task<IReadOnlyList<SharedDocument>> Versions(string resource, Guid id, CancellationToken t) => service.VersionsAsync(resource, id, t);
    [HttpGet("{id:guid}/history")] public Task<IReadOnlyList<SharedDocument>> History(string resource, Guid id, CancellationToken t) => service.HistoryAsync(resource, id, t);
}
