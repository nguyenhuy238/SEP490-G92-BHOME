using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

public sealed partial class ContractLifecycleApiTests
{
    private async Task<RoomDto> ConfigureProperty(Workspace workspace)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var room = await db.Set<Room>().Include(r => r.Location).SingleAsync(r => r.Id == workspace.Room);
        room.Location.Address = "Synthetic address";
        var type = new RoomType { LocationId = workspace.Location, Name = "Synthetic type", DefaultCapacity = 2 };
        db.Add(type); room.RoomTypeId = type.Id; room.Capacity = 2;
        await db.SaveChangesAsync();
        return (await workspace.Owner.Client.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{room.Id}"))!;
    }

    // Called by the Compact24 PostgreSQL 16 suite; signing/storage/settlement are explicit substitutes.
    internal async Task PropertyMutationRacesWithContractTransition(bool termination)
    {
        var w = await Setup();
        await ConfigureProperty(w);
        var id = await Draft(w); await Signed(w, id); await Deposit(w, id);
        if (termination)
        {
            await Success<ContractView>(await Post(w.Owner, Path(id, "activate")));
            await SettledBoundary(w, id);
        }
        var before = (await w.Owner.Client.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{w.Room}"))!;
        var input = new RoomWrite(w.Location, before.RoomTypeId!.Value, "RENAMED", before.Floor, before.Capacity, before.Status, before.Version, "Synthetic rename");
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<HttpResponseMessage> Property() { await release.Task; return await w.Owner.Client.PutAsJsonAsync($"/api/v1/rooms/{w.Room}", input); }
        async Task<HttpResponseMessage> Transition()
        {
            await release.Task;
            return termination ? await Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today)) : await Post(w.Owner, Path(id, "activate"));
        }
        var property = Property(); var transition = Transition(); release.SetResult();
        await Task.WhenAll(property, transition);
        await Success<ContractView>(transition.Result);
        Assert.Contains(property.Result.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict });
        if (property.Result.StatusCode == HttpStatusCode.Conflict)
            Assert.Contains("stale_version", await property.Result.Content.ReadAsStringAsync());
        var after = (await w.Owner.Client.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{w.Room}"))!;
        Assert.Equal(termination ? RoomStatus.Available : RoomStatus.Occupied, after.Status);
        Assert.Equal(before.Version + (property.Result.IsSuccessStatusCode ? 2 : 1), after.Version);
        Assert.Equal(property.Result.IsSuccessStatusCode ? input.RoomNumber : before.RoomNumber, after.RoomNumber);
        var stale = await w.Owner.Client.PutAsJsonAsync($"/api/v1/rooms/{w.Room}", input);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Contains("stale_version", await stale.Content.ReadAsStringAsync());
        await using var verify = fixture.Factory.Services.CreateAsyncScope();
        var actual = verify.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var history = await actual.Set<PropertyChange>().Where(a => a.TargetId == w.Room).ToArrayAsync();
        var action = termination ? "ContractTermination" : "ContractActivation";
        var change = Assert.Single(history, a => a.Action == action);
        Assert.Equal(w.Owner.Id, change.ActorId); Assert.Contains(id.ToString(), change.After);
        Assert.Equal(property.Result.IsSuccessStatusCode ? 1 : 0, history.Count(a => a.Action == "Updated"));
        Assert.Equal(termination ? ContractStatus.Terminated : ContractStatus.Active,
            (await actual.Set<Contract>().SingleAsync(c => c.Id == id)).Status);
    }

    private async Task SettledBoundary(Workspace w, Guid id)
    {
        await Success<MoveOutView>(await Post(w.Tenant, Path(id, "termination-requests"), new TerminationInput(Today, "Synthetic reviewed move-out")));
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve")));
        var electricity = await FinalReading(w, id, BHome.Domain.Billing.UtilityType.Electricity);
        var water = await FinalReading(w, id, BHome.Domain.Billing.UtilityType.Water);
        await using var seed = fixture.Factory.Services.CreateAsyncScope();
        var db = seed.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        // Seed the already-reviewed boundary; this is not evidence for the real financial settlement flow.
        var moveOut = await db.Set<ContractMoveOut>().SingleAsync(m => m.ContractId == id);
        moveOut.Status = MoveOutStatus.Settled;
        moveOut.InspectedAt = DateTimeOffset.UtcNow;
        moveOut.ElectricityReadingId = electricity;
        moveOut.WaterReadingId = water;
        moveOut.SettlementLedgerReference = "TEST-ONLY-LEDGER-" + id;
        await db.SaveChangesAsync(); fixture.Ledger.Resolved[id] = true;
    }

    internal async Task RemainingContractKeepsRoomOccupiedWithoutVersionBump()
    {
        var w = await Setup(); await ConfigureProperty(w); var first = await Active(w);
        var tenant = await User(BHome.Domain.IdentityAccess.Roles.Tenant);
        var resident = new Resident
        {
            RoomId = w.Room,
            OwnerUserId = w.Owner.Id,
            DisplayLabel = "Synthetic second occupant",
            VerificationStatus = IdentityVerificationStatus.Verified
        };
        await using (var seed = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            db.Add(resident); await db.SaveChangesAsync();
        }
        var second = await Active(w with { Tenant = tenant, Resident = resident.Id });
        var before = (await w.Owner.Client.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{w.Room}"))!;
        Assert.Equal(2, before.Version);
        await SettledBoundary(w, first);
        await Success<ContractView>(await Post(w.Owner, Path(first, "move-out/complete"), new CompletionInput(Today)));
        var after = (await w.Owner.Client.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{w.Room}"))!;
        Assert.Equal(RoomStatus.Occupied, after.Status); Assert.Equal(before.Version, after.Version);
        await using var verify = fixture.Factory.Services.CreateAsyncScope();
        var actual = verify.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(ContractStatus.Active, (await actual.Set<Contract>().SingleAsync(c => c.Id == second)).Status);
        Assert.False(await actual.Set<PropertyChange>().AnyAsync(c => c.TargetId == w.Room && c.Action == "ContractTermination"));
    }

    internal async Task PropertyObligationsDistinguishDraftSignedAndActive(bool paymentOnly)
    {
        var w = await Setup(); await ConfigureProperty(w); var id = await Draft(w);
        async Task<RoomObligations> Read()
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IPropertyRepository>()
                .ObligationsAsync(w.Location, null, w.Room, Today, default);
        }
        var draft = await Read();
        Assert.True(draft.HasResidentRecords); Assert.False(draft.HasCurrentOccupancy);
        Assert.False(draft.HasActiveContracts); Assert.False(draft.HasBindingPendingContracts);
        if (paymentOnly) await Deposit(w, id); else await Signed(w, id);
        Assert.True((await Read()).HasBindingPendingContracts);
        if (paymentOnly) await Signed(w, id); else await Deposit(w, id);
        await Success<ContractView>(await Post(w.Owner, Path(id, "activate")));
        var active = await Read();
        Assert.True(active.HasActiveContracts); Assert.True(active.HasCurrentOccupancy);
        Assert.False(active.HasBindingPendingContracts);
    }
}
