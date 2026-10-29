using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.IncidentMaintenance.Services;

namespace BHome.Api.Controllers.IncidentMaintenance;

internal static class Photos
{
    // 5 photos x 5 MB plus form fields (NFR Report Upload). Larger bodies get 413.
    public const long MaxBody = MaintenanceEvidence.MaxFiles * (long)MaintenanceEvidence.MaxBytes + 64 * 1024;

    // The service validates count, size and image signature; the client file name/type are ignored.
    public static IReadOnlyList<EvidenceUpload> From(IEnumerable<IFormFile>? files) =>
        files?.Select(f => new EvidenceUpload(f.OpenReadStream(), f.Length)).ToArray() ?? [];
}
