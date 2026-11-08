using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF01;

// Unit test cho sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx (27 test case).
// Kết quả mong đợi của MỌI test lấy nguyên văn từ sheet (căn cứ SRS v1.3: UC-04, UC-05, UC-06, UC-21, GBR-02, GBR-08...).
// Code chỉ được dùng ở mức chữ ký (tên lớp/hàm/tham số) để biết cách gọi: PropertyService + IPropertyRepository.
// Kho dữ liệu giả lập trong bộ nhớ (InMemoryPropertyRepository); người dùng và phân công Location giả lập bằng NSubstitute.
// "Log Message" của sheet: PropertyService báo lỗi bằng ngoại lệ mang mã (Code), câu thông báo cho người dùng do tầng API
// trả về, nên ở các test có Log Message khác N/A ghi rõ "Log Message không quan sát được ở tầng unit".
public sealed class BF01LocationSetupUnitTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 28, 9, 0, 0, TimeSpan.FromHours(7));
    private static readonly DateOnly Nov1 = new(2026, 11, 1);
    private static readonly DateOnly Dec1 = new(2026, 12, 1);
    private static readonly DateOnly Dec31 = new(2026, 12, 31);
    private static readonly DateOnly Jan1 = new(2027, 1, 1);

    private readonly InMemoryPropertyRepository repository = new() { ChainId = Guid.NewGuid() };

    private PropertyService Service(Actor actor)
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(Now);
        clock.LocalTimeZone.Returns(TimeZoneInfo.Utc);
        var access = new PermissionAccess(actor.User, new ResourceAccess(actor.User, actor.StaffLocations));
        return new PropertyService(repository, actor.User, access, clock);
    }

    private PropertyService Owner() => Service(Actor.Owner());

    private Location SeedLocation(string name = "BHOME Tan Binh", bool active = true)
    {
        var location = new Location(name) { Address = "12 Cong Hoa, Tan Binh", IsActive = active, ChainId = repository.ChainId, Version = 1 };
        return repository.Seed(location.With(Guid.NewGuid()));
    }

    private RoomType SeedRoomType(Location location, string name = "Standard") =>
        repository.Seed(new RoomType { LocationId = location.Id, Name = name, DefaultCapacity = 2, Amenities = [], IsActive = true, Version = 1 }.With(Guid.NewGuid()));

    private Room SeedRoom(Location location, string number, RoomStatus status = RoomStatus.Available, Guid? roomTypeId = null) =>
        repository.Seed(new Room { LocationId = location.Id, Location = location, RoomNumber = number, Capacity = 2, Status = status, RoomTypeId = roomTypeId, Version = 1 }.With(Guid.NewGuid()));

    private Asset SeedAsset(Location location, Room room) =>
        repository.Seed(new Asset { LocationId = location.Id, RoomId = room.Id, Name = "Aircon Daikin 1HP", Category = "Air conditioner", Condition = "Good", Status = AssetStatus.Active, Version = 1 }.With(Guid.NewGuid()));

    private BillingPolicy SeedPolicy(Location location, ChargeCategory category, ChargingMethod method, decimal rate, DateOnly from, DateOnly? to) =>
        repository.Seed(new BillingPolicy
        {
            LocationId = location.Id, Category = category, Method = method, ChargeCode = ChargeCodes.For(category, method),
            Name = category.ToString(), Rate = rate, EffectiveFrom = from, EffectiveTo = to, Version = 1
        }.With(Guid.NewGuid()));

    private static PolicyWrite Policy(Location location, ChargeCategory category, ChargingMethod method, decimal rate, DateOnly from, DateOnly? to) =>
        new(location.Id, null, category, ChargeCodes.For(category, method), category.ToString(), method, rate, from, to, "BF-01 unit test");

    // "Field identified for correction": mã lỗi (PropertyException.Code) hoặc nội dung lỗi phải chỉ ra đúng trường.
    private static void AssertFieldIdentified(Exception ex, string field)
    {
        var text = ex is PropertyException p ? p.Code : ex.Message;
        Assert.True(text.Contains(field, StringComparison.OrdinalIgnoreCase),
            $"Loi khong chi ra truong '{field}'. Thong tin loi nhan duoc: {ex.GetType().Name} '{text}'");
    }

    // ===================== createLocation =====================

    // UTC01 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; managed Chain exists
    // Đầu vào : name="BHOME Tan Binh"; address="12 Cong Hoa, Tan Binh"; status=Active
    // Mong đợi: Return: Location saved in the Chain with the entered name, address and status Active; configuration history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 Pre 1-2, NF 3, 7, 11-13; Entity Location (Name, address; Active/Inactive)
    [Fact(DisplayName = "BF01 UTC01 - Owner tao Location: luu dung ten, dia chi, Active, thuoc Chain, co lich su")]
    public async Task UTC01_CreateLocation()
    {
        var dto = await Owner().SaveLocationAsync(null, new LocationWrite("BHOME Tan Binh", "12 Cong Hoa, Tan Binh", true), default);

        Assert.Equal("BHOME Tan Binh", dto.Name);
        Assert.Equal("12 Cong Hoa, Tan Binh", dto.Address);
        Assert.True(dto.IsActive);
        var saved = Assert.Single(repository.All<Location>());
        Assert.Equal(repository.ChainId, saved.ChainId);
        Assert.Contains(repository.Changes, c => c.TargetId == saved.Id);
    }

    // UTC02 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in
    // Đầu vào : name=""; address="12 Cong Hoa, Tan Binh"
    // Mong đợi: Return: change rejected; Name field identified for correction; Location not saved; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-04 A1; Entity Location key attribute Name; MSG02
    // Ghi chú : Log Message (MSG02) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF01 UTC02 - Ten Location rong: bi tu choi, chi ra truong Name, khong luu")]
    public async Task UTC02_EmptyLocationName()
    {
        var ex = await Record.ExceptionAsync(() => Owner().SaveLocationAsync(null, new LocationWrite("", "12 Cong Hoa, Tan Binh"), default));

        Assert.True(ex is not null, "Ten rong nhung Location van duoc luu (khong bi tu choi)");
        AssertFieldIdentified(ex, "name");
        Assert.Empty(repository.All<Location>());
    }

    // UTC03 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Location L1 has Room Types, Asset defaults and Billing Policies, plus active Contracts, Tenants, Invoices and maintenance history
    // Đầu vào : name="BHOME Go Vap"; setup=copy; sourceLocation=L1; items=[Room Types, Asset defaults, Pricing/Policies]
    // Mong đợi: Return: new Location created with an independent draft copy of the selected Room Types, Asset defaults and Pricing/Policies only, available for Owner review before saving; no Contracts, Tenants, Invoices, Payments, occupancy or maintenance history copied; later changes to L1 do not affect the copy; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 NF 4-6; UC-04 A5
    [Fact(DisplayName = "BF01 UTC03 - Tao Location bang cach sao chep cau hinh tu L1")]
    public void UTC03_CopySetupFromLocation() =>
        Assert.Fail("Chưa tìm thấy chức năng createLocation (setup=copy từ Location khác) trong hệ thống (danh mục chữ ký): LocationWrite không có tham số nguồn sao chép.");

    // ===================== deactivateLocation =====================

    // UTC04 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Location L1 is no longer operational; L1 has no active Contract
    // Đầu vào : location=L1; status=Inactive
    // Mong đợi: Return: Location L1 status=Inactive; record and business history retained (not deleted); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 A3, A4; Entity Location (Active/Inactive)
    [Fact(DisplayName = "BF01 UTC04 - Ngung hoat dong Location L1: Inactive, van giu ban ghi va lich su")]
    public async Task UTC04_DeactivateLocation()
    {
        var l1 = SeedLocation();
        repository.Changes.Add(new PropertyChange { Id = Guid.NewGuid(), TargetId = l1.Id, TargetType = "Location", Action = "Created", Reason = "", After = "{}" });

        var dto = await Owner().SaveLocationAsync(l1.Id, new LocationWrite(l1.Name, l1.Address, false, l1.Version, "No longer operational"), default);

        Assert.False(dto.IsActive);
        Assert.Contains(l1, repository.All<Location>());
        Assert.Contains(repository.Changes, c => c.TargetId == l1.Id && c.Action == "Created");
    }

    // UTC05 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Location L1 is referenced by Contracts, Invoices and operational history
    // Đầu vào : action=delete; location=L1
    // Mong đợi: Return: deletion not performed; L1 and its history preserved; Owner uses the Inactive state instead; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 A4
    [Fact(DisplayName = "BF01 UTC05 - Xoa Location co lich su: khong xoa duoc, dung trang thai Inactive")]
    public async Task UTC05_DeleteLocationNotPerformed()
    {
        var l1 = SeedLocation();
        var deleteMethods = typeof(PropertyService).GetMethods()
            .Where(m => m.Name.Contains("Delete", StringComparison.OrdinalIgnoreCase) || m.Name.Contains("Remove", StringComparison.OrdinalIgnoreCase))
            .Select(m => m.Name).ToArray();

        Assert.Empty(deleteMethods); // không có thao tác xóa Location
        Assert.Contains(l1, repository.All<Location>());
        var dto = await Owner().SaveLocationAsync(l1.Id, new LocationWrite(l1.Name, l1.Address, false, l1.Version, "Use Inactive instead of delete"), default);
        Assert.False(dto.IsActive); // Owner dùng trạng thái Inactive thay cho xóa
    }

    // ===================== createRoom =====================

    // UTC06 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Location L1 has Room Type RT1
    // Đầu vào : location=L1; roomNumber="204"; roomType=RT1; capacity=2
    // Mong đợi: Return: Room 204 saved under L1 with Room Type RT1 and capacity 2; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 NF 9-13; FE-01 1.1.1 (Room, Room Type, Capacity)
    [Fact(DisplayName = "BF01 UTC06 - Tao phong 204 thuoc L1, Room Type RT1, suc chua 2")]
    public async Task UTC06_CreateRoom()
    {
        var l1 = SeedLocation();
        var rt1 = SeedRoomType(l1);
        Assert.True(typeof(RoomWrite).GetProperty("RoomTypeId") is not null,
            "Khi tao phong khong chon duoc Room Type: RoomWrite khong co truong RoomTypeId (sheet yeu cau Room Type RT1)");

        var dto = await Owner().SaveRoomAsync(null, new RoomWrite(l1.Id, "204", null, 2), default);

        Assert.Equal(l1.Id, dto.LocationId);
        Assert.Equal("204", dto.RoomNumber);
        Assert.Equal(2, dto.Capacity);
        Assert.Equal(rt1.Id, repository.All<Room>().Single(r => r.Id == dto.Id).RoomTypeId);
    }

    // UTC07 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Room "204" already exists in L1
    // Đầu vào : location=L1; roomNumber="204"; roomType=RT1; capacity=2
    // Mong đợi: Return: change rejected as duplicate; room number field identified for correction; no second Room 204 created in L1; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 A1; Entity Room (room number interpreted within its Location)
    [Fact(DisplayName = "BF01 UTC07 - Trung so phong 204 trong L1: bi tu choi, khong tao phong thu hai")]
    public async Task UTC07_DuplicateRoomNumber()
    {
        var l1 = SeedLocation();
        SeedRoom(l1, "204");

        var ex = await Record.ExceptionAsync(() => Owner().SaveRoomAsync(null, new RoomWrite(l1.Id, "204", null, 2), default));

        Assert.True(ex is not null, "Phong 204 bi trung trong L1 nhung van duoc tao");
        AssertFieldIdentified(ex, "room");
        Assert.Single(repository.All<Room>(), r => r.LocationId == l1.Id && r.RoomNumber == "204");
    }

    // UTC08 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Room "204" exists in L1 only
    // Đầu vào : locationId=L2; roomNumber="204"
    // Mong đợi: Return: <valid room id> (room number is unique per Location); Exception: N/A; Log Message: N/A
    // Căn cứ  : Entity Room: room number is interpreted within its Location; UC-04 NF 9-13
    [Fact(DisplayName = "BF01 UTC08 - So phong 204 o L2 khi L1 da co 204: tao duoc, tra ve id hop le")]
    public async Task UTC08_SameRoomNumberOtherLocation()
    {
        var l1 = SeedLocation();
        var l2 = SeedLocation("BHOME Go Vap");
        SeedRoom(l1, "204");

        var dto = await Owner().SaveRoomAsync(null, new RoomWrite(l2.Id, "204", null, 2), default);

        Assert.NotEqual(Guid.Empty, dto.Id);
        Assert.Equal(l2.Id, dto.LocationId);
        Assert.Contains(repository.All<Room>(), r => r.Id == dto.Id && r.LocationId == l2.Id);
    }

    // UTC09 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Room Type RT9 belongs to Location L2
    // Đầu vào : location=L1; roomNumber="205"; roomType=RT9; capacity=2
    // Mong đợi: Return: change rejected; Room Type field identified for correction (Room Type must be one of L1's Room Types); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 NF 9, 11 (validate dependencies), A1; Entity RoomType (identifier within one Location)
    [Fact(DisplayName = "BF01 UTC09 - Room Type cua Location khac: bi tu choi, chi ra truong Room Type")]
    public async Task UTC09_RoomTypeFromOtherLocation()
    {
        var l1 = SeedLocation();
        var l2 = SeedLocation("BHOME Go Vap");
        SeedRoomType(l2, "RT9");
        Assert.True(typeof(RoomWrite).GetProperty("RoomTypeId") is not null,
            "Khong kiem tra duoc Room Type khi tao phong: RoomWrite khong co truong RoomTypeId de chon RT9");

        var ex = await Record.ExceptionAsync(() => Owner().SaveRoomAsync(null, new RoomWrite(l1.Id, "205", null, 2), default));
        Assert.True(ex is not null, "Room Type cua Location khac nhung phong van duoc tao");
        AssertFieldIdentified(ex, "roomtype");
    }

    // UTC10 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff S1 logged in; S1 assigned to L1
    // Đầu vào : location=L1; roomNumber="206"; roomType=RT1; capacity=2
    // Mong đợi: Return: action rejected; no Room created; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : FE-01 1.1.1 (only Owner may create/update; Staff view only); Permission Matrix 4.4 Location/Room; GBR-02; MSG03
    // Ghi chú : Log Message (MSG03) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF01 UTC10 - Staff duoc giao L1 tao phong: bi tu choi, khong tao phong")]
    public async Task UTC10_StaffCannotCreateRoom()
    {
        var l1 = SeedLocation();
        SeedRoomType(l1, "RT1");

        var ex = await Record.ExceptionAsync(() => Service(Actor.Staff(l1.Id)).SaveRoomAsync(null, new RoomWrite(l1.Id, "206", null, 2), default));

        Assert.True(ex is not null, "Staff tao duoc phong (khong bi tu choi)");
        Assert.Empty(repository.All<Room>());
    }

    // ===================== changeRoomStatus =====================

    // UTC11 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Room 204 Available; no Holding or tenancy obligation on Room 204
    // Đầu vào : room=204; status=Unavailable
    // Mong đợi: Return: Room 204 status=Unavailable; Room record and history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 A3; Entity Room (Available / On Hold / Occupied / Unavailable)
    [Fact(DisplayName = "BF01 UTC11 - Phong 204 Available chuyen Unavailable: thanh cong, giu ban ghi va lich su")]
    public async Task UTC11_RoomToUnavailable()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "204");
        repository.Changes.Add(new PropertyChange { Id = Guid.NewGuid(), TargetId = room.Id, TargetType = "Room", Action = "Created", Reason = "", After = "{}" });

        var dto = await Owner().SaveRoomAsync(room.Id, new RoomWrite(l1.Id, "204", null, 2, RoomStatus.Unavailable, room.Version, "Maintenance"), default);

        Assert.Equal(RoomStatus.Unavailable, dto.Status);
        Assert.Contains(room, repository.All<Room>());
        Assert.Contains(repository.Changes, c => c.TargetId == room.Id && c.Action == "Created");
    }

    // UTC12 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Room 204 Occupied under an active Main Tenancy Contract
    // Đầu vào : room=204; status=Available
    // Mong đợi: Return: manual status change not allowed; Room 204 remains Occupied; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-04 A2; FE-01 1.1.1; UC-04 Post 2
    [Fact(DisplayName = "BF01 UTC12 - Phong dang Occupied doi tay sang Available: khong cho phep, van Occupied")]
    public async Task UTC12_OccupiedRoomManualChange()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "204", RoomStatus.Occupied);
        repository.RoomsWithResidents.Add(room.Id);
        repository.RoomObligationsByRoom[room.Id] = new RoomObligations(true, true, true, false);

        var ex = await Record.ExceptionAsync(() => Owner().SaveRoomAsync(room.Id, new RoomWrite(l1.Id, "204", null, 2, RoomStatus.Available, room.Version, "Manual change"), default));

        Assert.True(ex is not null, "Doi tay trang thai phong Occupied sang Available van duoc chap nhan");
        Assert.Equal(RoomStatus.Occupied, room.Status);
    }

    // ===================== registerAsset =====================

    // UTC13 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Room 204 exists in L1
    // Đầu vào : location=L1; scope=Room; room=204; name="Aircon Daikin 1HP"; category=Air conditioner; condition=Good; purchasePrice=7500000
    // Mong đợi: Return: Asset saved and linked to Room 204 with status Active; condition and maintenance history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-05 NF 2-9, Post 1-2; FE-01 1.1.2; Entity Asset (lifecycle starts Active)
    // Ghi chú : AssetWrite không có trường purchasePrice nên không truyền được giá mua (sheet không kỳ vọng gì về giá trong Return).
    [Fact(DisplayName = "BF01 UTC13 - Dang ky tai san cho phong 204: luu, gan phong 204, Active, giu tinh trang va lich su")]
    public async Task UTC13_RegisterRoomAsset()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "204");

        var dto = await Owner().SaveAssetAsync(null, new AssetWrite(l1.Id, room.Id, null, null, "Aircon Daikin 1HP", "Air conditioner", "Good"), default);

        Assert.Equal(room.Id, dto.RoomId);
        Assert.Equal(AssetStatus.Active, dto.Status);
        Assert.Equal("Good", dto.Condition);
        Assert.Contains(repository.All<Asset>(), a => a.Id == dto.Id);
        Assert.Contains(repository.Changes, c => c.TargetId == dto.Id);
    }

    // UTC14 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Location L1 exists
    // Đầu vào : location=L1; scope=Room; room=empty; name="Aircon Daikin 1HP"
    // Mong đợi: Return: assignment rejected; a valid Room is required for Room scope; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-05 NF 7, A1, A2; FE-01 1.1.2 (Scope, Room)
    // Ghi chú : AssetWrite không có trường scope; scope=Room với room rỗng được biểu diễn bằng RoomId=null và CommonArea=null.
    [Fact(DisplayName = "BF01 UTC14 - Tai san pham vi Room nhung khong chon phong: bi tu choi")]
    public async Task UTC14_RoomScopeWithoutRoom()
    {
        var l1 = SeedLocation();

        var ex = await Record.ExceptionAsync(() => Owner().SaveAssetAsync(null, new AssetWrite(l1.Id, null, null, null, "Aircon Daikin 1HP", "Air conditioner", "Good"), default));

        Assert.True(ex is not null, "Tai san pham vi Room khong co phong van duoc luu");
        Assert.Empty(repository.All<Asset>());
    }

    // UTC15 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Location L1 exists
    // Đầu vào : scope=Common Area; commonArea="Floor 2 corridor"
    // Mong đợi: Return: Asset created for the common area; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-05 NF 5 (assign to Room/common area); FE-01 1.1.2 Scope
    [Fact(DisplayName = "BF01 UTC15 - Tai san khu vuc chung 'Floor 2 corridor': tao thanh cong")]
    public async Task UTC15_CommonAreaAsset()
    {
        var l1 = SeedLocation();

        var dto = await Owner().SaveAssetAsync(null, new AssetWrite(l1.Id, null, "Floor 2 corridor", null, "Fire extinguisher", "Safety", "Good"), default);

        Assert.Equal("Floor 2 corridor", dto.CommonArea);
        Assert.Null(dto.RoomId);
        Assert.Contains(repository.All<Asset>(), a => a.Id == dto.Id);
    }

    // ===================== retireAsset =====================

    // UTC16 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Asset A1 Active with repair history
    // Đầu vào : asset=A1; status=Retired
    // Mong đợi: Return: A1 status=Retired; repair/maintenance history of A1 preserved; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-05 A3; FE-01 1.1.2 (Status; only Owner may retire); Entity Asset
    [Fact(DisplayName = "BF01 UTC16 - Cho tai san A1 ngung su dung: Retired, giu lich su sua chua")]
    public async Task UTC16_RetireAsset()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "204");
        var a1 = SeedAsset(l1, room);
        repository.Changes.Add(new PropertyChange { Id = Guid.NewGuid(), TargetId = a1.Id, TargetType = "Asset", Action = "Repaired", Reason = "", After = "{}" });

        var dto = await Owner().SaveAssetAsync(a1.Id, new AssetWrite(l1.Id, room.Id, null, null, a1.Name, a1.Category, a1.Condition, AssetStatus.Retired, a1.Version, "End of life"), default);

        Assert.Equal(AssetStatus.Retired, dto.Status);
        Assert.Contains(a1, repository.All<Asset>());
        Assert.Contains(repository.Changes, c => c.TargetId == a1.Id && c.Action == "Repaired");
    }

    // UTC17 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Asset A1 has historical maintenance records
    // Đầu vào : action=delete; asset=A1
    // Mong đợi: Return: deletion prevented; A1 and its history preserved; Owner may retire or replace A1 instead; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-05 A3
    [Fact(DisplayName = "BF01 UTC17 - Xoa tai san co lich su bao tri: khong xoa duoc, co the Retire")]
    public async Task UTC17_DeleteAssetPrevented()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "204");
        var a1 = SeedAsset(l1, room);
        var deleteMethods = typeof(PropertyService).GetMethods()
            .Where(m => m.Name.Contains("Delete", StringComparison.OrdinalIgnoreCase) || m.Name.Contains("Remove", StringComparison.OrdinalIgnoreCase))
            .Select(m => m.Name).ToArray();

        Assert.Empty(deleteMethods); // không có thao tác xóa tài sản
        Assert.Contains(a1, repository.All<Asset>());
        var dto = await Owner().SaveAssetAsync(a1.Id, new AssetWrite(l1.Id, room.Id, null, null, a1.Name, a1.Category, a1.Condition, AssetStatus.Retired, a1.Version, "Retire instead of delete"), default);
        Assert.Equal(AssetStatus.Retired, dto.Status);
    }

    // ===================== createBillingPolicyVersion =====================

    // UTC18 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; L1 has no Electricity policy
    // Đầu vào : scope=Location L1; chargeType=Electricity; chargingMethod=Metered; rate=3500 VND/kWh; effectiveFrom=2026-11-01; effectiveTo=empty
    // Mong đợi: Return: policy stored as an effective-dated version for L1 Electricity; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 NF 2-9; FE-01 1.1.3; GBR-08
    [Fact(DisplayName = "BF01 UTC18 - Tao bang gia Dien L1 3500 tu 2026-11-01: luu thanh version co hieu luc")]
    public async Task UTC18_CreateElectricityPolicy()
    {
        var l1 = SeedLocation();

        var dto = await Owner().CreatePolicyAsync(Policy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3500, Nov1, null), default);

        Assert.Equal(l1.Id, dto.LocationId);
        Assert.Equal(ChargeCategory.Electricity, dto.Category);
        Assert.Equal(3500m, dto.Rate);
        Assert.Equal(Nov1, dto.EffectiveFrom);
        Assert.Null(dto.EffectiveTo);
        Assert.Contains(repository.All<BillingPolicy>(), p => p.Id == dto.Id);
    }

    // UTC19 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; L1 Electricity v1 (3,500) already used by an issued Invoice
    // Đầu vào : policy=v1; rate=3800
    // Mong đợi: Return: direct change to v1 not allowed; v1 and the issued Invoice remain unchanged; Owner is required to create a new effective-dated policy; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 A4, Post 2-3; GBR-08; FE-04 4.1.1
    // Ghi chú : Hóa đơn không thuộc hàm này; test kiểm tra v1 bị từ chối sửa và giữ nguyên.
    [Fact(DisplayName = "BF01 UTC19 - Sua truc tiep version da dung cho hoa don: khong cho phep, v1 giu nguyen")]
    public async Task UTC19_UsedPolicyCannotBeEdited()
    {
        var l1 = SeedLocation();
        var v1 = SeedPolicy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3500, Nov1, null);
        v1.RecordUsage(Now);

        var ex = await Record.ExceptionAsync(() => Owner().UpdateFuturePolicyAsync(v1.Id,
            new PolicyUpdate(Policy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3800, Nov1, null), v1.Version), default));

        Assert.True(ex is not null, "Version v1 da dung cho hoa don van sua truc tiep duoc");
        Assert.Equal(3500m, v1.Rate);
        Assert.Equal(Nov1, v1.EffectiveFrom);
    }

    // UTC20 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; L1 Electricity v1 effective 2026-11-01 to 2026-12-31
    // Đầu vào : scope=Location L1; chargeType=Electricity; rate=3800; effectiveFrom=2026-12-01; effectiveTo=empty
    // Mong đợi: Return: policy rejected as a conflicting effective period; Owner must correct the dates; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 A3
    [Fact(DisplayName = "BF01 UTC20 - Version moi chong thoi gian hieu luc voi v1: bi tu choi")]
    public async Task UTC20_OverlappingPeriodRejected()
    {
        var l1 = SeedLocation();
        SeedPolicy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3500, Nov1, Dec31);

        var ex = await Record.ExceptionAsync(() => Owner().CreatePolicyAsync(Policy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3800, Dec1, null), default));

        Assert.True(ex is not null, "Version chong thoi gian hieu luc voi v1 van duoc luu");
        Assert.Single(repository.All<BillingPolicy>());
    }

    // UTC21 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; L1 Electricity v1 effective 2026-11-01 to 2026-12-31
    // Đầu vào : scope=Location L1; chargeType=Electricity; rate=3800; effectiveFrom=2027-01-01; effectiveTo=empty
    // Mong đợi: Return: new version stored; v1 retained unchanged as history; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 NF 9, A3, Post 2; GBR-08
    [Fact(DisplayName = "BF01 UTC21 - Version moi tu 2027-01-01: luu, v1 giu nguyen lam lich su")]
    public async Task UTC21_NextVersionStored()
    {
        var l1 = SeedLocation();
        var v1 = SeedPolicy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3500, Nov1, Dec31);

        var dto = await Owner().CreatePolicyAsync(Policy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3800, Jan1, null), default);

        Assert.Equal(3800m, dto.Rate);
        Assert.Equal(Jan1, dto.EffectiveFrom);
        Assert.Equal(2, repository.All<BillingPolicy>().Count());
        Assert.Equal(3500m, v1.Rate);
        Assert.Equal(Nov1, v1.EffectiveFrom);
        Assert.Equal(Dec31, v1.EffectiveTo);
    }

    // UTC22 (Boundary) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in
    // Đầu vào : scope=Location L1; chargeType=Service Fee; chargingMethod=Fixed; rate=0; effectiveFrom=2026-12-01
    // Mong đợi: Return: policy stored (0 is not a negative value); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 A1 (rejects negative values)
    [Fact(DisplayName = "BF01 UTC22 - Phi dich vu don gia 0: duoc luu")]
    public async Task UTC22_ZeroRateStored()
    {
        var l1 = SeedLocation();

        var dto = await Owner().CreatePolicyAsync(Policy(l1, ChargeCategory.ServiceFee, ChargingMethod.FixedPerRoomPerMonth, 0, Dec1, null), default);

        Assert.Equal(0m, dto.Rate);
        Assert.Contains(repository.All<BillingPolicy>(), p => p.Id == dto.Id);
    }

    // UTC23 (Boundary) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in
    // Đầu vào : scope=Location L1; chargeType=Service Fee; chargingMethod=Fixed; rate=-1; effectiveFrom=2026-12-01
    // Mong đợi: Return: policy rejected; Rate field identified for correction; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 A1 (rejects negative values)
    [Fact(DisplayName = "BF01 UTC23 - Don gia -1: bi tu choi, chi ra truong Rate")]
    public async Task UTC23_NegativeRateRejected()
    {
        var l1 = SeedLocation();

        var ex = await Record.ExceptionAsync(() => Owner().CreatePolicyAsync(Policy(l1, ChargeCategory.ServiceFee, ChargingMethod.FixedPerRoomPerMonth, -1, Dec1, null), default));

        Assert.True(ex is not null, "Don gia am van duoc luu");
        AssertFieldIdentified(ex, "rate");
        Assert.Empty(repository.All<BillingPolicy>());
    }

    // UTC24 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in
    // Đầu vào : scope=Location L1; chargeType=Water; chargingMethod=Metered; rate=empty; effectiveFrom=2026-12-01
    // Mong đợi: Return: policy rejected; Rate field identified for correction; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-06 NF 5, A1 (rejects missing values); MSG02
    // Ghi chú : Rate kiểu decimal nên "rỗng" chỉ biểu diễn được ở dữ liệu gửi lên (JSON thiếu rate) -> kiểm tra việc đọc PolicyWrite.
    //           Log Message (MSG02) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF01 UTC24 - Bang gia Nuoc khong nhap don gia: bi tu choi, chi ra truong Rate")]
    public void UTC24_MissingRateRejected()
    {
        var l1 = Guid.NewGuid();
        var json = $$"""{"locationId":"{{l1}}","roomId":null,"category":"Water","chargeCode":"WATER","name":"Water","method":"Metered","effectiveFrom":"2026-12-01","effectiveTo":null,"reason":"x"}""";
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };

        var ex = Record.Exception(() => JsonSerializer.Deserialize<PolicyWrite>(json, options));

        Assert.True(ex is not null, "Thieu don gia (rate) nhung bang gia van duoc chap nhan");
        AssertFieldIdentified(ex, "rate");
    }

    // UTC25 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in
    // Đầu vào : scope=Location L1; chargeType=Water; rate=15000; effectiveFrom=2026-12-01; effectiveTo=2026-11-30
    // Mong đợi: Return: policy rejected; Owner required to correct the effective dates; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-06 NF 6-7, A2
    [Fact(DisplayName = "BF01 UTC25 - Ngay ket thuc truoc ngay bat dau: bi tu choi")]
    public async Task UTC25_EndBeforeStartRejected()
    {
        var l1 = SeedLocation();

        var ex = await Record.ExceptionAsync(() => Owner().CreatePolicyAsync(Policy(l1, ChargeCategory.Water, ChargingMethod.Metered, 15000, Dec1, new DateOnly(2026, 11, 30)), default));

        Assert.True(ex is not null, "Ngay ket thuc truoc ngay bat dau van duoc luu");
        Assert.Empty(repository.All<BillingPolicy>());
    }

    // ===================== resolveBillingPolicy =====================

    // UTC26 (Normal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: L1 Electricity v1 (3,500) effective 2026-11-01 to 2026-12-31; v2 (3,800) from 2027-01-01
    // Đầu vào : location=L1; chargeType=Electricity; billingDate=2026-12-15
    // Mong đợi: Return: v1 rate 3,500 applied; v2 not used; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-08 (effective-dated policies); UC-21 NF 2; UC-06 Post 1
    // Ghi chú : việc chọn version theo ngày của hệ thống thật nằm ở repository (tầng DB); ở đây repository giả lập
    //           theo hợp đồng "ApplicablePoliciesAsync(room, date)" nên test chỉ kiểm tra phần PropertyService.
    [Fact(DisplayName = "BF01 UTC26 - Tinh gia ngay 2026-12-15: ap dung v1 3500, khong dung v2")]
    public async Task UTC26_ResolveEffectiveVersion()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "204");
        var v1 = SeedPolicy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3500, Nov1, Dec31);
        var v2 = SeedPolicy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3800, Jan1, null);

        var prices = await Owner().ResolvePricesAsync(room.Id, new DateOnly(2026, 12, 15), default);

        var electricity = Assert.Single(prices.Charges, c => c.Category == ChargeCategory.Electricity);
        Assert.Equal(v1.Id, electricity.Id);
        Assert.Equal(3500m, electricity.Rate);
        Assert.DoesNotContain(prices.Charges, c => c.Id == v2.Id);
    }

    // UTC27 (Abnormal) - sheet "BF-01 Location Setup", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: No Water policy applies to Room 205 for billing period 2026-12
    // Đầu vào : room=205; chargeType=Water; billingPeriod=2026-12
    // Mong đợi: Return: no applicable Water policy; Water identified as missing billing input; Invoice stays Draft and is not finalized; Exception: N/A; Log Message: "Required billing information is incomplete."
    // Căn cứ  : UC-21 Pre 2, NF 6, A3; GBR-09; JOB-10; MSG09
    // Ghi chú : phần "Invoice stays Draft" thuộc chức năng hóa đơn (BF-05), không quan sát được ở hàm này;
    //           Log Message (MSG09) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF01 UTC27 - Phong 205 khong co bang gia Nuoc ky 2026-12: bao thieu Nuoc")]
    public async Task UTC27_MissingWaterPolicy()
    {
        var l1 = SeedLocation();
        var room = SeedRoom(l1, "205");
        SeedPolicy(l1, ChargeCategory.Electricity, ChargingMethod.Metered, 3500, Nov1, null);

        var prices = await Owner().ResolvePricesAsync(room.Id, Dec1, default);

        Assert.DoesNotContain(prices.Charges, c => c.Category == ChargeCategory.Water);
        Assert.Contains(prices.MissingRequiredCharges, m => m.Contains("water", StringComparison.OrdinalIgnoreCase));
    }
}
