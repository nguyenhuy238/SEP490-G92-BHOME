using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class SePayIntegrationTests
{
    [CompactPostgresFact]
    public async Task ClaimedDerivedSePayReferenceCannotLockHoldingPriceOrAllocateDeposit()
    {
        await using var scenario = await Create(isolatedDatabase: true);
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var archive = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var runtime = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var payments = scope.ServiceProvider.GetRequiredService<IPaymentRepository>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7));
        var now = DateTimeOffset.UtcNow;
        var room = new Room { LocationId = scenario.Location, RoomNumber = "HOLD-REFERENCE-COLLISION", Capacity = 1, Status = RoomStatus.Available };
        var resident = new Resident
        {
            RoomId = room.Id,
            OwnerUserId = scenario.Owner,
            DisplayLabel = "Synthetic holding payer",
            VerificationStatus = IdentityVerificationStatus.Verified
        };
        var holding = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = scenario.Owner,
            RepresentativeResidentId = resident.Id,
            Kind = ContractKind.Holding,
            Status = ContractStatus.PendingActivation,
            SigningMode = ContractSigningModes.Internal,
            StartDate = today.AddDays(1),
            EndDate = today.AddMonths(6),
            HoldingExpiryAt = now.AddDays(1),
            MonthlyRent = 100000,
            RequiredDeposit = 100000,
            IsDevelopmentDemo = true,
            Terms = "Synthetic signed holding",
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = today.AddDays(1) }]
        };
        holding.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(holding.MonthlyRent,
            holding.RequiredDeposit, holding.StartDate, holding.EndDate, holding.HoldingExpiryAt.Value,
            "OwnerApproved", now.AddMinutes(-2),
            [new HoldingPriceCharge(Guid.Empty, "RENT", (int)ChargeCategory.Rent, (int)ChargingMethod.FixedPerRoomPerMonth,
                holding.MonthlyRent, holding.StartDate, null, 0)]));
        holding.SnapshotHash = ContractDocumentSnapshot.Hash(new ContractDocument(holding.Id, holding.RoomId, holding.OwnerSignerId,
            Guid.Empty, holding.RepresentativeResidentId, [resident.Id], holding.StartDate, holding.EndDate,
            holding.MonthlyRent, holding.RequiredDeposit, null, 0, holding.Terms, "")
        { IsInternalResidentAcceptance = true });
        holding.InternalAcceptance = JsonSerializer.Serialize(new InternalAcceptanceEvidence(Guid.NewGuid(), resident.Id,
            holding.SnapshotHash, "synthetic-source", "synthetic-stroke", "synthetic-tenant.pdf", "synthetic-tenant-hash",
            now.AddMinutes(-2), scenario.Owner, now.AddMinutes(-1), "synthetic-final.pdf", "synthetic-final-hash"));
        archive.AddRange(room, resident, holding);
        await archive.SaveChangesAsync();
        var code = await scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>()
            .IssueAsync("Deposit", holding.Id, scenario.Location, default);
        Assert.False(string.IsNullOrWhiteSpace(code));
        var bankReference = "SYN-COLLISION-" + Guid.NewGuid().ToString("N");
        var eventId = Guid.NewGuid().ToString();
        var transaction = new SePayTransaction(eventId, "ACB", scenario.TransactionDate, Account, null, code,
            "Synthetic transfer " + code, "in", holding.RequiredDeposit, bankReference, null, holding.RequiredDeposit);
        var derivedReference = SePayService.Reference("Test", transaction);

        // Claim the provider's derived SP: reference through the real manual allocation API,
        // not the raw provider bank reference (which is checked separately before reconciliation).
        using var owner = await scenario.Client(scenario.Owner);
        using var register = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payment-transactions")
        {
            Content = JsonContent.Create(new PaymentTransferInput("SYNTHETIC-MANUAL", derivedReference, 100000,
                "VND", now.AddSeconds(-5), scenario.Code, "Synthetic statement", "Synthetic Owner confirmation",
                scenario.Invoice, true, true))
        };
        register.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var registered = await owner.SendAsync(register);
        Assert.True(registered.IsSuccessStatusCode, await registered.Content.ReadAsStringAsync());
        var manual = (await registered.Content.ReadFromJsonAsync<TransferView>())!;
        using var allocate = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/payment-transactions/{manual.Id}/allocate")
        { Content = JsonContent.Create(new PaymentMatchInput(scenario.Invoice, null, true)) };
        allocate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var allocated = await owner.SendAsync(allocate);
        Assert.True(allocated.IsSuccessStatusCode, await allocated.Content.ReadAsStringAsync());
        Assert.True(await payments.ReferenceClaimedAsync(derivedReference, default));
        Assert.False(await payments.ManualReferenceReceivedAsync(bankReference, default));
        var before = await payments.HoldingAsync(holding.Id, default);
        Assert.NotNull(before);
        Assert.True(AnonymousContractSigningService.Complete(before));
        Assert.Null(before.PriceLockedAt);
        Assert.Null(before.PriceLockTrigger);

        using var received = await scenario.Send(holding.RequiredDeposit, bankReference, code, eventId: eventId);
        Assert.True(received.IsSuccessStatusCode, await received.Content.ReadAsStringAsync());
        using var replay = await scenario.Send(holding.RequiredDeposit, bankReference, code, eventId: eventId);
        Assert.True(replay.IsSuccessStatusCode, await replay.Content.ReadAsStringAsync());

        var providerReceipt = await payments.TransferReferenceAsync("SEPAY:TEST", derivedReference, default);
        Assert.NotNull(providerReceipt);
        var events = await scope.ServiceProvider.GetRequiredService<ISePayRepository>().EventsAsync(1, 100, default);
        var reviewed = Assert.Single(events.Items, e => e.TransferId == providerReceipt.Id);
        Assert.Equal("ManualReview", reviewed.Status);
        Assert.Equal("bank_reference_already_credited", reviewed.Reason);
        Assert.Null(await payments.AllocationAsync(providerReceipt.Id, default));
        Assert.Equal(0m, await payments.DepositAllocatedAsync(holding.Id, default));
        var after = await payments.HoldingAsync(holding.Id, default);
        Assert.NotNull(after);
        Assert.Null(after.PriceLockedAt);
        Assert.Null(after.PriceLockTrigger);
        Assert.Equal(before.AgreedPriceSnapshot, after.AgreedPriceSnapshot);
        Assert.Equal(before.Status, after.Status);
        Assert.Equal((short)RoomStatus.Available, await runtime.Set<Native.Room>().AsNoTracking()
            .Where(r => r.Id == room.Id).Select(r => r.Status).SingleAsync());
        Assert.Equal(100000m, (await payments.AllocationAsync(manual.Id, default))!.Amount);

        // A fresh reference for the same signed holding proves that the fixture is
        // actually eligible for price locking, rather than passing due to incomplete signing.
        using var fresh = await scenario.Send(holding.RequiredDeposit, code: code);
        Assert.True(fresh.IsSuccessStatusCode, await fresh.Content.ReadAsStringAsync());
        Assert.Equal(holding.RequiredDeposit, await payments.DepositAllocatedAsync(holding.Id, default));
        Assert.NotNull((await payments.HoldingAsync(holding.Id, default))!.PriceLockedAt);
    }
}
