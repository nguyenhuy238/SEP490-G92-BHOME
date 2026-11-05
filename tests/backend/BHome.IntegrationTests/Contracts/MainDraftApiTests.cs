using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml.Linq;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using iText.Kernel.Pdf;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Docker")]
public sealed class MainDraftApiTests(ContractFixture fixture) : IClassFixture<ContractFixture>
{
    private const string Root = "/api/v1/contracts/main-drafts";
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7));
    private sealed record Workspace(HttpClient Owner, HttpClient Staff, HttpClient Outside, Guid OwnerId, Guid Room, Guid Location, Guid Resident);
    private async Task<(HttpClient Client, Guid Id)> User(string role)
    {
        var id = Guid.NewGuid(); var email = $"{id:N}@example.invalid"; const string password = "Synthetic-Draft!874";
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { Id = id, UserName = email, Email = email, IsActive = true };
            user = await BHome.IntegrationTests.Compact24.WorkflowTestUsers.CreateAsync(scope.ServiceProvider, user, role, password);
            id = user.Id; email = user.Email!;
        }
        var client = fixture.Factory.CreateClient(); var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        response.EnsureSuccessStatusCode(); var login = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken); return (client, id);
    }
    private async Task<Workspace> Setup(bool settings = true, bool verified = true, bool prices = true)
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff); var outside = await User(Roles.Staff);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var location = new Location("SYNTHETIC DRAFT LOCATION") { ChainId = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? null : await db.Set<BHome.Domain.PropertyManagement.Chain>().Select(c => c.Id).SingleAsync(), Address = "Địa chỉ kiểm thử tổng hợp", IsActive = true };
        var room = new Room { LocationId = location.Id, RoomNumber = "TEST-DRAFT", Capacity = 3, Status = RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = owner.Id, DisplayLabel = "SYNTHETIC RESIDENT", VerificationStatus = verified ? IdentityVerificationStatus.Verified : IdentityVerificationStatus.Pending };
        var identity = new IdentityConfirmation(true, "000000000123", "NGƯỜI KIỂM THỬ", new(2000, 1, 2), "Địa chỉ thường trú kiểm thử", "TEST", null, null, new(2021, 6, 15), new(2030, 1, 1));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(identity);
        try { resident.IdentityData = JsonSerializer.Serialize(scope.ServiceProvider.GetRequiredService<IIdentityProtection>().Encrypt(bytes, new(owner.Id, resident.Id))); } finally { CryptographicOperations.ZeroMemory(bytes); }
        db.AddRange(location, room, resident, new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddDays(-5), Today.AddDays(500)));
        if (prices) foreach (var (code, category, rate) in new[] { ("RENT", ChargeCategory.Rent, 3100000m), ("ELECTRICITY", ChargeCategory.Electricity, 3500m), ("WATER", ChargeCategory.Water, 18000m) }) db.Add(new BillingPolicy { LocationId = location.Id, Category = category, ChargeCode = code, Name = code, Rate = rate, Method = category == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered, EffectiveFrom = Today.AddDays(-1) });
        await db.SaveChangesAsync();
        if (settings)
        {
            var config = new MainContractSettingsInput(owner.Id, Today.AddDays(-1), null, 6200000, "Chuyển khoản theo cấu hình kiểm thử", "Điều khoản kiểm thử tổng hợp", new("OWNER KIỂM THỬ", new(1980, 1, 1), "000000000456", new(2020, 1, 1), "Nơi cấp kiểm thử", "Địa chỉ Owner kiểm thử", "0000000000"), 0);
            var response = await owner.Client.PutAsJsonAsync($"{Root}/settings/{location.Id}", config); await Success(response);
        }
        return new(owner.Client, staff.Client, outside.Client, owner.Id, room.Id, location.Id, resident.Id);
    }
    private static MainDraftInput Input(Workspace w) => new(w.Room, w.Resident, [w.Resident], Today, Today.AddYears(1), "Ghi chú kiểm thử", "0000000001", "Nơi cấp kiểm thử");
    private static async Task Success(HttpResponseMessage response) => Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    private static async Task<MainDraftView> Save(Workspace w, MainDraftInput? input = null, Guid? key = null, Guid? id = null)
    {
        using var request = new HttpRequestMessage(id is null ? HttpMethod.Post : HttpMethod.Put, id is null ? Root : $"{Root}/{id}") { Content = JsonContent.Create(input ?? Input(w)) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        var response = await w.Staff.SendAsync(request); await Success(response); return (await response.Content.ReadFromJsonAsync<MainDraftView>())!;
    }
    [Fact]
    public async Task VerifiedOnboardingCreatesDraftWithoutTenantAndPersistsDocxWhenPdfConverterMissing()
    {
        var w = await Setup();
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var beforeUsers = await db.Users.CountAsync();
        var key = Guid.NewGuid(); var draft = await Save(w, key: key); var replay = await Save(w, key: key);
        Assert.Equal(draft.Id, replay.Id); Assert.Equal("Draft", draft.Status);
        Assert.Equal(3100000, draft.Preparation.Charges.Single(p => p.ChargeCode == "RENT").Rate);
        Assert.Equal(6200000, draft.Preparation.SecurityDeposit); Assert.Equal(new DateOnly(2021, 6, 15), draft.Preparation.Residents.Single().DateOfIssue);
        Assert.Equal("********0123", draft.Preparation.Residents.Single().MaskedCitizenNumber);
        var contract = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == draft.Id);
        Assert.Null(contract.TenantUserId); Assert.Equal(ContractStatus.Draft, contract.Status); Assert.Null(contract.ActivatedAt); Assert.Equal(0, contract.AppliedHoldingDeposit);
        Assert.Empty(await db.Set<ContractSignature>().Where(s => s.ContractId == draft.Id).ToArrayAsync());
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().FindAsync(w.Room))!.Status); Assert.Equal(beforeUsers, await db.Users.CountAsync());
        var generated = await w.Staff.PostAsync($"{Root}/{draft.Id}/documents", null); await Success(generated);
        var docs = (await generated.Content.ReadFromJsonAsync<MainDraftFiles>())!;
        Assert.Null(docs.Pdf); Assert.Equal("contract_pdf_converter_unavailable", docs.PreviewError);
        var downloaded = await w.Staff.GetAsync($"{Root}/{draft.Id}/documents/{docs.Docx.Id}"); await Success(downloaded);
        using var zip = new ZipArchive(new MemoryStream(await downloaded.Content.ReadAsByteArrayAsync()));
        using var content = zip.GetEntry("word/document.xml")!.Open(); var xml = XDocument.Load(content);
        XNamespace ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"; var text = string.Join("\n", xml.Descendants(ns + "t").Select(n => n.Value));
        Assert.Contains("NGƯỜI KIỂM THỬ", text); Assert.Contains("15/06/2021", text); Assert.Contains("18.000 đ/m³", text); Assert.Contains("3.100.000 đ/tháng", text);
        Assert.Contains("TRÁCH NHIỆM CHUNG", text); Assert.DoesNotContain("…", text); Assert.DoesNotContain("{{", text);
        var repeat = await w.Staff.PostAsync($"{Root}/{draft.Id}/documents", null); await Success(repeat);
        Assert.Equal(docs.Docx.Id, (await repeat.Content.ReadFromJsonAsync<MainDraftFiles>())!.Docx.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Outside.GetAsync($"{Root}/{draft.Id}/documents/{docs.Docx.Id}")).StatusCode);
        var reopened = await w.Staff.GetFromJsonAsync<MainDraftView>($"{Root}/{draft.Id}"); Assert.Equal(draft.Id, reopened!.Id);
        var updated = await Save(w, Input(w) with { EndDate = Today.AddYears(2), ExpectedVersion = draft.Version }, id: draft.Id); Assert.Equal(2, updated.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.GetAsync($"{Root}/{draft.Id}/documents/{docs.Docx.Id}")).StatusCode);
    }
    [Theory]
    [InlineData(false, true, true, "owner_contract_settings_required")]
    [InlineData(true, false, true, "verified_residents_required")]
    [InlineData(true, true, false, "missing_policy_rent")]
    public async Task MissingAuthoritativeInputsDoNotCreateDraft(bool settings, bool verified, bool prices, string code)
    {
        var w = await Setup(settings, verified, prices);
        using var request = new HttpRequestMessage(HttpMethod.Post, Root) { Content = JsonContent.Create(Input(w)) }; request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var response = await w.Staff.SendAsync(request); Assert.Contains(response.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict });
        Assert.Contains(code, await response.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task ActualLibreOfficeConversionPersistsPrivatePdfWithVietnameseAndIssueDate()
    {
        var w = await Setup(); var draft = await Save(w);
        var originalConfig = fixture.Factory.Services.GetRequiredService<IConfiguration>();
        var settings = originalConfig.GetSection("IdentityProtection").AsEnumerable().ToDictionary(x => x.Key, x => x.Value);
        settings["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local";
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings)));
        using var client = host.CreateClient(); client.DefaultRequestHeaders.Authorization = w.Staff.DefaultRequestHeaders.Authorization;
        var response = await client.PostAsync($"{Root}/{draft.Id}/documents", null); await Success(response);
        var files = (await response.Content.ReadFromJsonAsync<MainDraftFiles>())!; Assert.Null(files.PreviewError); Assert.NotNull(files.Pdf);
        var bytes = await client.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{files.Pdf.Id}");
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = ContractPdfRendererTests.Text(pdf);
        Assert.Contains("NGƯỜI KIỂM THỬ", text); Assert.Contains("15/06/2021", text); Assert.Contains("18.000", text); Assert.Contains("TRÁCH NHIỆM CHUNG", text); Assert.DoesNotContain("…", text);
        var destination = Environment.GetEnvironmentVariable("BHOME_CONTRACT_QA_DIR");
        if (!string.IsNullOrWhiteSpace(destination))
        {
            Directory.CreateDirectory(destination); await File.WriteAllBytesAsync(System.IO.Path.Combine(destination, "synthetic-contract.pdf"), bytes);
            await File.WriteAllBytesAsync(System.IO.Path.Combine(destination, "synthetic-contract.docx"), await client.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{files.Docx.Id}"));
        }
    }
    [Fact]
    public async Task RejectsDuplicateInvalidPeriodUnassignedStaffAndNonDraftEdits()
    {
        var w = await Setup(); var draft = await Save(w);
        using (var duplicate = new HttpRequestMessage(HttpMethod.Post, Root) { Content = JsonContent.Create(Input(w)) })
        {
            duplicate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.SendAsync(duplicate)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await w.Outside.GetAsync($"{Root}/{draft.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.GetAsync($"{Root}/settings/{w.Location}")).StatusCode);
        using (var invalid = new HttpRequestMessage(HttpMethod.Post, Root) { Content = JsonContent.Create(Input(w) with { EndDate = Today }) })
        {
            invalid.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); Assert.Equal(HttpStatusCode.BadRequest, (await w.Staff.SendAsync(invalid)).StatusCode);
        }
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var c = await db.Set<Contract>().FindAsync(draft.Id); c!.Status = ContractStatus.Cancelled; await db.SaveChangesAsync();
        }
        using var update = new HttpRequestMessage(HttpMethod.Put, $"{Root}/{draft.Id}") { Content = JsonContent.Create(Input(w) with { ExpectedVersion = 1 }) }; update.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.SendAsync(update)).StatusCode);
    }
    [Fact]
    public async Task EffectiveDateUsesRevisedSettingsAndFutureRentalRateWithoutRevivingOldSettings()
    {
        var w = await Setup();
        var current = (await w.Owner.GetFromJsonAsync<MainContractSettings>($"{Root}/settings/{w.Location}"))!;
        var end = Today.AddDays(5);
        await Success(await w.Owner.PutAsJsonAsync($"{Root}/settings/{w.Location}", new MainContractSettingsInput(w.OwnerId, current.EffectiveFrom, end, current.SecurityDeposit, current.PaymentTerms, current.AdditionalTerms, current.Owner, 1)));
        await Success(await w.Owner.PutAsJsonAsync($"{Root}/settings/{w.Location}", new MainContractSettingsInput(w.OwnerId, end.AddDays(1), null, 7000000, current.PaymentTerms, current.AdditionalTerms, current.Owner, 2)));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var rent = await db.Set<BillingPolicy>().SingleAsync(p => p.LocationId == w.Location && p.ChargeCode == "RENT"); rent.EffectiveTo = end;
            db.Add(new BillingPolicy { LocationId = w.Location, Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "FUTURE TEST RENT", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 3400000, EffectiveFrom = end.AddDays(1) });
            await db.SaveChangesAsync();
        }
        var result = await w.Staff.GetFromJsonAsync<MainDraftPreparation>($"{Root}/preparation?roomId={w.Room}&representativeResidentId={w.Resident}&residentIds={w.Resident}&effectiveOn={end.AddDays(2):yyyy-MM-dd}");
        Assert.Empty(result!.Blockers); Assert.Equal(7000000, result.SecurityDeposit); Assert.Equal(3400000, result.Charges.Single(p => p.ChargeCode == "RENT").Rate);
    }
    [Fact]
    public async Task RejectsUnavailableRoomAndConcurrentCreationReplaysOneDraft()
    {
        var w = await Setup(); var key = Guid.NewGuid();
        var results = await Task.WhenAll(Save(w, key: key), Save(w, key: key)); Assert.Equal(results[0].Id, results[1].Id);
        var outside = await Setup();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var room = await db.Set<Room>().FindAsync(outside.Room); room!.Status = RoomStatus.Unavailable; await db.SaveChangesAsync();
        }
        using var request = new HttpRequestMessage(HttpMethod.Post, Root) { Content = JsonContent.Create(Input(outside)) }; request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var rejected = await outside.Staff.SendAsync(request); Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode); Assert.Contains("room_not_available", await rejected.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task VerifiedFlagWithoutConfirmedIdentityDoesNotGenerateAnIncompleteContract()
    {
        var w = await Setup();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var resident = await db.Set<Resident>().FindAsync(w.Resident); resident!.IdentityData = "{}"; await db.SaveChangesAsync();
        }
        var response = await w.Staff.GetAsync($"{Root}/preparation?roomId={w.Room}&representativeResidentId={w.Resident}&residentIds={w.Resident}&effectiveOn={Today:yyyy-MM-dd}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Contains("confirmed_identity_required", await response.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task FamilyMembersShareOneDraftButIndependentRepresentativesGetSeparateContracts()
    {
        var w = await Setup(); Guid memberId, friendId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var protection = scope.ServiceProvider.GetRequiredService<IIdentityProtection>();
            Resident Add(string number, ResidentType type)
            {
                var r = new Resident { RoomId = w.Room, OwnerUserId = w.OwnerId, DisplayLabel = "SYNTHETIC MEMBER", ResidentType = type, VerificationStatus = IdentityVerificationStatus.Verified };
                var bytes = JsonSerializer.SerializeToUtf8Bytes(new IdentityConfirmation(true, number, "THÀNH VIÊN KIỂM THỬ", new(2000, 1, 1), "Địa chỉ kiểm thử", null, null, null, new(2021, 1, 1), null));
                try { r.IdentityData = JsonSerializer.Serialize(protection.Encrypt(bytes, new(w.OwnerId, r.Id))); } finally { CryptographicOperations.ZeroMemory(bytes); }
                db.Add(r); return r;
            }
            memberId = Add("000000000124", ResidentType.CoOccupant).Id; friendId = Add("000000000125", ResidentType.Representative).Id; await db.SaveChangesAsync();
        }
        var family = await Save(w, Input(w) with { ResidentIds = [w.Resident, memberId] }); Assert.Equal(2, family.Preparation.Residents.Count);
        using (var invalid = new HttpRequestMessage(HttpMethod.Post, Root) { Content = JsonContent.Create(Input(w) with { ResidentIds = [w.Resident, friendId] }) })
        {
            invalid.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); var response = await w.Staff.SendAsync(invalid); Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Contains("individual_representatives_require_separate_contracts", await response.Content.ReadAsStringAsync());
        }
        var independent = await Save(w, Input(w) with { RepresentativeResidentId = friendId, ResidentIds = [friendId] }); Assert.NotEqual(family.Id, independent.Id);
        await using var check = fixture.Factory.Services.CreateAsyncScope(); var context = check.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var members = await context.Set<ContractResident>().Where(r => r.ContractId == family.Id).ToArrayAsync(); Assert.Single(members, r => r.Role == ResidentType.Representative); Assert.Single(members, r => r.Role == ResidentType.CoOccupant);
        Assert.Equal(RoomStatus.Available, (await context.Set<Room>().FindAsync(w.Room))!.Status);
    }
}
