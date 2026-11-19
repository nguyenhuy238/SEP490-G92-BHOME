using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.Jobs;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24ExpenseTests
{
    private static Task<HttpResponseMessage> BatchInvestment(HttpClient owner, BulkInvestmentInput input, Guid key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/location-investments")
        {
            Content = JsonContent.Create(input)
        };
        request.Headers.Add("Idempotency-Key", key.ToString());
        return owner.SendAsync(request);
    }

    private static Task<HttpResponseMessage> CreateRecurring(HttpClient owner, RecurringExpenseWrite input, Guid key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/recurring-expenses")
        {
            Content = JsonContent.Create(input)
        };
        request.Headers.Add("Idempotency-Key", key.ToString());
        return owner.SendAsync(request);
    }

    [CompactPostgresFact]
    public async Task Phase7_ManualLocationInvestmentsAreAtomicScopedAndIdempotent()
    {
        var (owner, baseline) = await Setup();
        using (owner)
        {
            var day = new DateOnly(2026, 11, 1);
            var payload = new BulkInvestmentInput(baseline.LocationId, day,
            [
                new("Sửa chữa ban đầu", 15_000_000m, "Bản gốc A"),
                new("Chi phí pháp lý", 2_500_000m, "Bản gốc B")
            ]);
            var key = Guid.NewGuid();
            var saved = await (await BatchInvestment(owner, payload, key))
                .Content.ReadFromJsonAsync<ExpenseView[]>();
            Assert.NotNull(saved);
            Assert.Equal(2, saved.Length);
            Assert.Equal(17_500_000m, saved.Sum(e => e.Amount));
            Assert.All(saved, e =>
            {
                Assert.Equal(baseline.LocationId, e.LocationId);
                Assert.Equal("INITIAL_INVESTMENT", e.ExpenseType);
                Assert.Null(e.AssetId);
                Assert.Null(e.TaskId);
            });

            var replay = await (await BatchInvestment(owner, payload, key))
                .Content.ReadFromJsonAsync<ExpenseView[]>();
            Assert.Equal(saved.Select(e => e.Id).Order(), replay!.Select(e => e.Id).Order());
            Assert.Equal(HttpStatusCode.Conflict,
                (await BatchInvestment(owner,
                    payload with { Items = [payload.Items[0] with { Amount = 20_000_000 }, payload.Items[1]] },
                    key)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,
                (await BatchInvestment(owner, payload with
                {
                    Items = [payload.Items[0], payload.Items[1] with { Amount = 0 }]
                }, Guid.NewGuid())).StatusCode);
            var page = await owner.GetFromJsonAsync<ExpensePage>(
                $"/api/v1/location-investments?locationId={baseline.LocationId}");
            Assert.Equal(2, page!.Total);
            Assert.Equal(2, page.Items.Count);
        }
    }

    [CompactPostgresFact]
    public async Task Phase7_RecurringRulesRemainVersionedOwnerOnlyAndIdempotent()
    {
        var (owner, baseline) = await Setup();
        using (owner)
        using (var staff = await User("Staff"))
        {
            // New rules derive their billing day solely from StartsOn.
            var starts = new DateOnly(2026, 1, 31);
            var recurring = new RecurringExpenseWrite(baseline.LocationId, "Thuê mặt bằng",
                15_000_000m, "MONTHLY", 31, starts, null, true);
            var key = Guid.NewGuid();
            var createdResponse = await CreateRecurring(owner, recurring, key);
            Assert.Equal(HttpStatusCode.OK, createdResponse.StatusCode);
            var created = (await createdResponse.Content.ReadFromJsonAsync<RecurringExpenseView>())!;
            Assert.Equal(1, created.Version);
            Assert.Equal(baseline.LocationId, created.LocationId);

            var replayResponse = await CreateRecurring(owner, recurring, key);
            Assert.Equal(HttpStatusCode.OK, replayResponse.StatusCode);
            Assert.Equal(created.Id,
                (await replayResponse.Content.ReadFromJsonAsync<RecurringExpenseView>())!.Id);
            Assert.Equal(HttpStatusCode.Conflict,
                (await CreateRecurring(owner, recurring with { Amount = 17_000_000m }, key)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await staff.GetAsync($"/api/v1/recurring-expenses?locationId={baseline.LocationId}")).StatusCode);

            var effective = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(2);
            var revised = (await (await owner.PutAsJsonAsync(
                $"/api/v1/recurring-expenses/{created.Id}",
                recurring with
                {
                    Amount = 16_000_000m,
                    ExpectedVersion = created.Version,
                    EffectiveFrom = effective
                })).Content.ReadFromJsonAsync<RecurringExpenseView>())!;
            Assert.Equal(2, revised.Version);
            Assert.Equal(16_000_000m, revised.Amount);
            Assert.Equal(effective, revised.EffectiveFrom);
            var listed = (await owner.GetFromJsonAsync<RecurringExpenseView[]>(
                $"/api/v1/recurring-expenses?locationId={baseline.LocationId}"))!;
            Assert.Equal(revised, Assert.Single(listed));
            Assert.Equal(HttpStatusCode.Conflict,
                (await owner.PutAsJsonAsync(
                    $"/api/v1/recurring-expenses/{created.Id}",
                    recurring with
                    {
                        Amount = 18_000_000m,
                        ExpectedVersion = created.Version,
                        EffectiveFrom = effective.AddMonths(1)
                    })).StatusCode);

            // A timed-out create followed by a retry must never create another
            // scheduled expense stream, even after the rule was edited.
            var retryAfterEdit = await CreateRecurring(owner, recurring, key);
            Assert.Equal(HttpStatusCode.OK, retryAfterEdit.StatusCode);
            var unchangedId = (await retryAfterEdit.Content.ReadFromJsonAsync<RecurringExpenseView>())!;
            Assert.Equal(created.Id, unchangedId.Id);
            Assert.Equal(2, unchangedId.Version);
        }
    }

    [CompactPostgresFact]
    public async Task RecurringJob_BackfillsFromStartDate_AndNeverDuplicatesOnRepeatedExecution()
    {
        var (owner, baseline) = await Setup();
        using (owner)
        {
            var now = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
                DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
            var starts = new DateOnly(now.Year, now.Month, 1).AddMonths(-3);
            // dayOfMonth=0 also represents an omitted JSON property.
            var input = new RecurringExpenseWrite(baseline.LocationId, "Dịch vụ vệ sinh",
                250_000m, "MONTHLY", 0, starts, null, true);
            var response = await CreateRecurring(owner, input, Guid.NewGuid());
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var created = (await response.Content.ReadFromJsonAsync<RecurringExpenseView>())!;
            Assert.Equal(starts.Day, created.DayOfMonth);

            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            var job = scope.ServiceProvider.GetServices<IBackgroundJobHandler>()
                .Single(handler => handler.Name == "finance-recurring-expenses");
            var execution = new JobExecution(Guid.NewGuid(), "integration-backfill", "{}");
            var prefix = $"recurring-expense:{created.Id:N}:";

            async Task<(Guid Id, DateOnly Due, decimal Amount, string History)[]> LedgerAsync()
            {
                await using var connection = new NpgsqlConnection(fixture.Connection);
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand("""
                    SELECT id,occurred_on,amount,history::text FROM expenses
                    WHERE source_key LIKE @prefix ORDER BY occurred_on
                    """, connection);
                command.Parameters.AddWithValue("prefix", prefix + "%");
                await using var reader = await command.ExecuteReaderAsync();
                var rows = new List<(Guid, DateOnly, decimal, string)>();
                while (await reader.ReadAsync())
                    rows.Add((reader.GetGuid(0), DateOnly.FromDateTime(reader.GetDateTime(1)),
                        reader.GetDecimal(2), reader.GetString(3)));
                return rows.ToArray();
            }

            await job.ExecuteAsync(execution, default);
            var first = await LedgerAsync();
            Assert.Equal(4, first.Length); // Starting month + the next three months.
            Assert.Equal(Enumerable.Range(0, 4).Select(starts.AddMonths), first.Select(row => row.Due));
            Assert.All(first, row =>
            {
                Assert.Equal(250_000m, row.Amount);
                Assert.Contains("ruleSnapshot", row.History);
            });

            // Job retry/daily schedule is safe even after partial backfill;
            // source_key (ruleId + yyyyMM) is stable for every calendar period.
            await job.ExecuteAsync(execution with { Id = Guid.NewGuid() }, default);
            var replay = await LedgerAsync();
            Assert.Equal(first, replay);
        }
    }

    [CompactPostgresFact]
    public async Task Phase7_CapitalAssetsAreOwnerOnlyAndMissingAmountsAreNotInvented()
    {
        var (owner, baseline) = await Setup();
        using (owner)
        using (var staff = await User("Staff"))
        {
            var uri = $"/api/v1/locations/{baseline.LocationId}/capital-assets";
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(uri)).StatusCode);
            var result = await owner.GetFromJsonAsync<CapitalAssets>(uri);
            Assert.NotNull(result);
            Assert.Equal(baseline.LocationId, result.LocationId);
            Assert.Equal("0", result.KnownTotal);
            Assert.Empty(result.Groups);
        }
    }
}

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task Phase7_CommonAssetChecklistPersistsNativeAssetAndMissingCapitalPrice()
    {
        var w = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host);
        using var staff = await Client(w.Staff, host);
        var requirement = new SetupCommonAssetRequirement(Guid.NewGuid(), "Camera hành lang",
            "Security", "BulkQuantity", 3, "Hành lang", "cái");
        var draft = SetupDraft() with { CommonAssets = [requirement] };
        var location = (await Read<LocationSetupResult>(
            await Keyed(owner, SetupRoute, draft, Guid.NewGuid()))).Location.Id;
        var route = $"/api/v1/locations/{location}/common-asset-inventory-review";

        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        var snapshot = (await owner.GetFromJsonAsync<CommonAssetInventoryView>(route))!;
        Assert.Equal("NotChecked", snapshot.State);
        Assert.Equal(1, snapshot.TotalCount);
        var input = new CommonAssetInventoryConfirm(Guid.NewGuid(),
            snapshot.RequirementsId!.Value, snapshot.RequirementsVersion, snapshot.StateToken,
            [new(snapshot.Items[0].Id, true, [])], true);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await staff.PostAsJsonAsync(route + "/confirm", input)).StatusCode);
        var confirmed = await Read<CommonAssetInventoryView>(
            await owner.PostAsJsonAsync(route + "/confirm", input));
        Assert.Equal("Matched", confirmed.State);
        Assert.Equal(1, confirmed.CheckedCount);
        var replay = await Read<CommonAssetInventoryView>(
            await owner.PostAsJsonAsync(route + "/confirm", input));
        Assert.Equal(confirmed.StateToken, replay.StateToken);

        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var asset = await db.Set<Asset>().AsNoTracking()
            .SingleAsync(value => value.LocationId == location && value.RoomId == null);
        Assert.Equal("Hành lang", asset.CommonArea);
        var saved = (await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>()
            .AssetMetadataAsync([asset.Id], default))[asset.Id];
        Assert.Equal(3, saved.Quantity);
        Assert.Null(saved.PurchaseCost);

        var capital = (await owner.GetFromJsonAsync<CapitalAssets>(
            $"/api/v1/locations/{location}/capital-assets"))!;
        Assert.Equal(1, capital.UnpricedCount);
        Assert.Equal("0", capital.KnownTotal);
        Assert.Equal("0", capital.CommonTotal);
        var common = capital.Groups.Single(group => group.Scope == "common");
        Assert.True(common.Verified);
        var row = Assert.Single(common.Assets);
        Assert.Equal(asset.Id, row.Id);
        Assert.Equal(3, row.Quantity);
        Assert.Null(row.TotalCost);
    }

    [CompactPostgresFact]
    public async Task Phase7_VerifiedRoomAssetCapitalIsPricedOnlyAfterOwnerRecordsActualUnitCost()
    {
        var w = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host);
        var location = (await Read<LocationSetupResult>(
            await Keyed(owner, SetupRoute, SetupDraft(), Guid.NewGuid()))).Location.Id;
        var reviewUrl = ReviewRoute(location);
        var review = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(reviewUrl))!;
        var configured = review.Rooms.Single(room => room.Items.Count > 0);
        Assert.Single(configured.Items);
        var selected = new RoomInventoryReviewConfirm(Guid.NewGuid(),
        [
            ReviewRoom(configured,
                new RoomInventoryReviewInputItem(configured.Items[0].Id, true, []))
        ], true);
        var verified = await Read<RoomInventoryReviewView>(
            await owner.PostAsJsonAsync(reviewUrl + "/confirm", selected));
        Assert.Equal("Matched", verified.Rooms.Single(room => room.RoomId == configured.RoomId).State);

        var capitalUrl = $"/api/v1/locations/{location}/capital-assets";
        var unpriced = (await owner.GetFromJsonAsync<CapitalAssets>(capitalUrl))!;
        Assert.Equal("0", unpriced.KnownTotal);
        Assert.True(unpriced.UnpricedCount == 1,
            "Verified room asset must be reported unpriced: " +
            System.Text.Json.JsonSerializer.Serialize(unpriced));

        Guid id;
        AssetMetadata metadata;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            id = await db.Set<Asset>().Where(asset => asset.LocationId == location)
                .Select(asset => asset.Id).SingleAsync();
            metadata = (await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>()
                .AssetMetadataAsync([id], default))[id];
        }
        var unitCost = 2_000_000m;
        var purchaseDay = Today;
        // Checklist confirmation now creates the initial immutable metadata
        // snapshot even when its acquisition cost is unknown. Legacy follow-up
        // edits must use that current version, not the old assumption of zero.
        var originalMetadata = (await owner.GetFromJsonAsync<SetupDocument>(
            $"/api/v1/assets/{id}/metadata"))!;
        var revised = await Read<SetupDocument>(await owner.PutAsJsonAsync(
            $"/api/v1/assets/{id}/metadata", new AssetMetadataWrite(
                metadata with { PurchaseCost = unitCost, PurchaseDate = purchaseDay },
                originalMetadata.Version, "Owner records verified purchase cost")));
        Assert.Equal(originalMetadata.Version + 1, revised.Version);

        var priced = (await owner.GetFromJsonAsync<CapitalAssets>(capitalUrl))!;
        Assert.Equal((unitCost * metadata.Quantity).ToString("0"), priced.KnownTotal);
        Assert.Equal(0, priced.UnpricedCount);
        Assert.Equal("0", priced.CommonTotal);
        Assert.Equal(priced.KnownTotal, priced.RoomsTotal);
        var activeRoom = priced.Groups.Single(group => group.Scope == "room" &&
            group.Id == configured.RoomId.ToString());
        Assert.Equal(metadata.Quantity, Assert.Single(activeRoom.Assets).Quantity);

        var report = (await owner.GetFromJsonAsync<FinancialReport>(
            $"/api/v1/financial-reports?locationId={location}&from={Today.AddDays(-1):yyyy-MM-dd}&to={Today:yyyy-MM-dd}"))!;
        Assert.Equal(priced.KnownTotal, report.Total.InitialInvestment);
        // Reading the capital view or report must not create duplicate expenses.
        var reread = (await owner.GetFromJsonAsync<CapitalAssets>(capitalUrl))!;
        Assert.Equal(priced.KnownTotal, reread.KnownTotal);
    }

    [CompactPostgresFact]
    public async Task Phase7_InventoryVerificationUsesEditableReferencePriceAndImmediatelyCountsCapitalOnce()
    {
        var w = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host);
        var baseDraft = SetupDraft();
        var roomType = baseDraft.RoomTypes.Single(type => type.Assets.Length == 1);
        var roomReference = 1_700_000m;
        var roomActual = 1_900_000m;
        var commonReference = 300_000m;
        var commonActual = 350_000m;
        var commonRequirement = new SetupCommonAssetRequirement(
            Guid.NewGuid(), "Chổi thử nghiệm", "Cleaning", "BulkQuantity",
            3, "Hành lang", "cái", commonReference);
        var draft = baseDraft with
        {
            RoomTypes = baseDraft.RoomTypes.Select(type => type.Key == roomType.Key
                ? type with { Assets = [type.Assets[0] with { ReferencePrice = roomReference }] }
                : type).ToArray(),
            CommonAssets = [commonRequirement]
        };
        var location = (await Read<LocationSetupResult>(
            await Keyed(owner, SetupRoute, draft, Guid.NewGuid()))).Location.Id;

        var roomRoute = ReviewRoute(location);
        var roomReview = (await owner.GetFromJsonAsync<RoomInventoryReviewView>(roomRoute))!;
        var room = roomReview.Rooms.Single(item => item.Items.Count == 1);
        var roomItem = Assert.Single(room.Items);
        Assert.Equal(roomReference, roomItem.ReferenceUnitCost);
        var roomInput = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [ReviewRoom(room, new RoomInventoryReviewInputItem(roomItem.Id, true, [], roomActual))], true);
        var roomConfirmed = await Read<RoomInventoryReviewView>(
            await owner.PostAsJsonAsync(roomRoute + "/confirm", roomInput));
        Assert.Equal("Matched", roomConfirmed.Rooms.Single(item => item.RoomId == room.RoomId).State);
        var roomReplay = await Read<RoomInventoryReviewView>(
            await owner.PostAsJsonAsync(roomRoute + "/confirm", roomInput));
        Assert.Equal(1, roomReplay.Rooms.Single(item => item.RoomId == room.RoomId).CheckedCount);

        var commonRoute = $"/api/v1/locations/{location}/common-asset-inventory-review";
        var commonReview = (await owner.GetFromJsonAsync<CommonAssetInventoryView>(commonRoute))!;
        var commonItem = Assert.Single(commonReview.Items);
        Assert.Equal(commonReference, commonItem.ReferenceUnitCost);
        var commonInput = new CommonAssetInventoryConfirm(Guid.NewGuid(),
            commonReview.RequirementsId!.Value, commonReview.RequirementsVersion,
            commonReview.StateToken, [new CommonAssetInventoryInputItem(commonItem.Id, true, [], commonActual)], true);
        var commonConfirmed = await Read<CommonAssetInventoryView>(
            await owner.PostAsJsonAsync(commonRoute + "/confirm", commonInput));
        Assert.Equal("Matched", commonConfirmed.State);
        var commonReplay = await Read<CommonAssetInventoryView>(
            await owner.PostAsJsonAsync(commonRoute + "/confirm", commonInput));
        Assert.Equal(1, commonReplay.CheckedCount);

        var expectedRoom = roomItem.Quantity * roomActual;
        var expectedCommon = commonItem.Quantity * commonActual;
        var capital = (await owner.GetFromJsonAsync<CapitalAssets>(
            $"/api/v1/locations/{location}/capital-assets"))!;
        Assert.Equal((expectedRoom + expectedCommon).ToString("0"), capital.KnownTotal);
        Assert.Equal(expectedRoom.ToString("0"), capital.RoomsTotal);
        Assert.Equal(expectedCommon.ToString("0"), capital.CommonTotal);
        Assert.Equal(0, capital.UnpricedCount);
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(2, await db.Set<Asset>().CountAsync(item => item.LocationId == location));
        var roomAsset = await db.Set<Asset>().AsNoTracking()
            .SingleAsync(item => item.LocationId == location && item.RoomId != null);
        var confirmedPrice = (await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>()
            .AssetMetadataAsync([roomAsset.Id], default))[roomAsset.Id];
        var metadataDocument = (await owner.GetFromJsonAsync<SetupDocument>(
            $"/api/v1/assets/{roomAsset.Id}/metadata"))!;
        Assert.Equal(roomActual, confirmedPrice.PurchaseCost);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(
            $"/api/v1/assets/{roomAsset.Id}/metadata",
            new AssetMetadataWrite(confirmedPrice with { PurchaseCost = 2_500_000m },
                metadataDocument.Version, "Changing verified price is forbidden"))).StatusCode);
        var unchanged = (await owner.GetFromJsonAsync<CapitalAssets>(
            $"/api/v1/locations/{location}/capital-assets"))!;
        Assert.Equal(capital.KnownTotal, unchanged.KnownTotal);
    }
}
