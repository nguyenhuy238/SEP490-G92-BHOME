using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task SigningEmailChecksStaffActiveMainProfilesAndAcceptedContactsWithoutLeakingAnotherContract()
    {
        var w = await Seed();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var target = await AddSyntheticHolding(db, w, active: false);
        target.Kind = ContractKind.Main;
        var own = await db.Set<Resident>().SingleAsync(r => r.Id == target.RepresentativeResidentId);
        own.ContactEmail = "own-main@example.invalid";
        target.Room.RoomNumber = "MAIL-TARGET";
        await db.SaveChangesAsync();
        var other = await AddSyntheticHolding(db, w, active: false);
        other.Kind = ContractKind.Main;
        var otherResident = await db.Set<Resident>().SingleAsync(r => r.Id == other.RepresentativeResidentId);
        otherResident.ContactEmail = "stored-main@example.invalid";
        db.Add(new ContractSigningInvitation
        {
            ContractId = other.Id,
            ResidentId = other.RepresentativeResidentId,
            ApprovedByUserId = w.Owner.Id,
            SnapshotHash = other.SnapshotHashOrEmpty,
            TokenHash = new string('D', 64),
            DocumentHash = new string('E', 64),
            RecipientEmail = "accepted-only@example.invalid",
            AcceptedAt = DateTimeOffset.UtcNow,
            ContactEmails = System.Text.Json.JsonSerializer.Serialize(new Dictionary<Guid, string>
            {
                [other.RepresentativeResidentId] = "accepted-only@example.invalid",
                [Guid.NewGuid()] = "family-accepted@example.invalid"
            }),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            DeliveryStatus = "Accepted"
        });
        db.Add(new ContractSigningInvitation
        {
            ContractId = other.Id,
            ResidentId = other.RepresentativeResidentId,
            ApprovedByUserId = w.Owner.Id,
            SnapshotHash = other.SnapshotHashOrEmpty,
            TokenHash = new string('F', 64),
            DocumentHash = new string('E', 64),
            RecipientEmail = "pending-only@example.invalid",
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1)
        });
        await db.SaveChangesAsync();
        var repository = scope.ServiceProvider.GetRequiredService<IAnonymousSigningRepository>();
        Assert.True(await repository.IsEmailInUseAsync(target.Id, own.Id, "  " + w.Staff.Email!.ToUpperInvariant() + "  ", default));
        var staff = await db.Users.SingleAsync(u => u.Id == w.Staff.Id); staff.IsActive = false; await db.SaveChangesAsync();
        Assert.True(await repository.IsEmailInUseAsync(target.Id, own.Id, w.Staff.Email!, default));
        Assert.True(await repository.IsEmailInUseAsync(target.Id, own.Id, w.Tenants[0].Email!, default));
        Assert.True(await repository.IsEmailInUseAsync(target.Id, own.Id, "STORED-MAIN@EXAMPLE.INVALID", default));
        Assert.True(await repository.IsEmailInUseAsync(target.Id, own.Id, "accepted-only@example.invalid", default));
        Assert.True(await repository.IsEmailInUseAsync(target.Id, own.Id, "family-accepted@example.invalid", default));
        Assert.False(await repository.IsEmailInUseAsync(target.Id, own.Id, "own-main@example.invalid", default));
        Assert.False(await repository.IsEmailInUseAsync(target.Id, own.Id, "new-tenant@example.invalid", default));
        Assert.False(await repository.IsEmailInUseAsync(target.Id, own.Id, "pending-only@example.invalid", default));
    }
}
