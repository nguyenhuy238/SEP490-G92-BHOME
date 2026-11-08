using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.PropertyManagement;

[ApiController, Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(131072)]
public sealed class AssetInventoryController(AssetInventoryService service) : ControllerBase
{
    [HttpGet("api/v1/asset-templates"), Authorize(Roles = Roles.Owner)]
    public Task<IReadOnlyList<SetupDocument>> Templates([FromQuery] Guid locationId, CancellationToken t) => service.ListAsync(locationId, "AssetTemplate", t);
    [HttpGet("api/v1/asset-templates/{id:guid}"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Template(Guid id, CancellationToken t) => service.GetAsync(id, "AssetTemplate", t);
    [HttpPost("api/v1/asset-templates"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Create(AssetTemplateWrite input, CancellationToken t) => service.SaveTemplateAsync(null, input, t);
    [HttpPut("api/v1/asset-templates/{id:guid}/draft"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Update(Guid id, AssetTemplateWrite input, CancellationToken t) => service.SaveTemplateAsync(id, input, t);
    [HttpPost("api/v1/asset-templates/{id:guid}/drafts"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Clone(Guid id, CancellationToken t) => service.CloneTemplateAsync(id, t);
    [HttpPut("api/v1/rooms/{id:guid}/asset-template"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Assign(Guid id, AssetTemplateAssignment input, CancellationToken t) => service.AssignTemplateAsync(id, input, t);
    [HttpPost("api/v1/asset-templates/{id:guid}/publish"), Authorize(Roles = Roles.Owner)]
    public Task<AssetSyncRun> Publish(Guid id, TemplatePublish input, CancellationToken t) => service.PublishAsync(id, input.ExpectedVersion, t);
    [HttpPost("api/v1/asset-templates/{id:guid}/sync"), Authorize(Roles = Roles.Owner)]
    public Task<AssetSyncRun> Sync(Guid id, CancellationToken t) => service.SyncAsync(id, t);
    [HttpGet("api/v1/asset-template-sync-runs/{id:guid}"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> SyncRun(Guid id, CancellationToken t) => service.GetAsync(id, "AssetSyncRun", t);
    [HttpGet("api/v1/assets/{id:guid}/history")]
    public Task<IReadOnlyList<AssetHistoryEntry>> History(Guid id, CancellationToken t) => service.HistoryAsync(id, t);
    [HttpGet("api/v1/rooms/{id:guid}/desired-assets")]
    [HttpGet("api/v1/rooms/{id:guid}/asset-inventory")]
    public Task<AssetInventory> Inventory(Guid id, CancellationToken t) => service.InventoryAsync(id, t);
    [HttpPost("api/v1/rooms/{id:guid}/assets/verify")]
    public async Task<object> Verify(Guid id, AssetVerification input, CancellationToken t) => new { assetId = await service.VerifyAsync(id, input, t) };
    [HttpPut("api/v1/assets/{id:guid}/metadata"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> Metadata(Guid id, AssetMetadataWrite input, CancellationToken t) => service.MetadataAsync(id, input, t);
    [HttpGet("api/v1/assets/{id:guid}/metadata"), Authorize(Roles = Roles.Owner)]
    public Task<SetupDocument> GetMetadata(Guid id, CancellationToken t) => service.ReadMetadataAsync(id, t);
    [HttpPost("api/v1/assets/{id:guid}/replace"), Authorize(Roles = Roles.Owner)]
    public async Task<object> Replace(Guid id, AssetReplacement input, CancellationToken t) => new { assetId = await service.ReplaceAsync(id, input, t) };
}

[ApiController, Route("api/v1"), Authorize(Roles = Roles.Owner)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(131072)]
public sealed class UtilityWorkspaceController(UtilityWorkspaceService service) : ControllerBase
{
    [HttpGet("utility-tariffs")] public Task<IReadOnlyList<SetupDocument>> Tariffs([FromQuery] Guid locationId, CancellationToken t) => service.ListAsync(locationId, "UtilityTariff", t);
    [HttpGet("utility-tariffs/{id:guid}")] public Task<SetupDocument> Tariff(Guid id, CancellationToken t) => service.GetAsync(id, "UtilityTariff", t);
    [HttpPost("utility-tariffs")] public Task<SetupDocument> CreateTariff(UtilityTariffWrite input, CancellationToken t) => service.TariffAsync(input, t);
    [HttpPost("utility-tariffs/{id:guid}/replacement")]
    public Task<SetupDocument> ReplaceTariff(Guid id, UtilityTariffWrite input, CancellationToken t) => service.TariffAsync(input with { ReplacesId = id }, t);
    [HttpGet("utility-source-meters")] public Task<IReadOnlyList<SetupDocument>> Meters([FromQuery] Guid locationId, CancellationToken t) => service.ListAsync(locationId, "UtilitySourceMeter", t);
    [HttpPost("utility-source-meters")] public Task<SetupDocument> Meter(UtilitySourceMeter input, CancellationToken t) => service.SourceMeterAsync(input, t);
    [HttpPost("utility-meter-links")] public Task<SetupDocument> Link(UtilityMeterLink input, CancellationToken t) => service.LinkAsync(input, t);
    [HttpPost("utility-quotas")] public Task<SetupDocument> Quota(UtilityQuotaWrite input, CancellationToken t) => service.QuotaAsync(input, t);
    [HttpGet("utility-quotas")] public Task<IReadOnlyList<SetupDocument>> Quotas([FromQuery] Guid locationId, CancellationToken t) => service.ListAsync(locationId, "UtilityQuota", t);
    [HttpPost("utility-profiles")] public Task<SetupDocument> Profile(UtilityProfileWrite input, CancellationToken t) => service.ProfileAsync(input, t);
    [HttpPost("utility-profiles/{id:guid}/replacement")] public Task<SetupDocument> ReplaceProfile(Guid id, UtilityProfileWrite input, CancellationToken t) => service.ProfileAsync(input with { ReplacesId = id }, t);
    [HttpGet("utility-profiles")] public Task<IReadOnlyList<SetupDocument>> Profiles([FromQuery] Guid locationId, CancellationToken t) => service.ListAsync(locationId, "UtilityProfile", t);
    [HttpPost("utility-source-bills")]
    public Task<SetupDocument> Bill(UtilitySourceBill input, CancellationToken t) => service.SourceBillAsync(input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t);
    [HttpGet("utility-source-bills/{id:guid}")] public Task<SetupDocument> Bill(Guid id, CancellationToken t) => service.GetAsync(id, "UtilitySourceBill", t);
    [HttpGet("utility-source-bills")] public Task<IReadOnlyList<SetupDocument>> Bills([FromQuery] Guid locationId, CancellationToken t) => service.ListAsync(locationId, "UtilitySourceBill", t);
    [HttpPost("utility-reconciliations/preview")] public Task<UtilityReconciliation> Preview(UtilityReconcileInput input, CancellationToken t) => service.PreviewAsync(input, t);
    [HttpPost("utility-reconciliations")] public Task<SetupDocument> Reconcile(UtilityReconcileInput input, CancellationToken t) => service.ReconcileAsync(input, t);
    [HttpGet("utility-reconciliations/{id:guid}")] public Task<SetupDocument> Reconciliation(Guid id, CancellationToken t) => service.GetAsync(id, "UtilityReconciliation", t);
    [HttpPost("utility-reconciliations/{id:guid}/review")]
    public Task<SetupDocument> Review(Guid id, UtilityVarianceReview input, CancellationToken t) => service.ReviewVarianceAsync(id, input, t);
    [HttpPost("utility-period-breakdowns")]
    public Task<SetupDocument> Breakdown(UtilityPeriodBreakdown input, CancellationToken t) => service.PeriodBreakdownAsync(input, t);
}

[ApiController, Route("api/v1/utility-source-readings"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(32768)]
public sealed class UtilitySourceReadingsController(UtilityWorkspaceService service) : ControllerBase
{
    [HttpPost] public Task<SetupDocument> Confirm(UtilitySourceReading input, CancellationToken t) => service.SourceReadingAsync(input, t);
}

[ApiController, Route("api/v1"), Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(65536)]
public sealed class OperatingPoliciesController(OperatingPolicyService service, BHome.Application.Contracts.ContractService contracts) : ControllerBase
{
    [HttpGet("operating-policies"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)] public Task<IReadOnlyList<SetupDocument>> List([FromQuery] Guid locationId, CancellationToken t) => service.ReadPoliciesAsync(locationId, t);
    [HttpGet("operating-policies/{id:guid}"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)] public Task<SetupDocument> Get(Guid id, CancellationToken t) => service.ReadPolicyAsync(id, t);
    [HttpGet("operating-policies/{id:guid}/versions"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
    public async Task<IReadOnlyList<SetupDocument>> Versions(Guid id, CancellationToken t) => await service.ReadPoliciesAsync((await service.ReadPolicyAsync(id, t)).LocationId, t);
    [HttpPost("operating-policies"), Authorize(Roles = Roles.Owner)] public Task<SetupDocument> Create(OperatingPolicyWrite input, CancellationToken t) => service.SaveAsync(null, input, t);
    [HttpPut("operating-policies/{id:guid}/draft"), Authorize(Roles = Roles.Owner)] public Task<SetupDocument> Update(Guid id, OperatingPolicyWrite input, CancellationToken t) => service.SaveAsync(id, input, t);
    [HttpPost("operating-policies/{id:guid}/publish"), Authorize(Roles = Roles.Owner)] public Task<SetupDocument> Publish(Guid id, TemplatePublish input, CancellationToken t) => service.PublishAsync(id, input.ExpectedVersion, t);
    [HttpGet("contracts/{id:guid}/agreed-operating-policy")] public Task<AgreedOperatingPolicy> Agreed(Guid id, CancellationToken t) => service.AgreedAsync(id, t);
    [HttpPost("contracts/{id:guid}/operating-policy-amendments"), Authorize(Roles = Roles.Owner)]
    public async Task<object> Amend(Guid id, PolicyAmendmentInput input, CancellationToken t) => new { contractId = await service.AmendAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t) };
    [HttpPost("contracts/{id:guid}/operating-policy-amendment-cancellation"), Authorize(Roles = Roles.Owner)]
    public Task<BHome.Application.Contracts.ContractView> Cancel(Guid id, PolicyAmendmentCancellation input, CancellationToken t) =>
        contracts.CancelPolicyAmendmentAsync(id, input, Guid.TryParse(Request.Headers["Idempotency-Key"], out var key) ? key : Guid.Empty, t);
}

[ApiController, Route("api/v1/locations/{locationId:guid}/setup-evidence"), Authorize(Roles = Roles.Owner + "," + Roles.Staff)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SetupEvidenceController(SetupEvidenceService service) : ControllerBase
{
    [HttpPost, Consumes("image/png", "image/jpeg"), RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<object> Upload(Guid locationId, CancellationToken t) => new { objectKey = await service.UploadAsync(locationId, Request.Body, t) };
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Download(Guid locationId, Guid id, CancellationToken t)
    {
        var output = new MemoryStream();
        try { var type = await service.CopyAsync(locationId, id, output, t); output.Position = 0; Response.Headers.XContentTypeOptions = "nosniff"; return File(output, type); }
        catch { await output.DisposeAsync(); throw; }
    }
}
