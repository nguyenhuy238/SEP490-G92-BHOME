using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(1048576)]
public sealed class LocationSetupController(LocationSetupService service) : ControllerBase
{
    private Guid RequestKey() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty;
    [HttpGet("api/v1/location-setup/source/{locationId:guid}")]
    public Task<LocationSetupSource> Source(Guid locationId, CancellationToken t) => service.SourceAsync(locationId, t);
    [HttpPost("api/v1/location-setup")]
    public Task<LocationSetupResult> Complete(LocationSetupInput input, CancellationToken t) => service.CompleteAsync(input, RequestKey(), t);
    [HttpPost("api/v1/locations/{locationId:guid}/room-defaults")]
    public Task<SetupDocument> CreateDefaults(Guid locationId, LocalRoomDefaultsWrite input, CancellationToken t) => service.SaveRoomDefaultsAsync(locationId, null, input, t);
    [HttpPut("api/v1/locations/{locationId:guid}/room-defaults/{id:guid}")]
    public Task<SetupDocument> UpdateDefaults(Guid locationId, Guid id, LocalRoomDefaultsWrite input, CancellationToken t) => service.SaveRoomDefaultsAsync(locationId, id, input, t);
    [HttpGet("api/v1/locations/{locationId:guid}/room-defaults/{id:guid}/history")]
    public Task<IReadOnlyList<SetupDocument>> DefaultsHistory(Guid locationId, Guid id, CancellationToken t) => service.DefaultsHistoryAsync(locationId, id, t);
    [HttpGet("api/v1/locations/{locationId:guid}/room-provenance")]
    public Task<IReadOnlyList<SetupDocument>> RoomProvenance(Guid locationId, CancellationToken t) => service.RoomProvenanceAsync(locationId, t);
    [HttpPost("api/v1/locations/{locationId:guid}/configured-rooms")]
    public Task<BulkRoomResult> CreateRooms(Guid locationId, ConfiguredRoomsInput input, CancellationToken t) => service.CreateConfiguredRoomsAsync(locationId, input, RequestKey(), t);
    [HttpGet("api/v1/locations/{locationId:guid}/setup-metadata")]
    public async Task<ActionResult<SetupDocument?>> Metadata(Guid locationId, CancellationToken t) => new JsonResult(await service.MetadataAsync(locationId, t));
    [HttpPut("api/v1/locations/{locationId:guid}/setup-metadata")]
    public Task<SetupDocument> UpdateMetadata(Guid locationId, LocationMetadataWrite input, CancellationToken t) => service.UpdateMetadataAsync(locationId, input, t);
}
