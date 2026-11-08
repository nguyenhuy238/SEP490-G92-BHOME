using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24ExpenseTests
{
    [CompactPostgresFact]
    public async Task ExpenseReferencesValidateRoomAssetAndExistingWorkOrderAndRetainTheirSourceLinks()
    {
        var (owner, input) = await Setup(); await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var room = new Room { LocationId = input.LocationId, RoomNumber = "REF-A", Capacity = 2 };
        var otherRoom = new Room { LocationId = input.LocationId, RoomNumber = "REF-B", Capacity = 2 };
        var asset = new Asset { LocationId = input.LocationId, RoomId = room.Id, Name = "SYNTHETIC ASSET", Category = "Furniture", Condition = "Good" };
        var otherAsset = new Asset { LocationId = input.LocationId, RoomId = otherRoom.Id, Name = "OTHER ROOM ASSET", Category = "Furniture", Condition = "Good" };
        var outsideLocation = new BHome.Domain.Locations.Location("SYNTHETIC OUTSIDE");
        var outsideAsset = new Asset { LocationId = outsideLocation.Id, CommonArea = "Synthetic area", Name = "OUTSIDE ASSET", Category = "Furniture", Condition = "Good" };
        db.AddRange(room, otherRoom, asset, otherAsset, outsideLocation, outsideAsset); await db.SaveChangesAsync();
        var actor = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM users WHERE 'Owner'=ANY(roles) ORDER BY id LIMIT 1").SingleAsync();
        var incident = Guid.NewGuid(); var task = Guid.NewGuid(); var general = Guid.NewGuid(); var outsideIncident = Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
        // Only synthetic existing-source records: this does not claim a Work Order workflow/API exists.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO incident_reports(id,location_id,room_id,reporter_user_id,severity,summary,description,status,reported_at)
            VALUES({incident},{input.LocationId},{room.Id},{actor},'NORMAL','Synthetic source','Synthetic incident','REVIEWED',{now}),
              ({outsideIncident},{outsideLocation.Id},NULL,{actor},'NORMAL','Other source','Synthetic incident','REVIEWED',{now})
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,room_id,asset_id,assigned_user_id,incident_report_id,title,status,task_data)
            VALUES({task},'WORK_ORDER',{input.LocationId},{room.Id},{asset.Id},{actor},{incident},'SYNTHETIC WORK ORDER','Assigned',
                jsonb_build_object('state',jsonb_build_object('incidentId',{incident}::text,'assignedStaffId',{actor}::text))),
              ({general},'GENERAL',{input.LocationId},{room.Id},NULL,NULL,NULL,'SYNTHETIC GENERAL TASK','0',jsonb_build_object())
            """);
        var choices = (await owner.GetFromJsonAsync<ExpenseReferences>($"{Root}/reference-choices?locationId={input.LocationId}&roomId={room.Id}"))!;
        Assert.Contains(choices.Rooms, r => r.Id == room.Id); Assert.Equal(asset.Id, Assert.Single(choices.Assets).Id);
        Assert.Equal(task, Assert.Single(choices.WorkOrders).Id); Assert.False(choices.Truncated);
        Assert.Empty((await owner.GetFromJsonAsync<ExpenseReferences>($"{Root}/reference-choices?locationId={input.LocationId}&roomId={otherRoom.Id}"))!.WorkOrders);
        var linked = input with { RoomId = room.Id, AssetId = asset.Id, TaskId = task }; var key = Guid.NewGuid();
        var expense = await Value(await Create(owner, linked, key)); Assert.Equal(asset.Id, expense.AssetId); Assert.Equal(task, expense.TaskId);
        Assert.Equal("SYNTHETIC ASSET", expense.AssetName); Assert.Equal("SYNTHETIC WORK ORDER", expense.TaskTitle);
        Assert.Equal(expense.Id, (await Value(await Create(owner, linked, key))).Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Create(owner, linked with { TaskId = null }, key)).StatusCode);
        foreach (var invalid in new[] { linked with { AssetId = otherAsset.Id }, linked with { AssetId = outsideAsset.Id }, linked with { TaskId = general }, linked with { RoomId = otherRoom.Id }, linked with { AssetId = null }, linked with { TaskId = Guid.NewGuid() } })
            Assert.Equal(HttpStatusCode.NotFound, (await Create(owner, invalid, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create(owner, linked with { ExpenseType = "INITIAL_INVESTMENT" }, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"{Root}/{expense.Id}", new ExpenseUpdate(linked with { TaskId = null }, 1, "Cannot detach source"))).StatusCode);
        var updated = await Value(await owner.PutAsJsonAsync($"{Root}/{expense.Id}", new ExpenseUpdate(linked with { Amount = 456789 }, 1, "Synthetic correction")));
        Assert.Equal(task, updated.TaskId); Assert.Equal(asset.Id, updated.AssetId);
        Assert.Equal(incident, await db.Database.SqlQuery<Guid>($"SELECT incident_report_id AS \"Value\" FROM expenses WHERE id={expense.Id}").SingleAsync());
        Assert.Equal(456789, updated.Amount); Assert.True(await db.IsSchemaReadyAsync());
        using var staff = await User("Staff"); Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"{Root}/reference-choices?locationId={input.LocationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"{Root}/reference-choices?locationId={Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync($"{Root}/reference-choices")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task ExpensesWithoutReferencesKeepTheirExistingIdempotencyFingerprintFormat()
    {
        var (owner, input) = await Setup(); var expense = await Value(await Create(owner, input, Guid.NewGuid()));
        var oldPayload = new { input.LocationId, input.RoomId, input.ExpenseType, input.Category, Amount = input.Amount.ToString("0", System.Globalization.CultureInfo.InvariantCulture), input.OccurredOn, input.Note };
        var expected = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(oldPayload)));
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(expected, await db.Database.SqlQuery<string>($"SELECT history->0->>'fingerprint' AS \"Value\" FROM expenses WHERE id={expense.Id}").SingleAsync());
    }
}
