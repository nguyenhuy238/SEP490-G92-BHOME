using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;
using static BHome.Infrastructure.UnitTests.Shared.IdentityArrange;

namespace BHome.Infrastructure.UnitTests.ResourceAccess;

// Report 5.1 – sheet "ResourceAccess" (UTC01–UTC14).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// Run only this sheet:  dotnet test --filter "Sheet=ResourceAccess"   ·   one function:  --filter "Sheet=ResourceAccess&Function=IsAssignedAsync"
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "ResourceAccess")]
public sealed class ResourceAccessUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private static readonly Guid Sample1Id = Guid.Parse("c2400000-0000-4000-8000-000000000010"); // "BHOME SAMPLE 1"
    private static readonly Guid Sample2Id = Guid.Parse("c2400000-0000-4000-8000-000000000011"); // "BHOME SAMPLE 2"
    private static readonly Guid MeterTenantId = Guid.Parse("bd110000-0000-4000-8000-000000000041"); // bhome.e2e.meter.tenant@example.com
    private static readonly Guid MaiNguyenId = Guid.Parse("bd110000-0000-4000-8000-000000000042");   // mainguyen@bhome.test
    private static readonly Guid Room101Id = Guid.Parse("c2400000-0000-4000-8000-000000000040");
    private static readonly Guid TenantResidentId = Guid.Parse("bd110000-0000-4000-8000-000000000030");
    private static readonly Guid MaiResidentId = Guid.Parse("bd110000-0000-4000-8000-000000000043");
    private static readonly DateTimeOffset Today = new(2026, 11, 12, 9, 0, 0, TimeSpan.FromHours(7)); // "Today is 2026-11-12"

    // Permission names written on the sheet -> BHOME permission codes.
    // There is no separate "view contract" code; a Tenant reaches its own Contract through contracts.sign.
    private static readonly Dictionary<string, string> Permission = new()
    {
        ["Update Room"] = Permissions.Rooms.Manage,
        ["View Room"] = Permissions.Rooms.View,
        ["Activate Main Tenancy Contract"] = Permissions.Contracts.Activate,
        ["View Contract"] = Permissions.Contracts.Sign,
        ["View Invoice"] = Permissions.Invoices.ViewOwn,
    };

    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync()
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres, Today);
        await world.AddOwnerSampleAsync();
        await world.ExecAsync("insert into locations(id, name, address) values (@a, 'BHOME SAMPLE 1', 'Synthetic address'), (@b, 'BHOME SAMPLE 2', 'Synthetic address')",
            ("a", Sample1Id), ("b", Sample2Id));
    }

    public async Task DisposeAsync() => await world.DisposeAsync();

    private PermissionAccess Access => world.Get<PermissionAccess>();
    private IStaffLocationAccess StaffLocations => world.Get<IStaffLocationAccess>();
    private ILocationAssignments Assignments => world.Get<ILocationAssignments>();

    // Assignment created through the real Owner function. The system always stores an end date,
    // so "no end date" is written as 9999-12-31.
    private async Task AssignStaffAsync(Guid locationId, DateOnly start, DateOnly? end = null)
    {
        var result = await Assignments.CreateAssignmentAsync(OwnerId, locationId, StaffSampleId, start, end ?? DateOnly.MaxValue, default);
        Assert.Equal(CreateAssignmentStatus.Created, result.Status);
    }

    // "Staff staff.sample@example.invalid (responsible for "BHOME SAMPLE 1" only) is signed in."
    private async Task StaffOfSample1SignedInAsync()
    {
        await world.AddStaffSampleAsync();
        await AssignStaffAsync(Sample1Id, new DateOnly(2026, 11, 1));
        world.CurrentUser.Set(StaffSampleId, Roles.Staff);
    }

    #region CanAccessAsync(string? permission, ResourceScope scope)

    [Fact(DisplayName = "UTC01 - CanAccessAsync: Owner, Update Room, Location BHOME SAMPLE 1 -> true")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC01()
    {
        world.SignInAsOwner();

        Assert.True(await Access.CanAccessAsync(Permission["Update Room"], new ResourceScope(Sample1Id, null), default));
    }

    [Fact(DisplayName = "UTC02 - CanAccessAsync: Staff phu trach BHOME SAMPLE 1, View Room tai BHOME SAMPLE 1 -> true")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC02()
    {
        await StaffOfSample1SignedInAsync();

        Assert.True(await Access.CanAccessAsync(Permission["View Room"], new ResourceScope(Sample1Id, null), default));
    }

    [Fact(DisplayName = "UTC03 - CanAccessAsync: Staff phu trach BHOME SAMPLE 1, View Room tai BHOME SAMPLE 2 -> false")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC03()
    {
        await StaffOfSample1SignedInAsync();

        Assert.False(await Access.CanAccessAsync(Permission["View Room"], new ResourceScope(Sample2Id, null), default));
    }

    [Fact(DisplayName = "UTC04 - CanAccessAsync: Owner vua go phan cong BHOME SAMPLE 1 cua Staff -> false")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC04()
    {
        await StaffOfSample1SignedInAsync();
        var version = await world.ScalarAsync<int>("select version from locations where id = @id", ("id", Sample1Id));
        await Assignments.RemoveAssignmentAsync(OwnerId, Sample1Id, DateOnly.FromDateTime(Today.DateTime), version, "Owner removed the assignment", default);

        Assert.False(await Access.CanAccessAsync(Permission["View Room"], new ResourceScope(Sample1Id, null), default));
    }

    [Fact(DisplayName = "UTC05 - CanAccessAsync: Staff, Activate Main Tenancy Contract -> false")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC05()
    {
        await StaffOfSample1SignedInAsync();

        Assert.False(await Access.CanAccessAsync(Permission["Activate Main Tenancy Contract"], new ResourceScope(Sample1Id, null), default));
    }

    [Fact(DisplayName = "UTC06 - CanAccessAsync: Tenant xem hop dong cua chinh minh -> true")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC06()
    {
        await world.AddTenantSampleAsync();
        world.CurrentUser.Set(TenantSampleId, Roles.Tenant);

        Assert.True(await Access.CanAccessAsync(Permission["View Contract"], new ResourceScope(Sample1Id, TenantSampleId), default));
    }

    [Fact(DisplayName = "UTC07 - CanAccessAsync: Tenant xem hop dong cua bhome.e2e.meter.tenant -> false")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC07()
    {
        await world.AddTenantSampleAsync();
        await world.AddUserAsync(MeterTenantId, "bhome.e2e.meter.tenant@example.com", Roles.Tenant, TenantPassword);
        world.CurrentUser.Set(TenantSampleId, Roles.Tenant);

        Assert.False(await Access.CanAccessAsync(Permission["View Contract"], new ResourceScope(Sample1Id, MeterTenantId), default));
    }

    [Fact(DisplayName = "UTC08 - CanAccessAsync: chua dang nhap, View Contract -> false")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC08()
    {
        await world.AddTenantSampleAsync();
        world.CurrentUser.Set(null);

        Assert.False(await Access.CanAccessAsync(Permission["View Contract"], new ResourceScope(Sample1Id, TenantSampleId), default));
    }

    [Fact(DisplayName = "UTC09 - CanAccessAsync: Staff tu doi role trong request thanh Owner -> false (server dung role Staff)")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC09()
    {
        await StaffOfSample1SignedInAsync(); // the server-side signed-in user keeps the stored role Staff; the claimed "Owner" never reaches it

        Assert.False(await Access.CanAccessAsync(Permission["Activate Main Tenancy Contract"], new ResourceScope(Sample1Id, null), default));
    }

    [Fact(DisplayName = "UTC10 - CanAccessAsync: nguoi o cung mainguyen xem hoa don chung cua phong -> true")]
    [Trait("Function", "CanAccessAsync")]
    public async Task UTC10()
    {
        await world.AddTenantSampleAsync();
        await world.AddUserAsync(MaiNguyenId, "mainguyen@bhome.test", Roles.Tenant, TenantPassword);
        await world.ExecAsync("insert into rooms(id,location_id,room_number,capacity,status) values (@room,@location,'101',2,2)",
            ("room", Room101Id), ("location", Sample1Id));
        await world.ExecAsync("""
            insert into residents(id,user_id,current_room_id,identity_owner_scope_id,display_label,verification_status)
            values (@representative,@representative_user,@room,@owner,'Tenant Sample',1),
                   (@member,@member_user,@room,@owner,'Nguyen Thi Mai',1)
            """, ("representative", TenantResidentId), ("representative_user", TenantSampleId),
            ("member", MaiResidentId), ("member_user", MaiNguyenId), ("room", Room101Id), ("owner", OwnerId));
        var contractId = Guid.NewGuid();
        await world.ExecAsync("""
            insert into contracts(id,room_id,representative_resident_id,tenant_user_id,owner_signer_id,contract_type,
                start_date,end_date,monthly_rent,deposit_required,terms,status,activated_at,activated_by_user_id)
            values (@contract,@room,@representative,@tenant,@owner,'MAIN',date '2026-11-01',date '2027-10-31',
                3500000,3500000,'Synthetic terms',3,timestamptz '2026-11-01 02:00+00',@owner)
            """, ("contract", contractId), ("room", Room101Id), ("representative", TenantResidentId),
            ("tenant", TenantSampleId), ("owner", OwnerId));
        await world.ExecAsync("""
            insert into contract_residents(contract_id,resident_id,resident_role,residence_from)
            values (@contract,@representative,0,date '2026-11-01'),(@contract,@member,1,date '2026-11-01')
            """, ("contract", contractId), ("representative", TenantResidentId), ("member", MaiResidentId));
        world.CurrentUser.Set(MaiNguyenId, Roles.Tenant);

        // The shared Room Invoice belongs to the representative Tenant tenant.sample@example.invalid.
        Assert.True(await Access.CanAccessAsync(Permission["View Invoice"], new ResourceScope(Sample1Id, TenantSampleId), default));
    }

    #endregion

    #region IsAssignedAsync(Guid staffId, Guid locationId)

    [Fact(DisplayName = "UTC11 - IsAssignedAsync: phan cong BHOME SAMPLE 1 tu 2026-11-01, khong ngay ket thuc -> true")]
    [Trait("Function", "IsAssignedAsync")]
    public async Task UTC11()
    {
        await world.AddStaffSampleAsync();
        await AssignStaffAsync(Sample1Id, new DateOnly(2026, 11, 1));

        Assert.True(await StaffLocations.IsAssignedAsync(StaffSampleId, Sample1Id, default));
    }

    [Fact(DisplayName = "UTC12 - IsAssignedAsync: phan cong da ket thuc 2026-11-11 (hom nay 2026-11-12) -> false")]
    [Trait("Function", "IsAssignedAsync")]
    public async Task UTC12()
    {
        await world.AddStaffSampleAsync();
        await AssignStaffAsync(Sample1Id, new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 11));

        Assert.False(await StaffLocations.IsAssignedAsync(StaffSampleId, Sample1Id, default));
    }

    [Fact(DisplayName = "UTC13 - IsAssignedAsync: chua tung phan cong BHOME SAMPLE 2 -> false")]
    [Trait("Function", "IsAssignedAsync")]
    public async Task UTC13()
    {
        await world.AddStaffSampleAsync();
        await AssignStaffAsync(Sample1Id, new DateOnly(2026, 11, 1));

        Assert.False(await StaffLocations.IsAssignedAsync(StaffSampleId, Sample2Id, default));
    }

    [Fact(DisplayName = "UTC14 - IsAssignedAsync: phan cong bat dau ngay mai 2026-11-13 -> false")]
    [Trait("Function", "IsAssignedAsync")]
    public async Task UTC14()
    {
        await world.AddStaffSampleAsync();
        await AssignStaffAsync(Sample1Id, new DateOnly(2026, 11, 13));

        Assert.False(await StaffLocations.IsAssignedAsync(StaffSampleId, Sample1Id, default));
    }

    #endregion
}
