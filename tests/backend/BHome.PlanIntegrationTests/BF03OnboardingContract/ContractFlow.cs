using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF03OnboardingContract;

/// <summary>A new Location + Room created for one test (staff account assigned from today).</summary>
public sealed record Workspace(string LocationId, string RoomId);

/// <summary>An Active Main Contract with confirmed Initial readings (and, when requested, a completed move-in handover).</summary>
public sealed record Lease(Workspace Space, string ResidentId, string ContractId, string ElectricityMeterId, string WaterMeterId, string ElectricityReadingId, string WaterReadingId);

/// <summary>
/// Drives the documented BF-03/BF-04 calls step by step as Owner/Staff/Tenant. Routes and bodies come only from
/// docs/api (CONTRACT_LIFECYCLE.md, LOCATION_ROOM_API.md, API_RUNTIME_ROUTES.md), docs/development
/// (CONTRACT_LIFECYCLE_DELIVERY.md, MAIN_TENANCY_DRAFT.md, STAFF_LOCATION_ASSIGNMENTS.md, OCR_MOBILE_DELIVERY.md)
/// and the Postman collection BHome.NguyenQuocHuy.Implemented.postman_collection.json.
/// </summary>
public sealed class ContractFlow(PlanSessions sessions)
{
    public const string Rent = "3000000";

    public PlanApi Api => sessions.Api;

    public static DateOnly Today => PlanData.TodayVietnam;

    public static string Iso(DateOnly d) => PlanData.Iso(d);

    public Task<string> Token(string account) => sessions.TokenAsync(account);

    public async Task<string> UserIdAsync(string account)
        => (await sessions.SessionAsync(account)).UserId ?? throw new InvalidOperationException($"Login of '{account}' returned no userId.");

    public static JsonElement Parse(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    public static string Id(JsonElement json, string what)
        => json.Str("id") ?? throw new InvalidOperationException($"{what}: the answer has no id. Body: {json.GetRawText()}");

    public static string Synthetic12Digits() => "0" + Random.Shared.NextInt64(10_000_000_000, 99_999_999_999).ToString();

    // ---------- generic calls ----------
    public async Task<JsonElement> GetOkAsync(string path, string account, string? step = null)
    {
        using var r = await Api.GetAsync(path, await Token(account));
        return Parse(await PlanAssert.SuccessAsync(r, step ?? "GET " + path));
    }

    /// <summary>Contract mutations need a UUID Idempotency-Key (docs/api/CONTRACT_LIFECYCLE.md "Client").</summary>
    public async Task<HttpResponseMessage> PostKeyedAsync(string path, object? body, string account, string? key = null)
        => await Api.PostAsync(path, body, await Token(account), PlanData.IdempotencyKey(key));

    public async Task<JsonElement> PostKeyedOkAsync(string path, object? body, string account, string step, string? key = null)
    {
        using var r = await PostKeyedAsync(path, body, account, key);
        var text = await PlanAssert.SuccessAsync(r, step);
        return string.IsNullOrWhiteSpace(text) ? default : Parse(text);
    }

    public async Task<JsonElement> UploadPngOkAsync(HttpMethod method, string path, string account, string step)
    {
        using var r = await Api.SendBytesAsync(method, path, PlanData.TinyPng, "image/png", await Token(account));
        return Parse(await PlanAssert.SuccessAsync(r, step));
    }

    // ---------- property setup (LOCATION_ROOM_API.md, STAFF_LOCATION_ASSIGNMENTS.md) ----------
    public async Task<string> CreateLocationAsync()
    {
        using var r = await Api.PostAsync("api/v1/locations", new { name = PlanData.Unique("BF Location"), address = "Synthetic address for integration tests", isActive = true }, await Token("owner"));
        return Id(Parse(await PlanAssert.SuccessAsync(r, "create Location")), "create Location");
    }

    public async Task<HttpResponseMessage> AssignAsync(string locationId, string staffAccount, DateOnly start, DateOnly end)
        => await Api.PostAsync(
            "api/v1/staff-location-assignments",
            new { locationId, staffUserId = await UserIdAsync(staffAccount), startDate = Iso(start), endDate = Iso(end) },
            await Token("owner"));

    public async Task AssignOkAsync(string locationId, string staffAccount, DateOnly start, DateOnly end)
    {
        using var r = await AssignAsync(locationId, staffAccount, start, end);
        await PlanAssert.SuccessAsync(r, $"assign {staffAccount} to the Location");
    }

    public async Task<string> CreateRoomAsync(string locationId, int capacity = 3)
    {
        var body = new { locationId, roomNumber = "IT" + Random.Shared.Next(1000, 9999), floor = "1", capacity, status = 0 };
        using var r = await Api.PostAsync("api/v1/rooms", body, await Token("owner"));
        return Id(Parse(await PlanAssert.SuccessAsync(r, "create Room")), "create Room");
    }

    /// <summary>RENT(0,0), ELECTRICITY(1,1), WATER(2,1) at Location scope from today (Postman guide 5.3).</summary>
    public async Task CreatePricesAsync(string locationId)
    {
        foreach (var (category, code, name, method, rate) in new[] { (0, "RENT", "Rent", 0, 3000000), (1, "ELECTRICITY", "Electricity", 1, 3500), (2, "WATER", "Water", 1, 15000) })
        {
            var body = new { locationId, roomId = (string?)null, category, chargeCode = code, name, method, rate, effectiveFrom = Iso(Today), effectiveTo = (string?)null, reason = "Synthetic integration test price" };
            using var r = await Api.PostAsync("api/v1/billing-policies", body, await Token("owner"));
            await PlanAssert.SuccessAsync(r, "create billing policy " + code);
        }
    }

    /// <summary>New Location with prices, the "staff" account assigned from today, and one Room.</summary>
    public async Task<Workspace> NewWorkspaceAsync(int capacity = 3)
    {
        var locationId = await CreateLocationAsync();
        await AssignOkAsync(locationId, "staff", Today, Today.AddDays(400));
        await CreatePricesAsync(locationId);
        return new Workspace(locationId, await CreateRoomAsync(locationId, capacity));
    }

    public async Task<string?> RoomStatusAsync(string roomId) => (await GetOkAsync($"api/v1/rooms/{roomId}", "owner", "read Room")).Str("status");

    /// <summary>Room status is an enum: requests use 0 Available, 2 Occupied (Postman Simple /69); answers may use the number or the name.</summary>
    public static bool RoomIs(string? status, string name, int code)
        => string.Equals(status, name, StringComparison.OrdinalIgnoreCase) || status == code.ToString();

    // ---------- onboarding / identity (Capture API, OCR_MOBILE_DELIVERY.md) ----------
    public async Task<string> CreateResidentAsync(string roomId, string staffAccount = "staff")
    {
        using var r = await Api.PostAsync("api/v1/capture/residents", new { roomId, displayLabel = PlanData.Unique("Resident"), residentType = 0 }, await Token(staffAccount));
        return Id(Parse(await PlanAssert.SuccessAsync(r, "create Resident")), "create Resident");
    }

    public static object Identity(string citizenNumber, string fullName) => new
    {
        humanConfirmed = true,
        citizenIdentityNumber = citizenNumber,
        fullName,
        dateOfBirth = "2000-01-01",
        residentialAddress = "SYNTHETIC ADDRESS",
        gender = (string?)null,
        nationality = (string?)null,
        placeOfOrigin = (string?)null,
        dateOfIssue = "2021-01-01",
        dateOfExpiry = (string?)null,
    };

    public async Task<HttpResponseMessage> ConfirmIdentityAsync(string residentId, object identity, string staffAccount = "staff")
        => await Api.PostAsync($"api/v1/capture/residents/{residentId}/confirm", identity, await Token(staffAccount));

    public async Task<string> VerifiedResidentAsync(string roomId)
    {
        var residentId = await CreateResidentAsync(roomId);
        using var r = await ConfirmIdentityAsync(residentId, Identity(Synthetic12Digits(), "NGUOI THUE TONG HOP"));
        await PlanAssert.SuccessAsync(r, "confirm synthetic identity");
        return residentId;
    }

    public async Task LinkTenantAsync(string residentId, string tenantAccount = "tenant")
    {
        using var r = await Api.PostAsync($"api/v1/contracts/preparation/residents/{residentId}/account", new { tenantUserId = await UserIdAsync(tenantAccount) }, await Token("owner"));
        await PlanAssert.SuccessAsync(r, "Owner links Resident to the Tenant account");
    }

    // ---------- Main Contract: draft, sign, deposit, activate (CONTRACT_LIFECYCLE_DELIVERY.md §3) ----------
    public async Task<HttpResponseMessage> CreateContractRawAsync(string roomId, string residentId, string tenantAccount, string deposit, string account = "owner", DateOnly? start = null, DateOnly? end = null)
    {
        var from = start ?? Today;
        var body = new
        {
            roomId,
            ownerSignerId = await UserIdAsync("owner"),
            tenantUserId = await UserIdAsync(tenantAccount),
            representativeResidentId = residentId,
            residentIds = new[] { residentId },
            startDate = Iso(from),
            endDate = Iso(end ?? from.AddYears(1).AddDays(-1)),
            monthlyRent = Rent,
            requiredDeposit = deposit,
            terms = "SYNTHETIC INTEGRATION TEST CONTRACT - NOT A LEGAL SIGNING RESULT",
            holdingContractId = (string?)null,
        };
        return await PostKeyedAsync("api/v1/contracts", body, account);
    }

    /// <summary>Verified Resident linked to the Tenant + Draft Main Contract.</summary>
    public async Task<(string ResidentId, string ContractId)> DraftContractAsync(string roomId, string tenantAccount = "tenant", string deposit = "0")
    {
        var residentId = await VerifiedResidentAsync(roomId);
        await LinkTenantAsync(residentId, tenantAccount);
        using var r = await CreateContractRawAsync(roomId, residentId, tenantAccount, deposit);
        return (residentId, Id(Parse(await PlanAssert.SuccessAsync(r, "create Draft Main Contract")), "create contract"));
    }

    /// <summary>
    /// Signing goes through the provider port. The documented development path is the opt-in simulation adapter
    /// (CONTRACT_MANAGEMENT_WORKFLOW.md; Postman guide 5.2: certificate Guid.Empty in Simulated Development).
    /// </summary>
    public async Task RequireSimulatedSigningAsync()
    {
        var config = await GetOkAsync("api/v1/contracts/configuration", "owner", "read contract configuration");
        var mode = config.Str("signingMode") ?? string.Empty;
        Skip.IfNot(mode.Contains("simulat", StringComparison.OrdinalIgnoreCase), $"Needs the external signing provider: signingMode is '{mode}', not the documented development simulation.");
        Skip.If(config.Str("template.available") == "false", $"The contract PDF template is not available ({config.Str("template.blocker")}); signing cannot be prepared.");
    }

    public async Task GeneratePreviewAsync(string contractId)
        => await PostKeyedOkAsync($"api/v1/contracts/{contractId}/previews", null, "owner", "Owner generates the preview PDF");

    public async Task<HttpResponseMessage> RequestSigningAsync(string contractId, string account)
        => await PostKeyedAsync($"api/v1/contracts/{contractId}/signing", new { certificateId = Guid.Empty }, account);

    /// <summary>Request signing then sync (signing/sync needs no Idempotency-Key). Returns the synced ContractView.</summary>
    public async Task<JsonElement> SignAsync(string contractId, string account)
    {
        using (var r = await RequestSigningAsync(contractId, account))
        {
            await PlanAssert.SuccessAsync(r, account + " requests signing");
        }

        using var sync = await Api.PostAsync($"api/v1/contracts/{contractId}/signing/sync", null, await Token(account));
        return Parse(await PlanAssert.SuccessAsync(sync, account + " syncs signing"));
    }

    public async Task SignBothAsync(string contractId, string tenantAccount = "tenant")
    {
        await GeneratePreviewAsync(contractId);
        await SignAsync(contractId, "owner");
        await SignAsync(contractId, tenantAccount);
    }

    public async Task<HttpResponseMessage> VerifyDepositAsync(string contractId, string reference, string amount, string? key = null)
        => await PostKeyedAsync(
            $"api/v1/contracts/{contractId}/deposit-verifications",
            new { bankTransactionReference = reference, amount, verificationReason = "SYNTHETIC STATEMENT - NO REAL BANK PAYMENT" },
            "owner",
            key);

    public async Task<HttpResponseMessage> ActivateAsync(string contractId, string account = "owner", string? key = null)
        => await PostKeyedAsync($"api/v1/contracts/{contractId}/activate", null, account, key);

    public async Task<JsonElement> ReadinessAsync(string contractId)
        => await GetOkAsync($"api/v1/contracts/{contractId}/activation-readiness", "owner", "read activation readiness");

    public static IReadOnlyList<string> Strings(JsonElement json, string path)
        => json.Find(path) is { ValueKind: JsonValueKind.Array } a ? a.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : e.GetRawText()).ToList() : [];

    // ---------- meters (Capture API; Postman guide 5.3) ----------
    public async Task<string> CreateMeterAsync(string roomId, int utilityType)
    {
        var body = new { roomId, code = $"IT-{utilityType}-{Guid.NewGuid():N}"[..20], utilityType, display = 1, decimalPlaces = 0, installedOn = Iso(Today) };
        using var r = await Api.PostAsync("api/v1/capture/meters", body, await Token("owner"));
        return Id(Parse(await PlanAssert.SuccessAsync(r, "create meter")), "create meter");
    }

    /// <summary>Owner creates the task, Staff uploads the photo and human-confirms the value. purpose: 0 Initial, 1 Periodic, 2 Final.</summary>
    public async Task<string> ConfirmedReadingAsync(string meterId, int purpose, string value, string? contractId = null)
    {
        using var t = await Api.PostAsync("api/v1/capture/meter-tasks", new { meterId, purpose, readingDate = Iso(Today), billingPeriod = (string?)null, contractId }, await Token("owner"));
        var taskId = Id(Parse(await PlanAssert.SuccessAsync(t, "create meter task")), "meter task");
        var evidence = await UploadPngOkAsync(HttpMethod.Put, $"api/v1/capture/meter-tasks/{taskId}/evidence", "staff", "upload meter photo");
        using var c = await Api.PostAsync($"api/v1/capture/meter-tasks/{taskId}/confirm", new { humanConfirmed = true, confirmedValue = value, evidenceId = Id(evidence, "meter evidence") }, await Token("staff"));
        return Id(Parse(await PlanAssert.SuccessAsync(c, "Staff confirms the meter reading")), "reading");
    }

    // ---------- complete chains ----------
    /// <summary>Workspace → meters with confirmed Initial readings → Draft → both sign → deposit (if any) → Owner activation.</summary>
    public async Task<Lease> ActiveLeaseAsync(string deposit = "0", string tenantAccount = "tenant")
    {
        await RequireSimulatedSigningAsync();
        var space = await NewWorkspaceAsync();
        var electricity = await CreateMeterAsync(space.RoomId, 0);
        var water = await CreateMeterAsync(space.RoomId, 1);
        var electricityReading = await ConfirmedReadingAsync(electricity, 0, "100");
        var waterReading = await ConfirmedReadingAsync(water, 0, "100");
        var (residentId, contractId) = await DraftContractAsync(space.RoomId, tenantAccount, deposit);
        await SignBothAsync(contractId, tenantAccount);
        if (deposit != "0")
        {
            using var d = await VerifyDepositAsync(contractId, "IT-REF-" + Guid.NewGuid().ToString("N")[..12], deposit);
            await PlanAssert.SuccessAsync(d, "verify deposit");
        }

        using (var a = await ActivateAsync(contractId))
        {
            await PlanAssert.SuccessAsync(a, "Owner activates the contract");
        }

        return new Lease(space, residentId, contractId, electricity, water, electricityReading, waterReading);
    }

    public object HandoverBody(int version, Lease lease, string evidenceId, string condition) => new
    {
        version,
        date = Iso(Today),
        roomCondition = condition,
        keysAndAccess = "2 synthetic keys",
        notes = "SYNTHETIC HANDOVER",
        assets = Array.Empty<object>(),
        electricityReadingId = lease.ElectricityReadingId,
        waterReadingId = lease.WaterReadingId,
        evidenceIds = new[] { evidenceId },
    };

    /// <summary>Staff records the handover, Tenant confirms the version, Staff completes it (move-in baseline).</summary>
    public async Task<Lease> HandedOverLeaseAsync()
    {
        var lease = await ActiveLeaseAsync();
        var c = lease.ContractId;
        var evidence = Id(await UploadPngOkAsync(HttpMethod.Post, $"api/v1/contracts/{c}/handover/evidence", "staff", "upload handover photo"), "handover evidence");
        var saved = await PostKeyedOkAsync($"api/v1/contracts/{c}/handover", HandoverBody(0, lease, evidence, "Room in good synthetic condition"), "staff", "Staff saves the handover");
        var version = int.Parse(saved.Str("version") ?? "0");
        await PostKeyedOkAsync($"api/v1/contracts/{c}/handover/tenant-confirmation", new { version, note = "Tenant confirms" }, "tenant", "Tenant confirms the handover");
        await PostKeyedOkAsync($"api/v1/contracts/{c}/handover/staff-confirmation", new { version, note = "Staff completes" }, "staff", "Staff completes the handover");
        return lease;
    }

    // ---------- Main Draft (MAIN_TENANCY_DRAFT.md) ----------
    public async Task<JsonElement> MainDraftPreparationAsync(string roomId, string representativeId, IEnumerable<string> residentIds, string account = "staff")
    {
        var query = string.Concat(residentIds.Select(id => "&residentIds=" + id));
        return await GetOkAsync($"api/v1/contracts/main-drafts/preparation?roomId={roomId}&representativeResidentId={representativeId}{query}&effectiveOn={Iso(Today)}", account, "open the onboarding (Main Draft preparation)");
    }

    /// <summary>
    /// The Main Draft needs Owner contract settings for the Location (PUT main-drafts/settings/{locationId}); the
    /// MainContractSettingsInput "Owner profile" fields are not documented, so the test cannot create them and skips instead.
    /// </summary>
    public async Task RequireMainDraftReadyAsync(string roomId, string representativeId, IEnumerable<string> residentIds)
    {
        var prep = await MainDraftPreparationAsync(roomId, representativeId, residentIds);
        var blockers = Strings(prep, "blockers");
        Skip.If(
            blockers.Count > 0,
            "Precondition not met: Main Draft preparation reports blockers [" + string.Join(", ", blockers) + "]. The Owner contract settings body (MainContractSettingsInput 'Owner profile') is not documented in docs/api or docs/development, so the test cannot configure it.");
    }

    public static object MainDraftInput(string roomId, string representativeId, IEnumerable<string> residentIds, DateOnly start, DateOnly end, int expectedVersion = 0) => new
    {
        roomId,
        representativeResidentId = representativeId,
        residentIds = residentIds.ToArray(),
        startDate = Iso(start),
        endDate = Iso(end),
        notes = "SYNTHETIC MAIN DRAFT",
        tenantPhone = "0900000000",
        tenantPlaceOfIssue = "SYNTHETIC PLACE OF ISSUE",
        expectedVersion,
    };

    public async Task<HttpResponseMessage> CreateMainDraftAsync(object input, string account = "staff", string? key = null)
        => await PostKeyedAsync("api/v1/contracts/main-drafts", input, account, key);

    public async Task<JsonElement> MainDraftOkAsync(string roomId, string representativeId, IEnumerable<string> residentIds)
    {
        using var r = await CreateMainDraftAsync(MainDraftInput(roomId, representativeId, residentIds, Today, Today.AddYears(1).AddDays(-1)));
        return Parse(await PlanAssert.SuccessAsync(r, "create the Main Draft"));
    }

    public async Task<int> CountContractsAsync(string locationId)
        => int.Parse((await GetOkAsync($"api/v1/contracts?page=1&pageSize=100&locationId={locationId}", "owner", "list contracts")).Str("totalCount") ?? "0");
}
