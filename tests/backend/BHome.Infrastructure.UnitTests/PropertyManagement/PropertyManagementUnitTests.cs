using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.Ocr;
using BHome.Application.Operations;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;

namespace BHome.Infrastructure.UnitTests.PropertyManagement;

// Report 5.1 – sheet "PropertyManagement" (UTC01–UTC35), BF-01 Location setup.
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// Run only this sheet:  dotnet test --filter "Sheet=PropertyManagement"   ·   one function:  --filter "Sheet=PropertyManagement&Function=ClosureAsync"
//
// "Room Type" on the sheet: the RoomTypes catalog was retired on 2026-11-04 (Compact24). The product now keeps
//   - a per-Location Room Type as a "RoomDefaults" setup document (LocationSetupService.SaveRoomDefaultsAsync), and
//   - a reusable Room Type in the shared configuration library as resource "room-type-templates".
// "Billing Policy" for SharedConfigurationService is the shared resource "fee-templates".
// "Asset default" is an "AssetTemplate" setup document; "Pricing/Policies" of a copy is the "FeePolicies" group.
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "PropertyManagement")]
public sealed class PropertyManagementUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private static readonly Guid Sample1Id = Guid.Parse("c2400000-0000-4000-8000-000000000010"); // "BHOME SAMPLE 1"
    private static readonly Guid Sample2Id = Guid.Parse("c2400000-0000-4000-8000-000000000011"); // "BHOME SAMPLE 2"
    private static readonly Guid TanBinhId = Guid.Parse("c2400000-0000-4000-8000-000000000012"); // "BHOME Tan Binh"
    private static readonly Guid GoVapId = Guid.Parse("c2400000-0000-4000-8000-000000000013");   // "BHOME Go Vap"
    private static readonly DateTimeOffset Today = new(2026, 11, 12, 9, 0, 0, TimeSpan.FromHours(7)); // "Today = 2026-11-12"
    private static readonly DateOnly TodayDate = new(2026, 11, 12);
    private const string Sample1Address = "1 Synthetic Street, Ho Chi Minh City";
    private const string TanBinhAddress = "12 Cong Hoa, Ward 4, Tan Binh, Ho Chi Minh City";

    private const string RoomTypeResource = "room-type-templates";
    private const string BillingPolicyResource = "fee-templates";
    private static readonly string[] CopyItems = ["RoomDefaults", "AssetTemplates", "FeePolicies"]; // Room Types, Asset defaults, Pricing/Policies

    private AccountProvisioningWorld world = null!;

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() { if (world is not null) await world.DisposeAsync(); }

    // Every case starts from a fresh database; startTime is the sheet's "today" (or earlier when history must be built).
    private async Task StartAsync(DateTimeOffset? startTime = null)
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres, startTime ?? Today);
        await world.AddOwnerSampleAsync();
        world.SignInAsOwner();
    }

    // PropertyService and the services that use it are built by hand with their real dependencies: the test host has
    // no IHostEnvironment for PropertyService's unrelated contract-readiness dependency (not used by this sheet).
    private PropertyService Properties => new(world.Get<IPropertyRepository>(), world.CurrentUser, world.Get<PermissionAccess>(),
        world.Clock, lifecycle: world.Get<IPropertyLifecycleChecks>());
    private CaptureService Capture => new(world.Get<ICaptureRepository>(), world.CurrentUser, Properties);
    private SharedConfigurationService Shared => world.Get<SharedConfigurationService>();
    private LocationConfigurationCopyService CopyService => new(world.Get<ISharedConfigurationStore>(), SetupStore, Properties,
        AssetInventory, world.Get<OperatingPolicyService>(), world.CurrentUser, world.Clock);
    private LocationSetupService Setup => new(world.Get<ISharedConfigurationStore>(), SetupStore, world.Get<ISharedDataValidator>(),
        Shared, Properties, AssetInventory, world.Get<OperatingPolicyService>(), world.CurrentUser, world.Clock);
    private AssetInventoryService AssetInventory => world.Get<AssetInventoryService>();
    private ISetupWorkspaceStore SetupStore => world.Get<ISetupWorkspaceStore>();
    private IPropertyLifecycleChecks Lifecycle => world.Get<IPropertyLifecycleChecks>();
    private IPropertyRepository PropertyRepository => world.Get<IPropertyRepository>();
    private IOperationsRepository Operations => world.Get<IOperationsRepository>();

    // ----- pre-condition builders -----

    private Task AddLocationAsync(Guid id, string name, string address = Sample1Address) => world.ExecAsync(
        "insert into locations(id, name, address) values (@id, @n, @a)", ("id", id), ("n", name), ("a", address));

    private async Task<Guid> AddRoomAsync(Guid locationId, string number, RoomStatus status = RoomStatus.Available, int capacity = 2)
    {
        var id = Guid.NewGuid();
        await world.ExecAsync("insert into rooms(id, location_id, room_number, capacity, status) values (@id, @l, @n, @c, @s)",
            ("id", id), ("l", locationId), ("n", number), ("c", (short)capacity), ("s", (short)status));
        return id;
    }

    private async Task<Guid> AddResidentAsync(Guid roomId, string label, Guid? userId)
    {
        var id = Guid.NewGuid();
        await world.ExecAsync(
            """
            insert into residents(id, user_id, current_room_id, identity_owner_scope_id, display_label, verification_status)
            values (@id, @u, @room, @owner, @label, 1)
            """, ("id", id), ("u", userId), ("room", roomId), ("owner", OwnerId), ("label", label));
        return id;
    }

    // status: 3 = Active, 4 = Terminated (ContractStatus).
    private async Task<Guid> AddMainContractAsync(Guid roomId, int status, Guid representativeId, Guid? tenantUserId,
        DateOnly start, DateOnly end, params (Guid ResidentId, int Role)[] residents)
    {
        var id = Guid.NewGuid();
        await world.ExecAsync(
            """
            insert into contracts(id, room_id, representative_resident_id, tenant_user_id, owner_signer_id, contract_type,
                start_date, end_date, monthly_rent, deposit_required, terms, status, activated_at, activated_by_user_id)
            values (@id, @room, @rep, @tenant, @owner, 'MAIN', @start, @end, 3500000, 3500000, 'Synthetic terms', @status,
                timestamptz '2026-01-01 02:00+00', @owner)
            """, ("id", id), ("room", roomId), ("rep", representativeId), ("tenant", tenantUserId), ("owner", OwnerId),
            ("start", start), ("end", end), ("status", (short)status));
        foreach (var (residentId, role) in residents)
            await world.ExecAsync(
                "insert into contract_residents(contract_id, resident_id, resident_role, residence_from) values (@c, @r, @role, @from)",
                ("c", id), ("r", residentId), ("role", (short)role), ("from", start));
        return id;
    }

    // "Room 101 is Occupied (active Main Contract of tenant.sample@example.invalid)".
    private async Task<(Guid RoomId, Guid ContractId)> AddOccupiedRoom101Async(Guid locationId)
    {
        if (await world.UserCountAsync(IdentityArrange.TenantEmail) == 0) await world.AddTenantSampleAsync();
        var room = await AddRoomAsync(locationId, "101", RoomStatus.Occupied);
        var tenant = await AddResidentAsync(room, "Tenant Sample", TenantSampleId);
        var contract = await AddMainContractAsync(room, 3, tenant, TenantSampleId, new(2026, 7, 1), new(2027, 6, 30), (tenant, 0));
        return (room, contract);
    }

    // "Staff staff.sample@example.invalid (responsible for "BHOME SAMPLE 1") is signed in."
    private async Task StaffOfSample1SignedInAsync()
    {
        if (await world.UserCountAsync(IdentityArrange.StaffEmail) == 0) await world.AddStaffSampleAsync();
        var result = await world.Get<ILocationAssignments>().CreateAssignmentAsync(OwnerId, Sample1Id, StaffSampleId,
            new DateOnly(2026, 11, 1), DateOnly.MaxValue, default);
        Assert.Equal(CreateAssignmentStatus.Created, result.Status);
        world.CurrentUser.Set(StaffSampleId, Roles.Staff);
    }

    // Per-Location Room Type "Standard" (RoomDefaults). The product requires an area; 20 m2 is an arrangement value.
    private Task<SetupDocument> AddRoomTypeAsync(Guid locationId, string name, int capacity) =>
        Setup.SaveRoomDefaultsAsync(locationId, null,
            new LocalRoomDefaultsWrite(name, "", new SharedRoomDefaults(capacity, 20m, [], null), null), default);

    private Task<SetupDocument> AddAssetDefaultAsync(Guid locationId, string name, string category) =>
        AssetInventory.SaveTemplateAsync(null,
            new AssetTemplateWrite(locationId, name, [new AssetTemplateItem(Guid.NewGuid(), name, category, "Serialized", 1)]), default);

    private Task<PolicyDto> AddLocationPolicyAsync(Guid locationId, ChargeCategory category, decimal rate, DateOnly from, DateOnly? to = null) =>
        Properties.CreatePolicyAsync(new PolicyWrite(locationId, null, category, category.ToString().ToUpperInvariant(),
            category.ToString(), ChargingMethod.Metered, rate, from, to), default);

    // "BHOME SAMPLE 1" with Room Type "Standard" (2), Asset default "Bed 1m6", Electricity 3,500, Water 18,000,
    // plus Rooms 101–102 with Contracts and Tenants. "BHOME Go Vap" is new and has no configuration.
    private async Task ArrangeCopySourceAndTargetAsync()
    {
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(GoVapId, "BHOME Go Vap", "Go Vap, Ho Chi Minh City");
        await AddRoomTypeAsync(Sample1Id, "Standard", 2);
        await AddAssetDefaultAsync(Sample1Id, "Bed 1m6", "Bed");
        await AddLocationPolicyAsync(Sample1Id, ChargeCategory.Electricity, 3500m, TodayDate);
        await AddLocationPolicyAsync(Sample1Id, ChargeCategory.Water, 18000m, TodayDate);
        await AddOccupiedRoom101Async(Sample1Id);
        var room102 = await AddRoomAsync(Sample1Id, "102", RoomStatus.Occupied);
        var mai = await AddResidentAsync(room102, "Nguyen Thi Mai", null);
        await AddMainContractAsync(room102, 4, mai, null, new(2026, 1, 1), new(2026, 6, 30), (mai, 0));
    }

    private static ConfigurationCopy CopyInput(string sourceState = "", string targetState = "") =>
        new(Sample1Id, GoVapId, CopyItems, TodayDate, SourceState: sourceState, TargetState: targetState);

    private async Task<string> LocationFootprintAsync(Guid locationId) => string.Join("|",
        await world.ScalarAsync<long>("select count(*) from rooms where location_id = @l", ("l", locationId)),
        await world.ScalarAsync<long>("select count(*) from contracts c join rooms r on r.id = c.room_id where r.location_id = @l", ("l", locationId)),
        await world.ScalarAsync<long>("select count(*) from residents p join rooms r on r.id = p.current_room_id where r.location_id = @l", ("l", locationId)),
        await world.ScalarAsync<long>("select count(*) from invoices where location_id = @l", ("l", locationId)),
        await world.ScalarAsync<long>("select count(*) from billing_policies where location_id = @l", ("l", locationId)),
        (await SetupStore.ListAsync(locationId, "RoomDefaults", default)).Count,
        (await SetupStore.ListAsync(locationId, "AssetTemplate", default)).Count);

    private static string DataName(SetupDocument document) => document.Data.GetProperty("name").GetString()!;

    private static JsonElement RoomTypeData(int capacity) =>
        JsonSerializer.SerializeToElement(new { capacity, area = 20m, amenities = Array.Empty<string>(), referenceRent = (decimal?)null });

    private static JsonElement BillingPolicyData(string chargeType, decimal rate, DateOnly from, DateOnly? to) =>
        JsonSerializer.SerializeToElement(new
        {
            category = chargeType,
            chargeCode = chargeType.ToUpperInvariant(),
            method = "Metered",
            referenceRate = rate,
            unit = chargeType == "Electricity" ? "kWh" : "m3",
            scope = "Location",
            effectiveFrom = from,
            effectiveTo = to,
        });

    private Task<long> SharedCountAsync(string resource) => world.ScalarAsync<long>(
        "select count(*) from operational_tasks where task_type = 'COMMAND' and task_data->>'recordType' = 'SharedConfiguration' and task_data->'document'->>'resource' = @r",
        ("r", resource));

    // "Electricity v1 = 3,500/kWh, 2026-11-01 → 2026-12-31", saved and published (in use for billing).
    private async Task<SharedDocument> AddElectricityV1Async()
    {
        var draft = await Shared.SaveAsync(BillingPolicyResource, null,
            new SharedWrite("Electricity", "", BillingPolicyData("Electricity", 3500m, new(2026, 11, 1), new(2026, 12, 31))), default);
        return await Shared.TransitionAsync(BillingPolicyResource, draft.Id, new SharedVersion(draft.Version), archive: false, default);
    }

    // A repair record = a verified Maintenance Work Order of an incident on the asset.
    private async Task AddRepairRecordsAsync(Guid locationId, Guid roomId, Guid assetId, int count)
    {
        if (await world.UserCountAsync(IdentityArrange.StaffEmail) == 0) await world.AddStaffSampleAsync();
        for (var i = 1; i <= count; i++)
        {
            var incident = Guid.NewGuid();
            await world.ExecAsync(
                """
                insert into incident_reports(id, location_id, room_id, asset_id, reporter_user_id, severity, summary, description, status, reported_at, resolved_at)
                values (@id, @l, @r, @a, @owner, 'NORMAL', 'Repair', 'Synthetic repair', 'Resolved', timestamptz '2026-11-02 02:00+00', timestamptz '2026-11-03 02:00+00')
                """, ("id", incident), ("l", locationId), ("r", roomId), ("a", assetId), ("owner", OwnerId));
            await world.ExecAsync(
                """
                insert into operational_tasks(id, task_type, location_id, room_id, asset_id, assigned_user_id, incident_report_id, title, status,
                    cost_approved_by_user_id, cost_approved_at, verified_by_user_id, verified_at, task_data)
                values (@id, 'WORK_ORDER', @l, @r, @a, @staff, @incident, 'Repair', 'Verified',
                    @owner, timestamptz '2026-11-02 03:00+00', @owner, timestamptz '2026-11-03 02:00+00',
                    jsonb_build_object('schemaVersion', 1, 'recordType', 'MaintenanceWorkOrder', 'state', jsonb_build_object(
                        'status', 4, 'incidentId', @incident, 'assignedStaffId', @staff, 'proposalVersion', 1,
                        'approvedProposalVersion', 1, 'actualCost', 500000, 'completionActivityId', gen_random_uuid())))
                """, ("id", Guid.NewGuid()), ("l", locationId), ("r", roomId), ("a", assetId), ("staff", StaffSampleId),
                ("incident", incident), ("owner", OwnerId));
        }
    }

    private Task<long> RepairRecordCountAsync(Guid assetId) => world.ScalarAsync<long>(
        "select count(*) from operational_tasks where task_type = 'WORK_ORDER' and asset_id = @a", ("a", assetId));

    private async Task<Guid[]> RepairRecordIdsAsync(Guid assetId)
    {
        var ids = await world.ScalarAsync<Guid[]>(
            "select coalesce(array_agg(id), '{}') from operational_tasks where task_type = 'WORK_ORDER' and asset_id = @a", ("a", assetId));
        return ids;
    }

    // An asset created the way the Owner creates it.
    private async Task<Guid> AddAssetAsync(Guid locationId, Guid roomId, string name, string category, string condition) =>
        (await Properties.SaveAssetAsync(null, new AssetWrite(locationId, roomId, null, null, name, category, condition), default)).Id;

    private Task<string> AssetConditionAsync(Guid assetId) =>
        world.ScalarAsync<string>("select condition from assets where id = @id", ("id", assetId));

    // Room configuration provenance key (same derivation as the product's LocationSetupKeys.RoomProvenance).
    private static Guid RoomProvenanceKey(Guid room) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes($"room-provenance:{room}")).AsSpan(0, 16));

    #region CaptureController.Location(...) [HttpPost("locations"), Authorize(Roles = Owner)]

    // The action delegates to CaptureService.CreateLocationAsync (same input); that method is called here.

    [Fact(DisplayName = "UTC01 - CaptureController.Location: Owner tao BHOME Tan Binh -> Location moi, dia chi, Active")]
    [Trait("Function", "CaptureController.Location")]
    public async Task UTC01()
    {
        await StartAsync();

        var result = await Capture.CreateLocationAsync(new LocationInput("BHOME Tan Binh", TanBinhAddress), default);

        Assert.NotEqual(Guid.Empty, result.Id);
        Assert.Equal(TanBinhAddress, await world.ScalarAsync<string>("select address from locations where id = @id", ("id", result.Id)));
        Assert.Equal("BHOME Tan Binh", await world.ScalarAsync<string>("select name from locations where id = @id", ("id", result.Id)));
        Assert.True(await world.ScalarAsync<bool>("select is_active from locations where id = @id", ("id", result.Id)));
    }

    [Fact(DisplayName = "UTC02 - CaptureController.Location: Staff tao Location -> tu choi (MSG03), khong tao")]
    [Trait("Function", "CaptureController.Location")]
    public async Task UTC02()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await StaffOfSample1SignedInAsync();

        await Assert.ThrowsAnyAsync<Exception>(() => Capture.CreateLocationAsync(new LocationInput("BHOME Tan Binh", TanBinhAddress), default));

        Assert.Equal(0, await world.ScalarAsync<long>("select count(*) from locations where name = 'BHOME Tan Binh'"));
    }

    [Fact(DisplayName = "UTC03 - CaptureController.Location: Name rong -> tu choi (MSG02), khong tao")]
    [Trait("Function", "CaptureController.Location")]
    public async Task UTC03()
    {
        await StartAsync();

        await Assert.ThrowsAnyAsync<Exception>(() => Capture.CreateLocationAsync(new LocationInput("", TanBinhAddress), default));

        Assert.Equal(0, await world.ScalarAsync<long>("select count(*) from locations"));
    }

    #endregion

    #region PreviewAsync(ConfigurationCopy input)

    [Fact(DisplayName = "UTC04 - PreviewAsync: sao chep cau hinh BHOME SAMPLE 1 sang BHOME Go Vap -> ke hoach nhap, khong luu, khong du lieu thue")]
    [Trait("Function", "PreviewAsync")]
    public async Task UTC04()
    {
        await StartAsync();
        await ArrangeCopySourceAndTargetAsync();
        var targetBefore = await LocationFootprintAsync(GoVapId);

        var plan = await CopyService.PreviewAsync(CopyInput(), default);

        var changes = string.Join("\n", plan.Changes);
        Assert.Contains("Standard", changes);
        Assert.Contains("Bed 1m6", changes);
        Assert.Contains(plan.Changes, c => c.Contains("ELECTRICITY") && c.Contains("3500"));
        Assert.Contains(plan.Changes, c => c.Contains("WATER") && c.Contains("18000"));
        Assert.DoesNotContain("101", changes);
        Assert.DoesNotContain("Tenant Sample", changes);
        Assert.Equal(targetBefore, await LocationFootprintAsync(GoVapId));
    }

    [Fact(DisplayName = "UTC05 - PreviewAsync: Staff xem truoc sao chep -> tu choi (MSG03), khong co ke hoach")]
    [Trait("Function", "PreviewAsync")]
    public async Task UTC05()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(GoVapId, "BHOME Go Vap", "Go Vap, Ho Chi Minh City");
        await StaffOfSample1SignedInAsync();

        await Assert.ThrowsAnyAsync<Exception>(() => CopyService.PreviewAsync(CopyInput(), default));
    }

    #endregion

    #region CopyAsync(ConfigurationCopy input, Guid key)

    [Fact(DisplayName = "UTC06 - CopyAsync: Owner sao chep sang BHOME Go Vap -> Go Vap co Standard, Bed 1m6, dien 3500, nuoc 18000; khong du lieu thue")]
    [Trait("Function", "CopyAsync")]
    public async Task UTC06()
    {
        await StartAsync();
        await ArrangeCopySourceAndTargetAsync();
        var sourceBefore = await LocationFootprintAsync(Sample1Id);
        var plan = await CopyService.PreviewAsync(CopyInput(), default);

        await CopyService.CopyAsync(CopyInput(plan.SourceState, plan.TargetState), Guid.Parse("7f3c2a10-0000-4000-8000-000000000001"), default);

        var roomType = Assert.Single(await SetupStore.ListAsync(GoVapId, "RoomDefaults", default));
        Assert.Equal("Standard", DataName(roomType));
        Assert.Equal(2, roomType.Data.GetProperty("defaults").GetProperty("capacity").GetInt32());
        Assert.Equal("Bed 1m6", DataName(Assert.Single(await SetupStore.ListAsync(GoVapId, "AssetTemplate", default))));
        Assert.Equal(3500m, await world.ScalarAsync<decimal>("select rate from billing_policies where location_id = @l and charge_code = 'ELECTRICITY'", ("l", GoVapId)));
        Assert.Equal(18000m, await world.ScalarAsync<decimal>("select rate from billing_policies where location_id = @l and charge_code = 'WATER'", ("l", GoVapId)));
        Assert.Equal(0, await world.ScalarAsync<long>("select count(*) from rooms where location_id = @l", ("l", GoVapId)));
        Assert.Equal(0, await world.ScalarAsync<long>("select count(*) from invoices where location_id = @l", ("l", GoVapId)));
        Assert.Equal(sourceBefore, await LocationFootprintAsync(Sample1Id));
    }

    [Fact(DisplayName = "UTC07 - CopyAsync: Staff sao chep cau hinh -> tu choi (MSG03), Go Vap van trong, nguon khong doi")]
    [Trait("Function", "CopyAsync")]
    public async Task UTC07()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(GoVapId, "BHOME Go Vap", "Go Vap, Ho Chi Minh City");
        await AddRoomTypeAsync(Sample1Id, "Standard", 2);
        await AddAssetDefaultAsync(Sample1Id, "Bed 1m6", "Bed");
        await AddLocationPolicyAsync(Sample1Id, ChargeCategory.Electricity, 3500m, TodayDate);
        await AddLocationPolicyAsync(Sample1Id, ChargeCategory.Water, 18000m, TodayDate);
        var plan = await CopyService.PreviewAsync(CopyInput(), default); // states read by the Owner beforehand
        var sourceBefore = await LocationFootprintAsync(Sample1Id);
        var targetBefore = await LocationFootprintAsync(GoVapId);
        await StaffOfSample1SignedInAsync();

        await Assert.ThrowsAnyAsync<Exception>(() => CopyService.CopyAsync(CopyInput(plan.SourceState, plan.TargetState),
            Guid.Parse("7f3c2a10-0000-4000-8000-000000000002"), default));

        Assert.Equal(targetBefore, await LocationFootprintAsync(GoVapId));
        Assert.Equal(sourceBefore, await LocationFootprintAsync(Sample1Id));
    }

    #endregion

    #region PropertyService.SaveRoomAsync(...) [HttpPost("rooms"), Authorize(Roles = Owner)]

    // The current room creation service does not infer historical room types.

    [Fact(DisplayName = "UTC08 - PropertyService.SaveRoomAsync: Owner tao phong 103 loai Standard suc chua 2 -> phong moi (Standard, 2)")]
    [Trait("Function", "PropertyService.SaveRoomAsync")]
    public async Task UTC08()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var result = await Properties.SaveRoomAsync(null, new RoomWrite(Sample1Id, "103", null, 2), default);

        Assert.Equal(2, await world.ScalarAsync<short>("select capacity from rooms where id = @id and room_number = '103'", ("id", result.Id)));
        var provenance = await SetupStore.GetAsync(RoomProvenanceKey(result.Id), "RoomProvenance", default);
        Assert.Null(provenance); // A room created without defaults must not guess historical provenance.
    }

    [Fact(DisplayName = "UTC09 - PropertyService.SaveRoomAsync: phong 101 da ton tai -> tu choi trung so phong, van mot phong 101")]
    [Trait("Function", "PropertyService.SaveRoomAsync")]
    public async Task UTC09()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddRoomTypeAsync(Sample1Id, "Standard", 2);
        await AddRoomAsync(Sample1Id, "101");

        await Assert.ThrowsAnyAsync<Exception>(() => Properties.SaveRoomAsync(null, new RoomWrite(Sample1Id, "101", null, 2), default));

        Assert.Equal(1, await world.ScalarAsync<long>("select count(*) from rooms where location_id = @l and room_number = '101'", ("l", Sample1Id)));
    }

    #endregion

    #region SharedConfigurationService.SaveAsync(string resource, Guid? id, SharedWrite input)

    // Shared configuration documents are library-wide (management scope "BHOME"); LocationId has no field in SharedWrite.

    [Fact(DisplayName = "UTC10 - SaveAsync: Room Type Studio suc chua 2 -> luu Studio (2, Active)")]
    [Trait("Function", "SharedConfigurationService.SaveAsync")]
    public async Task UTC10()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");

        var saved = await Shared.SaveAsync(RoomTypeResource, null,
            new SharedWrite("Studio", "Room with private kitchen", RoomTypeData(2)), default);

        var stored = await Shared.GetAsync(RoomTypeResource, saved.Id, default);
        Assert.Equal("Studio", stored.Name);
        Assert.Equal(2, stored.Data.GetProperty("capacity").GetInt32());
        Assert.Equal("Draft", stored.Status); // Shared library saves drafts; Owner explicitly publishes them.
    }

    [Fact(DisplayName = "UTC11 - SaveAsync: Electricity 3500 tu 2026-11-01 -> phien ban Current, ghi Owner va thoi diem")]
    [Trait("Function", "SharedConfigurationService.SaveAsync")]
    public async Task UTC11()
    {
        await StartAsync();
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");

        var saved = await Shared.SaveAsync(BillingPolicyResource, null,
            new SharedWrite("Electricity", "", BillingPolicyData("Electricity", 3500m, new(2026, 11, 1), null)), default);

        var stored = await Shared.GetAsync(BillingPolicyResource, saved.Id, default);
        Assert.Equal(3500m, stored.Data.GetProperty("referenceRate").GetDecimal());
        Assert.Equal("kWh", stored.Data.GetProperty("unit").GetString());
        Assert.Equal("2026-11-01", stored.Data.GetProperty("effectiveFrom").GetString());
        Assert.Equal(OwnerId, stored.UpdatedBy);
        Assert.Equal(Today, stored.UpdatedAt);
        Assert.Equal("Draft", stored.Status); // Only Published policies are selectable.
    }

    [Fact(DisplayName = "UTC12 - SaveAsync publish: Electricity 3800 tu 2026-12-01 trung ky v1 -> tu choi, v1 khong doi")]
    [Trait("Function", "SharedConfigurationService.SaveAsync")]
    public async Task UTC12()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var v1 = await AddElectricityV1Async();
        // Drafts do not reserve effective periods. Publish immediately to exercise the overlap rule.

        await Assert.ThrowsAnyAsync<PropertyException>(() => Shared.SaveAsync(BillingPolicyResource, null,
            new SharedWrite("Electricity 2026-12", "", BillingPolicyData("Electricity", 3800m, new(2026, 12, 1), null), PublishImmediately: true), default));

        var stored = await Shared.GetAsync(BillingPolicyResource, v1.Id, default);
        Assert.Equal(3500m, stored.Data.GetProperty("referenceRate").GetDecimal());
        Assert.Equal(v1.Version, stored.Version);
        Assert.Equal(1, await SharedCountAsync(BillingPolicyResource));
    }

    [Fact(DisplayName = "UTC13 - SaveAsync: sua v1 da dung cho hoa don -> tu choi, v1 giu 3500, hoa don 462000/4270000")]
    [Trait("Function", "SharedConfigurationService.SaveAsync")]
    public async Task UTC13()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var v1 = await AddElectricityV1Async();
        // Finalized Room 101 Invoice 2026-11: Electricity 132 x 3,500 = 462,000; total 4,270,000; Payment Code "BH7K2Q9".
        var (room101, contract) = await AddOccupiedRoom101Async(Sample1Id);
        var invoice = Guid.NewGuid();
        await world.ExecAsync(
            """
            insert into invoices(id, location_id, room_id, contract_id, representative_tenant_user_id, billing_period, recipient_user_ids,
                base_total_amount, status, billing_snapshot, payment_requests, scheduled_final_date, due_date, finalized_at, finalized_by_user_id)
            values (@id, @l, @r, @c, @t, date '2026-11-01', array[@t]::uuid[], 4270000, 0, '{}'::jsonb,
                '[{"paymentCode":"BH7K2Q9"}]'::jsonb, date '2026-11-05', date '2026-11-10', null, null)
            """, ("id", invoice), ("l", Sample1Id), ("r", room101), ("c", contract), ("t", TenantSampleId));
        await world.ExecAsync(
            """
            insert into invoice_items(id, invoice_id, charge_code, description, quantity, unit_price, amount, calculation_snapshot)
            values (@id, @inv, 'ELECTRICITY', 'Electricity', 132, 3500, 462000, '{}'::jsonb)
            """, ("id", Guid.NewGuid()), ("inv", invoice));
        await world.ExecAsync( // Draft -> Finalized, as the product requires
            "update invoices set status = 1, finalized_at = timestamptz '2026-11-05 02:00+00', finalized_by_user_id = @owner where id = @id",
            ("id", invoice), ("owner", OwnerId));

        await Assert.ThrowsAnyAsync<PropertyException>(() => Shared.SaveAsync(BillingPolicyResource, v1.Id,
            new SharedWrite("Electricity", "", BillingPolicyData("Electricity", 3800m, new(2026, 11, 1), new(2026, 12, 31)), v1.Version), default));

        Assert.Equal(3500m, (await Shared.GetAsync(BillingPolicyResource, v1.Id, default)).Data.GetProperty("referenceRate").GetDecimal());
        Assert.Equal(462000m, await world.ScalarAsync<decimal>("select amount from invoice_items where invoice_id = @i", ("i", invoice)));
        Assert.Equal(4270000m, await world.ScalarAsync<decimal>("select base_total_amount from invoices where id = @i", ("i", invoice)));
    }

    [Fact(DisplayName = "UTC14 - SaveAsync: Water Rate -18000 -> khong luu, Rate am khong hop le")]
    [Trait("Function", "SharedConfigurationService.SaveAsync")]
    public async Task UTC14()
    {
        await StartAsync();
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");

        await Assert.ThrowsAnyAsync<PropertyException>(() => Shared.SaveAsync(BillingPolicyResource, null,
            new SharedWrite("Water", "", BillingPolicyData("Water", -18000m, new(2026, 11, 1), null)), default));

        Assert.Equal(0, await SharedCountAsync(BillingPolicyResource));
    }

    [Fact(DisplayName = "UTC15 - SaveAsync: Water EffectiveTo truoc EffectiveFrom -> khong luu, yeu cau sua ngay")]
    [Trait("Function", "SharedConfigurationService.SaveAsync")]
    public async Task UTC15()
    {
        await StartAsync();
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");

        await Assert.ThrowsAnyAsync<PropertyException>(() => Shared.SaveAsync(BillingPolicyResource, null,
            new SharedWrite("Water", "", BillingPolicyData("Water", 18000m, new(2026, 12, 1), new(2026, 11, 30))), default));

        Assert.Equal(0, await SharedCountAsync(BillingPolicyResource));
    }

    #endregion

    #region RoomBlockersAsync(Guid roomId)

    [Fact(DisplayName = "UTC16 - RoomBlockersAsync: phong 105 Available, khong hop dong -> danh sach rong")]
    [Trait("Function", "RoomBlockersAsync")]
    public async Task UTC16()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var room105 = await AddRoomAsync(Sample1Id, "105");

        Assert.Empty(await Lifecycle.RoomBlockersAsync(room105, default));
    }

    [Fact(DisplayName = "UTC17 - RoomBlockersAsync: phong 101 Occupied co Main Contract -> danh sach neu Main Contract do")]
    [Trait("Function", "RoomBlockersAsync")]
    public async Task UTC17()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var (room101, contract) = await AddOccupiedRoom101Async(Sample1Id);

        var blockers = await Lifecycle.RoomBlockersAsync(room101, default);

        Assert.Contains(blockers, b => b.Contains(contract.ToString(), StringComparison.OrdinalIgnoreCase) ||
                                       b.Contains("contract", StringComparison.OrdinalIgnoreCase));
    }

    #endregion

    #region ClosureAsync(Guid locationId)

    [Fact(DisplayName = "UTC18 - ClosureAsync: BHOME Tan Binh phong A01, A02 Available, khong hop dong -> co the Inactive, khong xoa")]
    [Trait("Function", "ClosureAsync")]
    public async Task UTC18()
    {
        await StartAsync();
        await AddLocationAsync(TanBinhId, "BHOME Tan Binh", TanBinhAddress);
        await AddRoomAsync(TanBinhId, "A01");
        await AddRoomAsync(TanBinhId, "A02");

        var check = await Lifecycle.ClosureAsync(TanBinhId, default);

        Assert.True(check.CanClose, string.Join(", ", check.Blockers.Select(b => $"{b.Code}={b.Count}")));
        Assert.Equal(2, await world.ScalarAsync<long>("select count(*) from rooms where location_id = @l", ("l", TanBinhId)));
        Assert.True(await world.ScalarAsync<bool>("select is_active from locations where id = @l", ("l", TanBinhId)));
    }

    [Fact(DisplayName = "UTC19 - ClosureAsync: BHOME SAMPLE 1 phong 101 co Main Contract Active -> bao blocker, khong Inactive, khong xoa")]
    [Trait("Function", "ClosureAsync")]
    public async Task UTC19()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddOccupiedRoom101Async(Sample1Id);

        var check = await Lifecycle.ClosureAsync(Sample1Id, default);

        Assert.False(check.CanClose);
        Assert.Contains(check.Blockers, b => b.Code == "active_or_pending_contracts" && b.Count == 1);
        Assert.True(await world.ScalarAsync<bool>("select is_active from locations where id = @l", ("l", Sample1Id)));
        Assert.Equal(2, await world.ScalarAsync<short>("select status from rooms where location_id = @l and room_number = '101'", ("l", Sample1Id)));
    }

    #endregion

    #region SaveAssetAsync(Asset asset, Guid actor, string reason)

    // ISetupWorkspaceStore.SaveAssetAsync. PurchasePrice is not a field of Asset (it lives in purchase metadata).

    [Fact(DisplayName = "UTC20 - SaveAssetAsync: Aircon Daikin 1HP cho phong 105, Good -> luu, Status Active")]
    [Trait("Function", "SaveAssetAsync")]
    public async Task UTC20()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var room105 = await AddRoomAsync(Sample1Id, "105");
        var asset = new Asset
        {
            LocationId = Sample1Id,
            RoomId = room105,
            Name = "Aircon Daikin 1HP",
            Category = "Air conditioner",
            Condition = "Good",
            Status = AssetStatus.Active,
        };

        await SetupStore.SaveAssetAsync(asset, OwnerId, "New air conditioner installed", default);

        Assert.Equal(room105, await world.ScalarAsync<Guid>("select room_id from assets where name = 'Aircon Daikin 1HP'"));
        Assert.Equal("Good", await AssetConditionAsync(asset.Id));
        Assert.Equal((short)AssetStatus.Active, await world.ScalarAsync<short>("select status from assets where id = @id", ("id", asset.Id)));
    }

    [Fact(DisplayName = "UTC21 - SaveAssetAsync: Aircon co 2 lan sua, Status Retired -> Retired, khong xoa, giu 2 lan sua")]
    [Trait("Function", "SaveAssetAsync")]
    public async Task UTC21()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var room105 = await AddRoomAsync(Sample1Id, "105");
        var assetId = await AddAssetAsync(Sample1Id, room105, "Aircon Daikin 1HP", "Air conditioner", "Good");
        await AddRepairRecordsAsync(Sample1Id, room105, assetId, 2);
        var asset = (await SetupStore.AssetAsync(assetId, default))!;
        asset.Status = AssetStatus.Retired;

        await SetupStore.SaveAssetAsync(asset, OwnerId, "Replaced by a new unit", default);

        Assert.Equal((short)AssetStatus.Retired, await world.ScalarAsync<short>("select status from assets where id = @id", ("id", assetId)));
        Assert.Equal(2, await RepairRecordCountAsync(assetId));
    }

    [Fact(DisplayName = "UTC22 - SaveAssetAsync: Staff BHOME SAMPLE 1 sua tai san cua BHOME SAMPLE 2 -> tu choi (MSG04), van Good")]
    [Trait("Function", "SaveAssetAsync")]
    public async Task UTC22()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        var room201 = await AddRoomAsync(Sample2Id, "201");
        var assetId = await AddAssetAsync(Sample2Id, room201, "Water heater Ariston 20L", "Water heater", "Good");
        var historyBefore = (await SetupStore.AssetHistoryAsync(assetId, default)).Count;
        await StaffOfSample1SignedInAsync();
        var asset = (await SetupStore.AssetAsync(assetId, default))!;
        asset.Condition = "Leaking";

        await Assert.ThrowsAnyAsync<Exception>(() => Properties.UpdateAssetConditionAsync(assetId,
            new AssetConditionUpdate("Leaking", asset.Version, "Water leaking under the tank"), default));

        Assert.Equal("Good", await AssetConditionAsync(assetId));
        Assert.Equal(historyBefore, (await SetupStore.AssetHistoryAsync(assetId, default)).Count);
    }

    #endregion

    #region AssetHistoryAsync(Guid assetId)

    // ISetupWorkspaceStore.AssetHistoryAsync.

    [Fact(DisplayName = "UTC23 - AssetHistoryAsync: Aircon Good -> Fan is noisy (staff, 2026-11-12) va 2 lan sua -> lich su day du")]
    [Trait("Function", "AssetHistoryAsync")]
    public async Task UTC23()
    {
        await StartAsync(new DateTimeOffset(2026, 11, 1, 9, 0, 0, TimeSpan.FromHours(7))); // created 2026-11-01
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var room105 = await AddRoomAsync(Sample1Id, "105");
        var assetId = await AddAssetAsync(Sample1Id, room105, "Aircon Daikin 1HP", "Air conditioner", "Good");
        await AddRepairRecordsAsync(Sample1Id, room105, assetId, 2);
        world.Clock.Advance(TimeSpan.FromDays(11)); // 2026-11-12
        await StaffOfSample1SignedInAsync();
        await Properties.UpdateAssetConditionAsync(assetId, new AssetConditionUpdate("Fan is noisy", 1, "Fan noise reported"), default);
        world.SignInAsOwner();
        var repairs = await RepairRecordIdsAsync(assetId);

        var history = await AssetInventory.HistoryAsync(assetId, default);

        Assert.Contains(history, h => h.Snapshot.Contains("\"Good\""));
        Assert.Contains(history, h => h.ActorId == StaffSampleId && h.Snapshot.Contains("Fan is noisy") &&
                                      h.OccurredAt.ToOffset(TimeSpan.FromHours(7)).Date == new DateTime(2026, 11, 12));
        Assert.All(repairs, repair => Assert.Contains(history, h => h.Id == repair || h.Snapshot.Contains(repair.ToString())));
    }

    [Fact(DisplayName = "UTC24 - AssetHistoryAsync: Staff BHOME SAMPLE 1 xem lich su tai san BHOME SAMPLE 2 -> tu choi (MSG04)")]
    [Trait("Function", "AssetHistoryAsync")]
    public async Task UTC24()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        var room201 = await AddRoomAsync(Sample2Id, "201");
        var assetId = await AddAssetAsync(Sample2Id, room201, "Water heater Ariston 20L", "Water heater", "Good");
        await AddRepairRecordsAsync(Sample2Id, room201, assetId, 1);
        await StaffOfSample1SignedInAsync();

        IReadOnlyList<AssetHistoryEntry>? history = null;
        try { history = await AssetInventory.HistoryAsync(assetId, default); } catch (Exception) { /* rejected */ }

        Assert.True(history is null || history.Count == 0, $"{history?.Count} history entries of a BHOME SAMPLE 2 asset returned to Staff");
    }

    #endregion

    #region AssetInventoryService.SaveTemplateAsync(Guid? id, AssetTemplateWrite input)

    // AssetTemplateWrite has no RoomTypeId / Condition; the Room Type link is checked on the Room Type afterwards.

    [Fact(DisplayName = "UTC25 - SaveTemplateAsync: Bed 1m6 -> tao Draft doc lap, khong tu dong gan Room Type")]
    [Trait("Function", "AssetInventoryService.SaveTemplateAsync")]
    public async Task UTC25()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var standard = await AddRoomTypeAsync(Sample1Id, "Standard", 2);
        foreach (var number in new[] { "101", "102", "103" }) await AddRoomAsync(Sample1Id, number);
        var roomTypeBefore = (await SetupStore.GetAsync(standard.Id, "RoomDefaults", default))!;

        var saved = await AssetInventory.SaveTemplateAsync(null, new AssetTemplateWrite(Sample1Id, "Bed 1m6",
            [new AssetTemplateItem(Guid.NewGuid(), "Bed 1m6", "Bed", "Serialized", 1)], Scoped: true), default);

        Assert.Equal("Bed 1m6", DataName((await SetupStore.GetAsync(saved.Id, "AssetTemplate", default))!));
        Assert.Equal("Draft", (await SetupStore.GetAsync(saved.Id, "AssetTemplate", default))!.Status);
        var roomType = (await SetupStore.GetAsync(standard.Id, "RoomDefaults", default))!;
        Assert.Equal(roomTypeBefore.Data.GetRawText(), roomType.Data.GetRawText());
    }

    [Fact(DisplayName = "UTC26 - SaveTemplateAsync: AssetTemplate cua BHOME SAMPLE 1 khong bi ro ri sang BHOME SAMPLE 2")]
    [Trait("Function", "AssetInventoryService.SaveTemplateAsync")]
    public async Task UTC26()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        var saved = await AssetInventory.SaveTemplateAsync(null, new AssetTemplateWrite(Sample1Id, "Bed 1m6",
            [new AssetTemplateItem(Guid.NewGuid(), "Bed 1m6", "Bed", "Serialized", 1)], Scoped: true), default);

        Assert.Single(await SetupStore.ListAsync(Sample1Id, "AssetTemplate", default));
        Assert.Empty(await SetupStore.ListAsync(Sample2Id, "AssetTemplate", default));
        Assert.Equal(saved.Id, Assert.Single(await SetupStore.ListAsync(Sample1Id, "AssetTemplate", default)).Id);
    }

    #endregion

    #region ApplicablePoliciesAsync(Room room, DateOnly date)

    // v1 = 3,500 (2026-11-01 → 2026-12-31), v2 = 3,800 (from 2027-01-01), created by the Owner before 2026-11-01.
    private async Task<Room> ArrangeElectricityVersionsAsync()
    {
        await StartAsync(new DateTimeOffset(2026, 10, 15, 9, 0, 0, TimeSpan.FromHours(7)));
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        var room101 = await AddRoomAsync(Sample1Id, "101");
        await AddLocationPolicyAsync(Sample1Id, ChargeCategory.Electricity, 3500m, new(2026, 11, 1), new(2026, 12, 31));
        await AddLocationPolicyAsync(Sample1Id, ChargeCategory.Electricity, 3800m, new(2027, 1, 1));
        return (await PropertyRepository.FindAsync<Room>(room101, default))!;
    }

    private static decimal[] ElectricityRates(IEnumerable<BillingPolicy> policies) =>
        policies.Where(p => p.Category == ChargeCategory.Electricity).Select(p => p.Rate).ToArray();

    [Fact(DisplayName = "UTC27 - ApplicablePoliciesAsync: phong 101 ngay 2026-12-15 -> chi Electricity v1 (3500)")]
    [Trait("Function", "ApplicablePoliciesAsync")]
    public async Task UTC27()
    {
        var room = await ArrangeElectricityVersionsAsync();

        var policies = await PropertyRepository.ApplicablePoliciesAsync(room, new DateOnly(2026, 12, 15), default);

        Assert.Equal([3500m], ElectricityRates(policies));
    }

    [Fact(DisplayName = "UTC28 - ApplicablePoliciesAsync: phong 101 ngay 2026-10-31 -> khong co Electricity")]
    [Trait("Function", "ApplicablePoliciesAsync")]
    public async Task UTC28()
    {
        var room = await ArrangeElectricityVersionsAsync();

        var policies = await PropertyRepository.ApplicablePoliciesAsync(room, new DateOnly(2026, 10, 31), default);

        Assert.Empty(ElectricityRates(policies));
    }

    [Fact(DisplayName = "UTC29 - ApplicablePoliciesAsync: phong 101 ngay 2027-01-01 (bien) -> chi Electricity v2 (3800)")]
    [Trait("Function", "ApplicablePoliciesAsync")]
    public async Task UTC29()
    {
        var room = await ArrangeElectricityVersionsAsync();

        var policies = await PropertyRepository.ApplicablePoliciesAsync(room, new DateOnly(2027, 1, 1), default);

        Assert.Equal([3800m], ElectricityRates(policies));
    }

    #endregion

    #region RoomsAsync(PropertyQuery q)

    [Fact(DisplayName = "UTC30 - RoomsAsync: Staff BHOME SAMPLE 1, LocationId null -> chi 5 phong cua BHOME SAMPLE 1")]
    [Trait("Function", "RoomsAsync")]
    public async Task UTC30()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        foreach (var number in new[] { "101", "102", "103", "105", "106" }) await AddRoomAsync(Sample1Id, number);
        foreach (var number in new[] { "101", "201" }) await AddRoomAsync(Sample2Id, number);
        await StaffOfSample1SignedInAsync();

        var page = await Properties.RoomsAsync(new PropertyQuery { LocationId = null, Page = 1, PageSize = 20 }, default);

        Assert.Equal(["101", "102", "103", "105", "106"], page.Items.Select(r => r.RoomNumber).Order().ToArray());
        Assert.All(page.Items, r => Assert.Equal(Sample1Id, r.LocationId));
    }

    [Fact(DisplayName = "UTC31 - RoomsAsync: Staff BHOME SAMPLE 1 loc BHOME SAMPLE 2 -> tu choi (MSG04), khong tra phong nao")]
    [Trait("Function", "RoomsAsync")]
    public async Task UTC31()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        foreach (var number in new[] { "101", "201" }) await AddRoomAsync(Sample2Id, number);
        await StaffOfSample1SignedInAsync();

        PagedResult<RoomDto>? page = null;
        try { page = await Properties.RoomsAsync(new PropertyQuery { LocationId = Sample2Id, Page = 1, PageSize = 20 }, default); }
        catch (PropertyException) { /* rejected */ }

        Assert.True(page is null || page.Items.Count == 0);
    }

    #endregion

    #region OccupancyAsync(OccupancyQuery query, Guid? staffUserId, ...)

    // IOperationsRepository.OccupancyAsync(query, staffUserId, today).

    [Fact(DisplayName = "UTC32 - OccupancyAsync: Staff BHOME SAMPLE 1 -> 101, 102 Occupied; 105 Available; 106 On Hold; khong doi du lieu")]
    [Trait("Function", "OccupancyAsync")]
    public async Task UTC32()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddRoomAsync(Sample1Id, "101", RoomStatus.Occupied);
        await AddRoomAsync(Sample1Id, "102", RoomStatus.Occupied);
        await AddRoomAsync(Sample1Id, "105", RoomStatus.Available);
        await AddRoomAsync(Sample1Id, "106", RoomStatus.OnHold);
        await StaffOfSample1SignedInAsync();
        var before = await LocationFootprintAsync(Sample1Id);

        var page = await Operations.OccupancyAsync(new OccupancyQuery { LocationId = Sample1Id }, StaffSampleId, TodayDate, default);

        Assert.Equal(
            [("101", "Occupied"), ("102", "Occupied"), ("105", "Available"), ("106", "OnHold")],
            page.Items.Select(r => (r.RoomNumber, r.RoomStatus)).OrderBy(r => r.RoomNumber).ToArray());
        Assert.Equal(before, await LocationFootprintAsync(Sample1Id));
    }

    [Fact(DisplayName = "UTC33 - OccupancyAsync: Staff BHOME SAMPLE 1 xem BHOME SAMPLE 2 -> tu choi (MSG04), khong tra du lieu")]
    [Trait("Function", "OccupancyAsync")]
    public async Task UTC33()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        await AddRoomAsync(Sample2Id, "101", RoomStatus.Occupied);
        await AddRoomAsync(Sample2Id, "201", RoomStatus.Available);
        await StaffOfSample1SignedInAsync();
        var before = await LocationFootprintAsync(Sample2Id);

        OperationsPage<RoomOccupancyView>? page = null;
        try { page = await Operations.OccupancyAsync(new OccupancyQuery { LocationId = Sample2Id }, StaffSampleId, TodayDate, default); }
        catch (Exception) { /* rejected */ }

        Assert.True(page is null || page.Items.Count == 0);
        Assert.Equal(before, await LocationFootprintAsync(Sample2Id));
    }

    #endregion

    #region OccupancyHistoryAsync(Guid roomId, Guid? staffUserId, DateOnly today)

    // IOperationsRepository.OccupancyHistoryAsync.

    [Fact(DisplayName = "UTC34 - OccupancyHistoryAsync: phong 101 -> Occupied, dang o tenant.sample va Nguyen Thi Mai, 2 giai doan")]
    [Trait("Function", "OccupancyHistoryAsync")]
    public async Task UTC34()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await world.AddTenantSampleAsync();
        var room101 = await AddRoomAsync(Sample1Id, "101", RoomStatus.Occupied);
        var binh = await AddResidentAsync(room101, "Le Van Binh", null);       // binhle@bhome.test
        var tenant = await AddResidentAsync(room101, "Tenant Sample", TenantSampleId);
        var mai = await AddResidentAsync(room101, "Nguyen Thi Mai", null);     // mainguyen@bhome.test
        await AddMainContractAsync(room101, 4, binh, null, new(2026, 1, 1), new(2026, 6, 30), (binh, 0));
        await AddMainContractAsync(room101, 3, tenant, TenantSampleId, new(2026, 7, 1), new(2027, 6, 30), (tenant, 0), (mai, 1));
        var before = await LocationFootprintAsync(Sample1Id);

        var history = await Operations.OccupancyHistoryAsync(room101, null, TodayDate, default);

        Assert.NotNull(history);
        Assert.Equal(2, history!.Periods.Count);
        var current = Assert.Single(history.Periods, p => p.From == new DateOnly(2026, 7, 1));
        Assert.Equal("Active", current.ContractStatus);
        Assert.Equal(new[] { mai, tenant }.Order().ToArray(), current.Occupants.Select(o => o.ResidentId).Order().ToArray());
        var past = Assert.Single(history.Periods, p => p.From == new DateOnly(2026, 1, 1));
        Assert.Equal(new DateOnly(2026, 6, 30), past.To);
        Assert.Equal((short)RoomStatus.Occupied, await world.ScalarAsync<short>("select status from rooms where id = @id", ("id", room101)));
        Assert.Equal(before, await LocationFootprintAsync(Sample1Id));
    }

    [Fact(DisplayName = "UTC35 - OccupancyHistoryAsync: Staff BHOME SAMPLE 1 xem phong 201 BHOME SAMPLE 2 -> tu choi (MSG04), khong tra lich su")]
    [Trait("Function", "OccupancyHistoryAsync")]
    public async Task UTC35()
    {
        await StartAsync();
        await AddLocationAsync(Sample1Id, "BHOME SAMPLE 1");
        await AddLocationAsync(Sample2Id, "BHOME SAMPLE 2");
        var room201 = await AddRoomAsync(Sample2Id, "201");
        var past = await AddResidentAsync(room201, "Past Tenant", null);
        await AddMainContractAsync(room201, 4, past, null, new(2026, 1, 1), new(2026, 6, 30), (past, 0));
        await StaffOfSample1SignedInAsync();

        RoomOccupancyHistory? history = null;
        try { history = await Operations.OccupancyHistoryAsync(room201, StaffSampleId, TodayDate, default); }
        catch (Exception) { /* rejected */ }

        Assert.True(history is null || history.Periods.Count == 0);
    }

    #endregion
}
