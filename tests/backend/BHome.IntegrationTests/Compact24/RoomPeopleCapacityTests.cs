using System.Net;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task MainPreparationRejectsThreePeopleAgainstDatabaseRoomCapacityTwo()
    {
        var w = await Seed();
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var room = await db.Set<Room>().SingleAsync(r => r.Id == w.Room);
            room.Capacity = 2; await db.SaveChangesAsync();
        }
        using var owner = await Client(w.Owner);
        var ids = string.Join("&", w.Residents.Select(id => "residentIds=" + id));
        var response = await owner.GetAsync($"/api/v1/contracts/main-drafts/preparation?roomId={w.Room}&representativeResidentId={w.Residents[0]}&{ids}&effectiveOn={Today:yyyy-MM-dd}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("room_capacity_exceeded", await response.Content.ReadAsStringAsync());
    }
}
