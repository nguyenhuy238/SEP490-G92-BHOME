using System.Text.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Finance;

public sealed class RecurringExpenseIdempotencyTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task RepeatedPostWithSameKey_CreatesOnlyOneRecurringRule()
    {
        var store = Substitute.For<ISetupWorkspaceStore>();
        var user = Substitute.For<ICurrentUser>();
        var owner = Guid.NewGuid();
        var location = Guid.NewGuid();
        var key = Guid.NewGuid();
        user.UserId.Returns(owner);
        user.IsInRole(Roles.Owner).Returns(true);
        var saved = new Dictionary<Guid, SetupDocument>();
        var initial = new Dictionary<Guid, SetupDocument>();
        store.TransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<RecurringExpenseView>>>(),
                Arg.Any<CancellationToken>())
            .Returns(call => call.ArgAt<Func<Task<RecurringExpenseView>>>(1)());
        store.GetAsync(Arg.Any<Guid>(), "RecurringExpenseRule", Arg.Any<CancellationToken>())
            .Returns(call => saved.GetValueOrDefault(call.ArgAt<Guid>(0)));
        store.HistoryAsync(Arg.Any<Guid>(), "RecurringExpenseRule", Arg.Any<CancellationToken>())
            .Returns(call => (IReadOnlyList<SetupDocument>)
                (initial.TryGetValue(call.ArgAt<Guid>(0), out var doc) ? [doc] : []));
        store.SaveAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), "RecurringExpenseRule",
                Arg.Any<string>(), Arg.Any<object>(), 0, Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var id = call.ArgAt<Guid>(0);
                if (saved.ContainsKey(id)) throw new InvalidOperationException("duplicate insert");
                var doc = new SetupDocument(id, call.ArgAt<Guid>(1), "RecurringExpenseRule",
                    call.ArgAt<string>(3), 1,
                    JsonSerializer.SerializeToElement(call.ArgAt<object>(4), Json),
                    DateTimeOffset.UtcNow, owner);
                saved.Add(id, doc);
                initial.Add(id, doc);
                return Task.FromResult(doc);
            });

        var service = new RecurringExpenseService(store, user, TimeProvider.System);
        var write = new RecurringExpenseWrite(location, "Dọn vệ sinh", 700_000,
            "MONTHLY", 0, new(2026, 12, 31), null, true);
        var first = await service.CreateAsync(write, key, default);
        // A new client omits dayOfMonth; an old client sends the anchored day.
        // Both must have the same canonical payload and idempotency key.
        var retry = await service.CreateAsync(write with { DayOfMonth = 31 }, key, default);
        Assert.Equal(first.Id, retry.Id);
        Assert.Equal(31, first.DayOfMonth);
        Assert.Single(saved);
        await store.Received(1).SaveAsync(first.Id, location, "RecurringExpenseRule",
            "Active", Arg.Any<object>(), 0, owner, Arg.Any<CancellationToken>());

        var conflict = await Assert.ThrowsAsync<FinanceException>(() =>
            service.CreateAsync(write with { Amount = 900_000 }, key, default));
        Assert.Equal(409, conflict.Status);
        Assert.Equal("idempotency_payload_mismatch", conflict.Code);
        Assert.Single(saved);
        var second = await service.CreateAsync(write, Guid.NewGuid(), default);
        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(2, saved.Count);

        var mismatch = await Assert.ThrowsAsync<FinanceException>(() =>
            service.CreateAsync(write with { DayOfMonth = 15 }, Guid.NewGuid(), default));
        Assert.Equal("recurring_day_must_match_start", mismatch.Code);
        Assert.Equal(2, saved.Count);
    }

    [Fact]
    public void DerivedRuleId_IsStableAndScopedToOwnerAndLocation()
    {
        var location = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var key = Guid.NewGuid();
        var rule = RecurringExpenseService.CreateId(location, actor, key);
        Assert.Equal(rule, RecurringExpenseService.CreateId(location, actor, key));
        Assert.NotEqual(rule, RecurringExpenseService.CreateId(Guid.NewGuid(), actor, key));
        Assert.NotEqual(rule, RecurringExpenseService.CreateId(location, Guid.NewGuid(), key));
    }

    [Fact]
    public void JsonWithoutDayOfMonth_IsAcceptedAsOptionalLegacyProperty()
    {
        var json = """
            {"locationId":"11111111-1111-1111-1111-111111111111","name":"Vệ sinh",
             "amount":"500000","frequency":"MONTHLY","startsOn":"2026-12-31",
             "endsOn":null,"active":true}
            """;
        var input = JsonSerializer.Deserialize<RecurringExpenseWrite>(json, Json)!;
        Assert.Equal(0, input.DayOfMonth);
        Assert.Equal(31, input.StartsOn.Day);
    }

    [Fact]
    public async Task EditingExistingRule_PreservesLegacyDueDayEvenIfClientSendsStartDateDay()
    {
        var store = Substitute.For<ISetupWorkspaceStore>();
        var user = Substitute.For<ICurrentUser>();
        var owner = Guid.NewGuid();
        var location = Guid.NewGuid();
        var id = Guid.NewGuid();
        var starts = new DateOnly(2020, 1, 1);
        var oldRule = new RecurringExpenseRuleData("Internet cũ", 100_000m,
            "MONTHLY", 31, starts, null, true, starts);
        var current = new SetupDocument(id, location, "RecurringExpenseRule", "Active", 1,
            JsonSerializer.SerializeToElement(oldRule, Json), DateTimeOffset.UtcNow, owner);
        user.UserId.Returns(owner);
        user.IsInRole(Roles.Owner).Returns(true);
        store.TransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<RecurringExpenseView>>>(),
            Arg.Any<CancellationToken>())
            .Returns(call => call.ArgAt<Func<Task<RecurringExpenseView>>>(1)());
        store.GetAsync(id, "RecurringExpenseRule", Arg.Any<CancellationToken>()).Returns(current);
        store.SaveAsync(id, location, "RecurringExpenseRule", "Active", Arg.Any<object>(),
                1, owner, Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(current with
            {
                Version = 2,
                Data = JsonSerializer.SerializeToElement(call.ArgAt<object>(4), Json)
            }));

        var effective = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(2);
        var revised = await new RecurringExpenseService(store, user, TimeProvider.System).UpdateAsync(id,
            new RecurringExpenseWrite(location, "Internet cũ", 150_000m,
                "MONTHLY", 1, starts, null, true, 1, effective), default);
        Assert.Equal(2, revised.Version);
        Assert.Equal(31, revised.DayOfMonth);
        Assert.Equal(150_000m, revised.Amount);
        Assert.Equal(effective, revised.EffectiveFrom);
    }
}
