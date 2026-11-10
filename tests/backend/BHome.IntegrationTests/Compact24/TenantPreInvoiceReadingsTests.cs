using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.LocalDevelopment;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

public sealed class TenantPreInvoiceReadingsTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    [CompactPostgresFact]
    public async Task ConfirmedReadingsAndPrivateEvidenceReachAllRoomTenantsBeforeDraftAndRemainHistoricalWithNoCrossRoomLeak()
    {
        var factory = fixture.Capture.Factory;
        await Compact24SampleSeed.RunAsync(factory.Services, "Development", WorkflowTestUsers.Password);
        async Task<HttpClient> Login(string email)
        {
            var client = factory.CreateClient();
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password });
            login.EnsureSuccessStatusCode(); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
            return client;
        }
        Guid contractId, familyId; var familyEmail = $"family-{Guid.NewGuid():N}@example.invalid";
        Guid noticeId;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            familyId = (await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { UserName = familyEmail, Email = familyEmail }, "Tenant", WorkflowTestUsers.Password)).Id;
            var family = new Resident
            {
                RoomId = Compact24SampleSeed.Id(40),
                TenantUserId = familyId,
                OwnerUserId = Compact24SampleSeed.Id(1),
                DisplayLabel = "Synthetic family",
                ContactEmail = familyEmail,
                ResidentType = ResidentType.CoOccupant,
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            var c = new Contract
            {
                RoomId = family.RoomId,
                OwnerSignerId = Compact24SampleSeed.Id(1),
                TenantUserId = Compact24SampleSeed.Id(3),
                RepresentativeResidentId = Compact24SampleSeed.Id(100),
                StartDate = Today.AddDays(-10),
                EndDate = Today.AddMonths(6),
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = Compact24SampleSeed.Id(1),
                Status = ContractStatus.Active,
                MonthlyRent = 3000000,
                Terms = "Synthetic active occupancy fixture"
            };
            c.Residents.Add(new() { ContractId = c.Id, ResidentId = c.RepresentativeResidentId, ResidenceFrom = c.StartDate });
            c.Residents.Add(new() { ContractId = c.Id, ResidentId = family.Id, ResidenceFrom = c.StartDate, Role = ResidentType.CoOccupant });
            db.AddRange(family, c);
            var initialTask = await db.Set<OperationalTask>().SingleAsync(x => x.Id == Compact24SampleSeed.Id(110));
            initialTask.ReadingDate = Today.AddDays(-2);
            (await db.Set<Meter>().SingleAsync(x => x.Id == Compact24SampleSeed.Id(60))).DecimalPlaces = 1;
            await db.SaveChangesAsync(); contractId = c.Id;
        }
        using var tenant = await Login("tenant.sample@example.invalid");
        using var familyClient = await Login(familyEmail);
        using var outside = await Login("tenant.other.sample@example.invalid");
        using var owner = await Login("owner.sample@example.invalid");
        using var staff = await Login("staff.sample@example.invalid");
        const string route = "/api/v1/tenant/meter-readings";
        var firstResponse = await tenant.GetAsync(route);
        Assert.True(firstResponse.IsSuccessStatusCode, string.Join("\n", Compact24WorkflowFixture.Diagnostics.TakeLast(1)));
        var before = await firstResponse.Content.ReadFromJsonAsync<TenantMeterReadingPage>(); Assert.Empty(before!.Items);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.GetAsync(route)).StatusCode);
        async Task<Guid> Confirm(Guid task, decimal value)
        {
            using var image = new Mat(120, 300, MatType.CV_8UC3, Scalar.White);
            Cv2.PutText(image, value.ToString(System.Globalization.CultureInfo.InvariantCulture), new(10, 70), HersheyFonts.HersheySimplex, 1, Scalar.Black, 2);
            using var photo = new ByteArrayContent(image.ImEncode(".png")); photo.Headers.ContentType = new("image/png");
            var upload = await staff.PutAsync($"/api/v1/capture/meter-tasks/{task}/evidence", photo); upload.EnsureSuccessStatusCode();
            var evidence = (await upload.Content.ReadFromJsonAsync<IdResult>())!.Id;
            var confirmed = await staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task}/confirm", new MeterConfirmation(true, value, evidence));
            Assert.True(confirmed.IsSuccessStatusCode, await confirmed.Content.ReadAsStringAsync());
            return (await confirmed.Content.ReadFromJsonAsync<ConfirmedReading>())!.Id;
        }
        await Confirm(Compact24SampleSeed.Id(110), 100);
        var period = new DateOnly(Today.Year, Today.Month, 1);
        var created = await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(Compact24SampleSeed.Id(60), ReadingPurpose.Periodic, Today, period));
        created.EnsureSuccessStatusCode(); var taskId = (await created.Content.ReadFromJsonAsync<IdResult>())!.Id;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var task = await db.Set<OperationalTask>().SingleAsync(x => x.Id == taskId);
            task.OcrProposedValue = 999; await db.SaveChangesAsync();
        }
        Assert.Single((await tenant.GetFromJsonAsync<TenantMeterReadingPage>(route))!.Items);
        var readingId = await Confirm(taskId, 125.5m);
        var visible = await tenant.GetFromJsonAsync<TenantMeterReadingPage>(route + "?page=1&pageSize=1");
        Assert.Equal(2, visible!.TotalCount);
        var newest = Assert.Single(visible.Items); Assert.Equal(readingId, newest.Id); Assert.Equal(100, newest.PreviousValue); Assert.Equal(25.5m, newest.Consumption);
        Assert.Equal(125.5m, newest.ConfirmedValue);
        Assert.Equal(2, (await familyClient.GetFromJsonAsync<TenantMeterReadingPage>(route))!.TotalCount);
        Assert.Empty((await outside.GetFromJsonAsync<TenantMeterReadingPage>(route))!.Items);
        Assert.Equal(0, (await tenant.GetFromJsonAsync<TenantMeterReadingPage>(route + "?roomId=" + Compact24SampleSeed.Id(43)))!.TotalCount);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.GetAsync(route + "/" + readingId + "/evidence")).StatusCode);
        var evidenceFile = await tenant.GetAsync(route + "/" + readingId + "/evidence"); evidenceFile.EnsureSuccessStatusCode();
        Assert.Equal("image/png", evidenceFile.Content.Headers.ContentType!.MediaType);
        var payload = await (await tenant.GetAsync(route)).Content.ReadAsStringAsync();
        Assert.DoesNotContain("ocr", payload, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("objectKey", payload);
        Assert.Equal(HttpStatusCode.BadRequest, (await tenant.GetAsync(route + "?pageSize=101")).StatusCode);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(0, await db.Set<Invoice>().CountAsync());
            await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);
            await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);
            var notices = await db.Set<BHome.Domain.Notifications.UserNotification>().Where(n => n.EventType == "METER_READING_CONFIRMED" && n.RelatedObjectId == readingId).ToArrayAsync();
            Assert.Equal(2, notices.Length); Assert.All(notices, n => Assert.Contains("EMAIL", n.Channels));
            noticeId = notices.Single(n => n.RecipientUserId == Compact24SampleSeed.Id(3)).Id;
            var c = await db.Set<Contract>().Include(x => x.Residents).SingleAsync(x => x.Id == contractId);
            c.Status = ContractStatus.Terminated; c.ActualEndDate = Today;
            foreach (var cr in c.Residents) cr.ResidenceTo = Today;
            await db.SaveChangesAsync();
        }
        Assert.Equal(2, (await tenant.GetFromJsonAsync<TenantMeterReadingPage>(route))!.TotalCount);
        (await tenant.GetAsync(route + "/" + readingId + "/evidence")).EnsureSuccessStatusCode();
        var target = await tenant.GetFromJsonAsync<NotificationTarget>($"/api/v1/notifications/{noticeId}/target");
        Assert.Equal("MeterReading", target!.ObjectType);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.GetAsync($"/api/v1/notifications/{noticeId}/target")).StatusCode);
    }
}
