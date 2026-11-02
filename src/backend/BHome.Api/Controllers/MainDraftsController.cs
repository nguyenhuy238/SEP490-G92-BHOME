using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController, Route("api/v1/contracts/main-drafts"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(32768)]
public sealed class MainDraftsController(MainDraftService service) : ControllerBase
{
    private Guid Key() => Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) && key != Guid.Empty ? key : throw ContractException.Invalid("idempotency_key_required");
    [HttpGet("preparation")]
    public Task<MainDraftPreparation> Prepare(Guid roomId, Guid representativeResidentId, [FromQuery] Guid[] residentIds, DateOnly effectiveOn, CancellationToken t) => service.PrepareAsync(roomId, representativeResidentId, residentIds, effectiveOn, t);
    [HttpGet("settings/{locationId:guid}"), Authorize(Roles = Roles.Owner)]
    public Task<MainContractSettings?> Settings(Guid locationId, CancellationToken t) => service.OwnerSettingsAsync(locationId, t);
    [HttpPut("settings/{locationId:guid}"), Authorize(Roles = Roles.Owner)]
    public async Task<IActionResult> Settings(Guid locationId, MainContractSettingsInput input, CancellationToken t) { await service.SetSettingsAsync(locationId, input, t); return NoContent(); }
    [HttpPost]
    public Task<MainDraftView> Create(MainDraftInput input, CancellationToken t) => service.SaveAsync(null, input, Key(), t);
    [HttpGet("{id:guid}")]
    public Task<MainDraftView> Get(Guid id, CancellationToken t) => service.GetAsync(id, t);
    [HttpPut("{id:guid}")]
    public Task<MainDraftView> Update(Guid id, MainDraftInput input, CancellationToken t) => service.SaveAsync(id, input, Key(), t);
    [HttpPost("{id:guid}/documents")]
    public Task<MainDraftFiles> Generate(Guid id, CancellationToken t) => service.GenerateAsync(id, t);
    [HttpGet("{id:guid}/documents/{fileId:guid}")]
    public async Task<IActionResult> Download(Guid id, Guid fileId, CancellationToken t)
    {
        var buffer = new MemoryStream();
        try { var type = await service.CopyFileAsync(id, fileId, buffer, t); buffer.Position = 0; return File(buffer, type, type == "application/pdf" ? "hop-dong-nhap.pdf" : "hop-dong-nhap.docx"); }
        catch { await buffer.DisposeAsync(); throw; }
    }
}
