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
public sealed class LocationsController(ICurrentUser currentUser, ILocationAssignments locations, PropertyService properties) : ControllerBase
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

    [HttpPut("{id:guid}"), Authorize(Policy = Permissions.Property.Manage)]
    public Task<LocationDto> Update(Guid id, LocationWrite input, CancellationToken t) => properties.SaveLocationAsync(id, input, t);

    [HttpGet("assigned-to-me")]
    [Authorize(Policy = Permissions.Locations.ViewAssigned)]
    public async Task<ActionResult<IReadOnlyList<LocationSummary>>> ListAssigned(CancellationToken cancellationToken) =>
        Ok(await locations.ListAssignedLocationsAsync(UserId, VietnamToday(), cancellationToken));

    private Guid UserId => currentUser.UserId ?? throw new InvalidOperationException("Authenticated user is unavailable.");

    private static DateOnly VietnamToday() => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow,
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

    private Guid UserId => currentUser.UserId ?? throw new InvalidOperationException("Authenticated user is unavailable.");
}

public sealed record CreateStaffAssignmentRequest(Guid LocationId, Guid StaffUserId, DateOnly StartDate, DateOnly EndDate);
