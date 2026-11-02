using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Ocr;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenCvSharp;

namespace BHome.IntegrationTests.Billing;

[Trait("Category", "Docker")]
public sealed partial class InvoiceApiTests(CaptureFixture fixture) : IClassFixture<CaptureFixture>
{
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private sealed record Actor(Guid Id, HttpClient Client);
    private sealed record Workspace(Actor Owner, Actor Staff, Actor Tenant, Actor OtherTenant, Guid Location, Guid Room, Guid Contract, DateOnly Period);
    private async Task<Actor> User(string role)
    {
        var id = Guid.NewGuid(); var email = id + "@example.invalid";
        const string password = "Synthetic-Billing-Test!123";
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await manager.CreateAsync(new ApplicationUser { Id = id, UserName = email, Email = email }, password)).Succeeded);
            Assert.True((await manager.AddToRoleAsync((await manager.FindByIdAsync(id.ToString()))!, role)).Succeeded);
        }
        var client = fixture.Factory.CreateClient();
        var login = await Success<LoginResult>(await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return new(id, client);
    }
    private static async Task<T> Success<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private async Task<Workspace> Setup()
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff);
        var tenant = await User(Roles.Tenant); var other = await User(Roles.Tenant);
        var period = new DateOnly(Today.Year, Today.Month, 1).AddMonths(-1);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var location = new Location("Synthetic Billing") { ChainId = await db.Set<Chain>().Select(c => c.Id).SingleAsync() };
        var type = new RoomType { LocationId = location.Id, Name = "Synthetic Shared", DefaultCapacity = 2 };
        var room = new Room { LocationId = location.Id, RoomTypeId = type.Id, RoomNumber = "SYNTHETIC-BILL", Capacity = 2, Status = RoomStatus.Occupied };
        var resident = new Resident { RoomId = room.Id, TenantUserId = tenant.Id, OwnerUserId = owner.Id, DisplayLabel = "Synthetic Tenant", VerificationStatus = IdentityVerificationStatus.Verified };
        var second = new Resident { RoomId = room.Id, TenantUserId = other.Id, OwnerUserId = owner.Id, DisplayLabel = "Synthetic Other", VerificationStatus = IdentityVerificationStatus.Verified };
        Contract ContractFor(Resident person) => new()
        {
            RoomId = room.Id,
            OwnerSignerId = owner.Id,
            TenantUserId = person.TenantUserId!.Value,
            RepresentativeResidentId = person.Id,
            Status = ContractStatus.Active,
            StartDate = period.AddMonths(-1),
            EndDate = period.AddMonths(4),
            MonthlyRent = 3000000,
            RequiredDeposit = 0,
            Terms = "SYNTHETIC TEST",
            ActivatedAt = DateTimeOffset.UtcNow,
            ActivatedByUserId = owner.Id,
            Residents = [new ContractResident { ResidentId = person.Id, ResidenceFrom = period.AddMonths(-1), Role = ResidentType.Representative }]
        };
        var contract = ContractFor(resident); var secondContract = ContractFor(second);
        db.AddRange(location, type, room, resident, second, contract, secondContract,
            new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddYears(-1), Today.AddYears(1)));
        foreach (var (category, code, rate) in new[] { (ChargeCategory.Rent, "RENT", 3000000m), (ChargeCategory.Electricity, "ELECTRICITY", 3500m), (ChargeCategory.Water, "WATER", 15000m) })
            db.Add(new BillingPolicy
            {
                LocationId = location.Id,
                Category = category,
                ChargeCode = code,
                Name = "Synthetic " + code,
                Method = category == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered,
                Rate = rate,
                EffectiveFrom = period.AddYears(-1)
            });
        await db.SaveChangesAsync();
        return new(owner, staff, tenant, other, location.Id, room.Id, contract.Id, period);
    }
    private static BillingScheduleWrite Schedule(Workspace w) => new(w.Location, BillingRateDate.PeriodStart, BillingRentSource.RoomPolicy,
        PartialMonthRule.FullMonth, VndRounding.AwayFromZero, 1, 0, 1, 1, 10, 1, 0);
    private async Task<InvoiceView> Draft(Workspace w)
    {
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w)));
        return await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract)));
    }

    private async Task ConfirmUtilities(Workspace w)
    {
        foreach (var utility in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var meter = await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meters", new MeterInput(w.Room,
                "SYNTHETIC-" + utility, utility, MeterDisplay.Digital, 2, w.Period.AddMonths(-1))));
            foreach (var purpose in new[] { ReadingPurpose.Initial, ReadingPurpose.Periodic })
            {
                var date = purpose == ReadingPurpose.Initial ? w.Period.AddDays(-1) : w.Period.AddMonths(1).AddDays(-1);
                var task = await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(meter.Id, purpose, date, purpose == ReadingPurpose.Periodic ? w.Period : null)));
                using var image = new Mat(120, 300, MatType.CV_8UC3, Scalar.White);
                Cv2.PutText(image, "SYNTHETIC 125.5", new(10, 70), HersheyFonts.HersheySimplex, .6, Scalar.Black, 1);
                using var content = new ByteArrayContent(image.ImEncode(".png")); content.Headers.ContentType = new("image/png");
                var evidence = await Success<IdResult>(await w.Staff.Client.PutAsync($"/api/v1/capture/meter-tasks/{task.Id}/evidence", content));
                await Success<ConfirmedReading>(await w.Staff.Client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task.Id}/confirm", new MeterConfirmation(true,
                    purpose == ReadingPurpose.Initial ? 100 : utility == UtilityType.Electricity ? 125.5m : 102m, evidence.Id)));
            }
        }
    }

    [Fact]
    public async Task FinalizationRequiresReviewedConfirmedDataIsConcurrentSafeImmutableAndHistoricallyScoped()
    {
        var w = await Setup(); var draft = await Draft(w);
        var path = $"/api/v1/invoices/{draft.Id}";
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync(path + "/finalize", new InvoiceFinalizeInput(draft.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.PostAsJsonAsync(path + "/finalize", new InvoiceFinalizeInput(draft.Version))).StatusCode);
        await ConfirmUtilities(w);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync(path + "/finalize", new InvoiceFinalizeInput(draft.Version))).StatusCode);
        var ready = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync(path + "/refresh", new InvoiceFinalizeInput(draft.Version)));
        Assert.Empty(ready.MissingInputs); Assert.Equal(3119250m, ready.Total);
        Assert.Equal(25.5m, ready.Lines.Single(l => l.Category == "Electricity").Quantity);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync(path + "/finalize", new InvoiceFinalizeInput(draft.Version))).StatusCode);
        var finals = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => w.Owner.Client.PostAsJsonAsync(path + "/finalize", new InvoiceFinalizeInput(ready.Version))));
        foreach (var response in finals)
        {
            var result = await Success<InvoiceView>(response); Assert.Equal("Final", result.Status); Assert.Equal(ready.Total, result.Total);
        }
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync(path + "/refresh", new InvoiceFinalizeInput(ready.Version + 1))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == draft.Id && a.Event == "InvoiceFinalized"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Invoices\" SET \"Total\" = 1 WHERE \"Id\" = {draft.Id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"InvoiceLines\" SET \"Amount\" = 1 WHERE \"InvoiceId\" = {draft.Id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"InvoiceRecipients\" WHERE \"InvoiceId\" = {draft.Id}"));
        // Terminating tenancy does not revoke access to the bill for the period actually occupied.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Contracts\" SET \"Status\" = 4, \"ActualEndDate\" = {Today} WHERE \"RoomId\" = {w.Room}");
        Assert.Equal(HttpStatusCode.OK, (await w.OtherTenant.Client.GetAsync(path)).StatusCode);
        var newcomer = await User(Roles.Tenant);
        Assert.Equal(HttpStatusCode.NotFound, (await newcomer.Client.GetAsync(path)).StatusCode);
        var body = await w.Tenant.Client.GetStringAsync(path);
        Assert.DoesNotContain("Paid", body); Assert.DoesNotContain("objectKey", body);
    }

    [Fact]
    public async Task SharedRoomDraftIsPersistedIdempotentScopedAndExplicitlyMissingReadings()
    {
        var w = await Setup(); var invoice = await Draft(w);
        var policyJson = await w.Owner.Client.GetStringAsync($"/api/v1/billing-policies?locationId={w.Location}");
        Assert.Contains("\"rate\":\"", policyJson);
        Assert.Equal("Draft", invoice.Status); Assert.Equal(3000000m, invoice.Total);
        Assert.Contains("confirmed_reading_Electricity", invoice.MissingInputs); Assert.Contains("confirmed_reading_Water", invoice.MissingInputs);
        var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract))));
        foreach (var reply in replies) Assert.Equal(invoice.Id, (await Success<InvoiceView>(reply)).Id);
        foreach (var tenant in new[] { w.Tenant, w.OtherTenant })
            Assert.Equal(invoice.Id, (await Success<InvoiceView>(await tenant.Client.GetAsync($"/api/v1/invoices/{invoice.Id}"))).Id);
        var outsider = await User(Roles.Tenant);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/v1/invoices/{invoice.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync($"/api/v1/invoices/{invoice.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<Invoice>().CountAsync(i => i.RoomId == w.Room));
        Assert.Equal(2, await db.Set<InvoiceRecipient>().CountAsync(i => i.InvoiceId == invoice.Id));
        Assert.NotNull((await db.Set<BillingPolicy>().SingleAsync(p => p.LocationId == w.Location && p.Category == ChargeCategory.Rent)).FirstUsedAt);
        Assert.Equal(2, await db.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
    }

    [Fact]
    public async Task ScheduleRequiresOwnerAndValidDatesAndStaleVersionsConflict()
    {
        var w = await Setup();
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w) with { FinalDay = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w) with { DueMonthOffset = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w))).StatusCode);
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w)));
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w))).StatusCode);
    }

    [Fact]
    public async Task SharedTenancyDatabaseGuardRejectsOverCapacityAndDuplicateTenant()
    {
        var w = await Setup();
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var existing = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == w.Contract);
        var duplicate = new Contract
        {
            RoomId = w.Room,
            OwnerSignerId = existing.OwnerSignerId,
            TenantUserId = existing.TenantUserId,
            RepresentativeResidentId = existing.RepresentativeResidentId,
            StartDate = existing.StartDate,
            EndDate = existing.EndDate,
            MonthlyRent = existing.MonthlyRent,
            RequiredDeposit = 0,
            Status = ContractStatus.Active,
            ActivatedAt = DateTimeOffset.UtcNow,
            ActivatedByUserId = existing.OwnerSignerId
        };
        db.Add(duplicate);
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23514", Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }
}
