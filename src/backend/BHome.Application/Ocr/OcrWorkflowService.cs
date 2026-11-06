using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Ocr;

public sealed record OcrWorkflowResource(ResourceScope Scope, bool CanCapture, OcrDocumentKind? Kind,
    int? DecimalPlaces = null, decimal? PreviousConfirmedValue = null);

// Implement against real Resident/Task/Meter/Location records when those modules exist.
// A caller-provided Location/Owner ID must never be used to manufacture this scope.
public interface IOcrWorkflowResources
{
    Task<OcrWorkflowResource?> FindIdentityAsync(Guid residentId, CancellationToken cancellationToken);
    Task<OcrWorkflowResource?> FindMeterTaskAsync(Guid taskId, CancellationToken cancellationToken);
    Task RecordMeterProposalAsync(Guid taskId, OcrProposal proposal, CancellationToken token) => Task.CompletedTask;
}

public sealed class OcrAccessException : Exception;
public sealed class OcrWorkflowStateException : Exception;

public sealed class OcrWorkflowService(IOcrWorkflowResources resources, ResourceAccess access, IOcrService ocr)
{
    public async Task<OcrProposal> IdentityAsync(Guid residentId, OcrDocumentKind side, Stream input, CancellationToken token)
    {
        if (side is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
            throw new OcrInputException("invalid_identity_side");
        var resource = await resources.FindIdentityAsync(residentId, token);
        await AuthorizeAsync(resource, [Roles.Owner, Roles.Staff], token);
        return await ocr.ExtractAsync(input, side, token);
    }

    public async Task<OcrProposal> MeterAsync(Guid taskId, Stream input, CancellationToken token)
    {
        var resource = await resources.FindMeterTaskAsync(taskId, token);
        await AuthorizeAsync(resource, [Roles.Staff], token);
        if (resource!.Kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack)
            throw new OcrWorkflowStateException();
        // Missing/invalid server metadata must not silently choose a digital or
        // electricity reader. Do not consume the image for an unsupported task.
        var metadataWarning = resource.Kind is null || !Enum.IsDefined(resource.Kind.Value) ? "meter_profile_unavailable" :
            resource.DecimalPlaces is < 0 or > 4 ? "invalid_meter_precision" :
            resource.PreviousConfirmedValue is < 0 ? "invalid_previous_reading" : null;
        if (metadataWarning is not null)
        {
            var fallback = new OcrProposal(new Dictionary<string, string>(), "metadata-validation-v1")
            { IsFallback = true, MissingFields = ["reading"], Warnings = [metadataWarning] };
            // Clear an earlier proposal as well; it must not survive a failed retake.
            await resources.RecordMeterProposalAsync(taskId, fallback, token);
            return fallback;
        }
        var proposal = await ocr.ExtractAsync(input, resource.Kind!.Value, token);
        proposal = MeterReadingPrecision.Apply(proposal, resource.DecimalPlaces);
        if (proposal.ProposedFields.TryGetValue("reading", out var reading) &&
            decimal.TryParse(reading, System.Globalization.NumberStyles.AllowDecimalPoint,
                System.Globalization.CultureInfo.InvariantCulture, out var value) &&
            resource.PreviousConfirmedValue is { } previous && value < previous)
            proposal = proposal with { Warnings = [.. proposal.Warnings, "reading_below_previous"] };
        await resources.RecordMeterProposalAsync(taskId, proposal, token);
        return proposal;
    }

    private async Task AuthorizeAsync(OcrWorkflowResource? resource, string[] roles, CancellationToken token)
    {
        if (resource is null || !await access.CanAccessAsync(resource.Scope, roles, token)) throw new OcrAccessException();
        if (!resource.CanCapture) throw new OcrWorkflowStateException();
    }
}
