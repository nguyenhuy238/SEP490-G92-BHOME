using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24ExpenseTests
{
    private static DateOnly FinanceToday => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
        DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    private static async Task<T> CreateProperty<T>(HttpClient owner, string route, object input)
    {
        var response = await owner.PostAsJsonAsync("/api/v1/" + route, input);
        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    [CompactPostgresFact]
    public async Task FinancialOccupancyUsesPropertyHistoryAndDoesNotSubstituteCurrentRoomsOrWriteLedgers()
    {
        using var owner = await User("Owner");
        var location = await CreateProperty<LocationDto>(owner, "locations", new LocationWrite("Synthetic history", "Synthetic address"));
        var type = await CreateProperty<RoomTypeDto>(owner, "room-types", new RoomTypeWrite(location.Id, "History type", null, 2, 20m, []));
        var room = await CreateProperty<RoomDto>(owner, "rooms", new RoomWrite(location.Id, type.Id, "HISTORY-01", "1", 2));
        var today = FinanceToday;
        var route = $"/api/v1/financial-reports?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}&locationId={location.Id}";
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var changes = await db.Set<PropertyChange>().CountAsync();
        var expenses = await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM expenses").SingleAsync();
        var response = await owner.GetAsync(route);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var report = (await response.Content.ReadFromJsonAsync<FinancialReport>())!;
        var history = Assert.IsType<HistoricalOccupancy>(report.HistoricalOccupancy);
        Assert.Equal("Complete", history.Status); Assert.Equal(0, history.OccupiedRoomDays);
        Assert.Equal(1, history.RentableRoomDays); Assert.Equal(0m, history.OccupancyRate);
        var property = (await owner.GetFromJsonAsync<OccupancySummaryDto>(
            $"/api/v1/locations/{location.Id}/occupancy-summary?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}"))!;
        Assert.Equal(property.Historical.Status, history.Status);
        Assert.Equal(property.Historical.RentableRoomDays, history.RentableRoomDays);
        Assert.Equal(property.Historical.OccupiedRoomDays, history.OccupiedRoomDays);
        Assert.Equal(property.Historical.OccupancyRate, history.OccupancyRate);
        Assert.Equal(1, report.Total.TotalRooms); Assert.Equal(0, report.Total.OccupiedRooms);
        Assert.Equal("0", report.Total.VerifiedCollections);
        Assert.Equal(changes, await db.Set<PropertyChange>().CountAsync());
        Assert.Equal(expenses, await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM expenses").SingleAsync());

        // Unavailable is an actual Owner API decision, not a direct status seed.
        var update = await owner.PutAsJsonAsync($"/api/v1/rooms/{room.Id}",
            new RoomWrite(location.Id, type.Id, room.RoomNumber, room.Floor, room.Capacity,
                RoomStatus.Unavailable, room.Version, "Synthetic maintenance closure"));
        Assert.True(update.IsSuccessStatusCode, await update.Content.ReadAsStringAsync());
        var closed = (await owner.GetFromJsonAsync<FinancialReport>(route))!;
        Assert.Equal("Complete", closed.HistoricalOccupancy!.Status);
        Assert.Equal(0, closed.HistoricalOccupancy.RentableRoomDays);
        Assert.Null(closed.HistoricalOccupancy.OccupancyRate);
        Assert.Equal(report.Total, closed.Total);
        Assert.True(await db.IsSchemaReadyAsync());
    }

    [CompactPostgresFact]
    public async Task FinancialOccupancyExplainsUnsupportedOrMissingEvidenceAndKeepsOwnerOnlyScope()
    {
        var (owner, input) = await Setup(); using var ownerClient = owner;
        // Synthetic migrated rows deliberately lack Property creation audit/configuration.
        var room = new Room { LocationId = input.LocationId, RoomNumber = "HISTORY-SCOPE", Capacity = 2 };
        await using (var legacyScope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = legacyScope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            db.Add(room); await db.SaveChangesAsync();
        }
        var today = FinanceToday;
        async Task<FinancialReport> Report(DateOnly from, DateOnly to, string suffix) =>
            (await owner.GetFromJsonAsync<FinancialReport>($"/api/v1/financial-reports?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}{suffix}"))!;
        var scope = $"&locationId={input.LocationId}";
        // Setup intentionally inserts a legacy-like Location without creation audit.
        foreach (var (from, to, suffix, status) in new[] {
            (today, today, scope, "InsufficientData"),
            (today.AddDays(-1), today, scope, "InsufficientData"),
            (today, today.AddDays(1), scope, "FuturePeriod"),
            (today.AddDays(-367), today, scope, "PeriodUnsupported"),
            (today, today, "", "LocationRequired"),
            (today, today, scope + $"&roomId={room.Id}", "RoomFilterUnsupported") })
        {
            var history = (await Report(from, to, suffix)).HistoricalOccupancy!;
            Assert.Equal(status, history.Status); Assert.Null(history.OccupancyRate);
            Assert.Null(history.OccupiedRoomDays); Assert.Null(history.RentableRoomDays);
            Assert.NotEmpty(history.Limitations); Assert.Equal(from, history.From); Assert.Equal(to, history.To);
        }
        var route = $"/api/v1/financial-reports?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}{scope}";
        using var staff = await User("Staff"); using var tenant = await User("Tenant");
        using var anonymous = fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(route + $"&roomId={Guid.NewGuid()}")).StatusCode);
    }
}
