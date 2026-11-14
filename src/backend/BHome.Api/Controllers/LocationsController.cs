using System.ComponentModel.DataAnnotations;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

[ApiController]
[Route("api/v1/locations")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[RequestSizeLimit(32768)]
public sealed class LocationsController(ICurrentUser currentUser, ILocationAssignments locations, PropertyService properties, TimeProvider clock) : ControllerBase
{
    [HttpPost]
    [Authorize(Policy = Permissions.Locations.Manage)]
    public async Task<ActionResult<LocationDto>> Create(LocationWrite request,
        CancellationToken cancellationToken)
    {
        var created = await properties.SaveLocationAsync(null, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet]
    [Authorize(Policy = Permissions.Property.View)]
    public Task<PagedResult<LocationDto>> List([FromQuery] LocationQuery query, CancellationToken cancellationToken) =>
        properties.LocationsAsync(query, cancellationToken);

    [HttpGet("{id:guid}"), Authorize(Policy = Permissions.Property.View)]
    public Task<LocationDto> Get(Guid id, CancellationToken t) => properties.GetLocationAsync(id, t);

    [HttpGet("{id:guid}/occupancy-summary"), Authorize(Policy = Permissions.Property.View)]
    public Task<OccupancySummaryDto> OccupancySummary(Guid id, [FromQuery] OccupancySummaryQuery query,
        CancellationToken t) => properties.OccupancySummaryAsync(id, query, t);

    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<LocationDto> Update(Guid id, LocationWrite input, CancellationToken t) => properties.SaveLocationAsync(id, input, t);

    [HttpGet("{id:guid}/closure-check"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<LocationClosureCheck> ClosureCheck(Guid id, CancellationToken t) => properties.ClosureCheckAsync(id, t);
    [HttpGet("{id:guid}/staff-change-preview"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<StaffChangePreview> StaffChangePreview(Guid id, CancellationToken t) => properties.StaffChangePreviewAsync(id, t);

    [HttpGet("assigned-to-me")]
    [Authorize(Policy = Permissions.Locations.ViewAssigned)]
    public async Task<ActionResult<IReadOnlyList<LocationSummary>>> ListAssigned(CancellationToken cancellationToken) =>
        Ok(await locations.ListAssignedLocationsAsync(UserId, VietnamToday(), cancellationToken));

    private Guid UserId => currentUser.UserId ?? throw new InvalidOperationException("Authenticated user is unavailable.");

    private DateOnly VietnamToday() => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTime(clock.GetUtcNow(),
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
}

[ApiController]
[Route("api/v1/staff-location-assignments")]
public sealed class StaffLocationAssignmentsController(ICurrentUser currentUser, ILocationAssignments locations)
    : ControllerBase
{
    [HttpPost]
    [Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<StaffAssignmentSummary>> Assign(CreateStaffAssignmentRequest request,
        CancellationToken cancellationToken)
    {
        if (request.LocationId == Guid.Empty)
            ModelState.AddModelError("locationId", "Location ID is required.");
        if (request.StaffUserId == Guid.Empty)
            ModelState.AddModelError("staffUserId", "Staff user ID is required.");
        if (request.StartDate > request.EndDate)
            ModelState.AddModelError("endDate", "End date must be on or after start date.");
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        var result = await locations.CreateAssignmentAsync(UserId, request.LocationId, request.StaffUserId,
            request.StartDate, request.EndDate, cancellationToken);
        return result.Status switch
        {
            CreateAssignmentStatus.Created => CreatedAtAction(nameof(ListAssignments),
                new { locationId = request.LocationId }, result.Assignment),
            CreateAssignmentStatus.InvalidDateRange => ValidationProblem(),
            CreateAssignmentStatus.LocationNotFound => NotFound(),
            CreateAssignmentStatus.StaffUnavailable => Problem(statusCode: 400,
                title: "Staff is unavailable."),
            CreateAssignmentStatus.DateRangeOverlaps => Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "The Location already has a Staff assignment during this date range."
            }),
            _ => throw new InvalidOperationException("Unsupported assignment result.")
        };
    }

    [HttpGet]
    [Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<IReadOnlyList<StaffAssignmentSummary>>> ListAssignments(
        [FromQuery] Guid locationId, CancellationToken cancellationToken)
    {
        if (locationId == Guid.Empty)
        {
            ModelState.AddModelError("locationId", "Location ID is required.");
            return ValidationProblem(ModelState);
        }
        var assignments = await locations.ListAssignmentsAsync(locationId, cancellationToken);
        return assignments is null ? NotFound() : Ok(assignments);
    }

    [HttpGet("by-staff")]
    [Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<IReadOnlyList<StaffAssignmentDetail>>> ListStaffAssignments(
        [FromQuery] Guid staffUserId, CancellationToken cancellationToken)
    {
        if (staffUserId == Guid.Empty)
        {
            ModelState.AddModelError("staffUserId", "Staff user ID is required.");
            return ValidationProblem(ModelState);
        }
        return Ok(await locations.ListStaffAssignmentsAsync(staffUserId, cancellationToken));
    }

    [HttpPut("{locationId:guid}"), Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<ChangeAssignmentResult>> Replace(Guid locationId,
        ChangeStaffAssignmentRequest request, CancellationToken t) =>
        Result(await locations.ReplaceAssignmentAsync(UserId, locationId, request.StaffUserId,
            request.EffectiveFrom, request.LocationVersion, request.Reason, t));

    [HttpPut("assignment/{assignmentId:guid}"), Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<UpdateAssignmentPeriodResult>> UpdatePeriod(Guid assignmentId,
        UpdateStaffAssignmentPeriodRequest request, CancellationToken t)
    {
        var result = await locations.UpdateAssignmentPeriodAsync(UserId, assignmentId, request.StartDate,
            request.EndDate, request.LocationVersion, request.Reason, t);
        return PeriodResult(result);
    }

    [HttpDelete("assignment/{assignmentId:guid}"), Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<UpdateAssignmentPeriodResult>> CancelFuture(Guid assignmentId,
        [FromBody] CancelStaffAssignmentRequest request, CancellationToken t) =>
        PeriodResult(await locations.CancelFutureAssignmentAsync(UserId, assignmentId, request.LocationVersion, request.Reason, t));

    private ActionResult<UpdateAssignmentPeriodResult> PeriodResult(UpdateAssignmentPeriodResult result) =>
        result.Status switch
        {
            UpdateAssignmentPeriodStatus.Changed => Ok(result),
            UpdateAssignmentPeriodStatus.Invalid => Problem(statusCode: 400, title: "Invalid assignment period."),
            UpdateAssignmentPeriodStatus.AssignmentNotFound => NotFound(),
            UpdateAssignmentPeriodStatus.StaleVersion => Conflict(new ProblemDetails { Status = 409, Title = "Location version is stale." }),
            UpdateAssignmentPeriodStatus.DateRangeOverlaps => Conflict(new ProblemDetails { Status = 409, Title = "The Location already has a Staff assignment during this date range." }),
            UpdateAssignmentPeriodStatus.StaffUnavailable => Problem(statusCode: 400, title: "Staff is unavailable."),
            _ => throw new InvalidOperationException("Unsupported assignment period result.")
        };

    [HttpDelete("{locationId:guid}"), Authorize(Policy = Permissions.StaffAssignments.Manage)]
    public async Task<ActionResult<ChangeAssignmentResult>> Remove(Guid locationId,
        [FromBody] RemoveStaffAssignmentRequest request, CancellationToken t) =>
        Result(await locations.RemoveAssignmentAsync(UserId, locationId, request.EffectiveFrom,
            request.LocationVersion, request.Reason, t));

    private ActionResult<ChangeAssignmentResult> Result(ChangeAssignmentResult result) => result.Status switch
    {
        ChangeAssignmentStatus.Changed => Ok(result),
        ChangeAssignmentStatus.Invalid => Problem(statusCode: 400, title: "Invalid assignment change."),
        ChangeAssignmentStatus.LocationNotFound => NotFound(),
        ChangeAssignmentStatus.StaffUnavailable => Problem(statusCode: 400, title: "Staff is unavailable."),
        ChangeAssignmentStatus.StaleVersion => Conflict(new ProblemDetails { Status = 409, Title = "Location version is stale." }),
        ChangeAssignmentStatus.NoCurrentAssignment => Conflict(new ProblemDetails { Status = 409, Title = "Location has no current Staff assignment." }),
        _ => throw new InvalidOperationException("Unsupported assignment change result.")
    };

    private Guid UserId => currentUser.UserId ?? throw new InvalidOperationException("Authenticated user is unavailable.");
}

public sealed record CreateStaffAssignmentRequest(Guid LocationId, Guid StaffUserId, DateOnly StartDate, DateOnly EndDate);
public sealed record ChangeStaffAssignmentRequest(Guid StaffUserId, DateOnly EffectiveFrom,
    [Range(1, int.MaxValue)] int LocationVersion, [Required, StringLength(500)] string Reason);
public sealed record RemoveStaffAssignmentRequest(DateOnly EffectiveFrom,
    [Range(1, int.MaxValue)] int LocationVersion, [Required, StringLength(500)] string Reason);
public sealed record UpdateStaffAssignmentPeriodRequest(DateOnly StartDate, DateOnly EndDate,
    [Range(1, int.MaxValue)] int LocationVersion, [Required, StringLength(500)] string Reason);
public sealed record CancelStaffAssignmentRequest(
    [Range(1, int.MaxValue)] int LocationVersion, [Required, StringLength(500)] string Reason);
