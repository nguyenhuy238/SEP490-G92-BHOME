using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.Operations;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task TaxTrackingSupportsMultipleLocationsAndPreservesFinancialRecords()
    {
        var w = await Seed(); var second = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var profileRoute = $"/api/v1/finance/business-profiles/{Guid.NewGuid()}";
        var input = new LegalBusinessProfileWrite("Synthetic business", "Synthetic subject", "SYN-TAX", null, "Synthetic address", [w.Location, second.Location], Today.AddMonths(-1), null);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PutAsJsonAsync(profileRoute, input)).StatusCode);
        var profile = await Read<SetupDocument>(await owner.PutAsJsonAsync(profileRoute, input));
        var taxRoute = $"/api/v1/finance/tax-obligations/{Guid.NewGuid()}";
        var tax = new TaxObligationWrite(profile.Id, Today.AddDays(-10), Today, "Synthetic declared obligation", Today.AddDays(-1), 100000, 0, null, null, null, "Pending", "Synthetic Owner record");
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync("/api/v1/finance/tax-obligations")).StatusCode);
        var taxResponse = await owner.PutAsJsonAsync(taxRoute, tax);
        Assert.True(taxResponse.IsSuccessStatusCode, string.Join("\n", ApiFactory.Diagnostics.TakeLast(10)));
        var saved = await Read<SetupDocument>(taxResponse);
        Assert.Equal(2, saved.Data.GetProperty("locationIdsSnapshot").GetArrayLength());
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(taxRoute, tax with { PaidAmount = 100000, PaidOn = Today, ExpectedVersion = saved.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(taxRoute, tax with { PeriodFrom = Today.AddDays(-9), ExpectedVersion = saved.Version })).StatusCode);
        var amended = await Read<SetupDocument>(await owner.PutAsJsonAsync(profileRoute, input with { LocationIds = [w.Location], ExpectedVersion = profile.Version }));
        var updated = await Read<SetupDocument>(await owner.PutAsJsonAsync(taxRoute, tax with { Status = "InProgress", ExpectedVersion = saved.Version }));
        Assert.Equal(2, updated.Data.GetProperty("locationIdsSnapshot").GetArrayLength());
        Assert.Equal(saved.Data.GetProperty("referenceRevenue").GetString(), updated.Data.GetProperty("referenceRevenue").GetString());
        Assert.Equal(saved.Data.GetProperty("businessProfileVersion").GetInt32(), updated.Data.GetProperty("businessProfileVersion").GetInt32());
        Assert.Equal(2, (await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/finance/tax-obligations/{saved.Id}/versions"))!.Length);
        using var form = new MultipartFormDataContent();
        foreach (var (key, value) in new[] { ("documentType", "TaxReceipt"), ("name", "Synthetic tax receipt"), ("issuedOn", Today.ToString("yyyy-MM-dd")), ("status", "Active"), ("expectedVersion", "0") }) form.Add(new StringContent(value), key);
        var file = new ByteArrayContent("%PDF-1.7\nSynthetic tax fixture\n%%EOF"u8.ToArray()); file.Headers.ContentType = new("application/pdf"); form.Add(file, "file", "fixture.pdf");
        var evidence = await Read<SetupDocument>(await owner.PutAsync($"/api/v1/locations/{w.Location}/legal-records/{Guid.NewGuid()}", form));
        var paid = await Read<SetupDocument>(await owner.PutAsJsonAsync(taxRoute, tax with
        {
            Status = "Recorded",
            PaidAmount = 100000,
            PaidOn = Today,
            EvidenceRecordId = evidence.Id,
            EvidenceVersion = evidence.Version,
            ExpectedVersion = updated.Version
        }));
        Assert.Equal("100000", paid.Data.GetProperty("details").GetProperty("paidAmount").GetString());
        var attention = (await owner.GetFromJsonAsync<LifecycleAttentionView>("/api/v1/owner-attention/lifecycle"))!;
        Assert.NotNull(attention);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/owner-attention/lifecycle")).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(0, await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM expenses WHERE location_id={w.Location} OR location_id={second.Location}").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task PersonalDataRequestsArePrivateVersionedAndDoNotDeleteContractInvoiceOrPayment()
    {
        var w = await Seed(); var other = await Seed();
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenant); using var stranger = await Client(other.Tenant); using var staff = await Client(w.Staff);
        Guid contractId; Guid invoiceId; var paymentId = Guid.NewGuid();
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var resident = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, TenantUserId = w.Tenant.Id, DisplayLabel = "Synthetic privacy subject" };
            db.Add(resident);
            var contract = new Contract
            {
                RoomId = w.Room,
                OwnerSignerId = w.Owner.Id,
                TenantUserId = w.Tenant.Id,
                RepresentativeResidentId = resident.Id,
                StartDate = Today,
                EndDate = Today.AddYears(1),
                Terms = "Synthetic preserved contract"
            };
            db.Add(contract); contractId = contract.Id;
            var invoice = new Invoice
            {
                RoomId = w.Room,
                LocationId = w.Location,
                RepresentativeContractId = contract.Id,
                RepresentativeTenantUserId = w.Tenant.Id,
                BillingPeriod = new(Today.Year, Today.Month, 1),
                ScheduledFinalDate = Today,
                DueDate = Today.AddDays(5),
                CreatedByUserId = w.Owner.Id,
                Recipients = [new InvoiceRecipient { TenantUserId = w.Tenant.Id }]
            };
            db.Add(invoice); invoiceId = invoice.Id;
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
                VALUES({paymentId},'SYNTHETIC','synthetic',{paymentId.ToString()},{paymentId.ToString()},now(),1000,'VND','VERIFIED','MANUAL',{w.Owner.Id},now())
                """);
        }
        var id = Guid.NewGuid(); var input = new PersonalDataRequestCreate("Deletion", "Synthetic request to review personal data retention");
        var route = $"/api/v1/personal-data-requests/{id}";
        var request = await Read<PersonalDataRequestView>(await tenant.PutAsJsonAsync(route, input));
        var replay = await Read<PersonalDataRequestView>(await tenant.PutAsJsonAsync(route, input));
        Assert.Equal(request.Version, replay.Version); Assert.Single(replay.History);
        Assert.DoesNotContain((await stranger.GetFromJsonAsync<OperationsPage<PersonalDataRequestView>>("/api/v1/personal-data-requests"))!.Items, item => item.Id == id);
        var decisionRoute = $"/api/v1/personal-data-requests/{w.Tenant.Id}/{id}/decisions";
        var decision = new PersonalDataRequestDecision(request.Version, "Resolved", "Synthetic retention review completed", "Synthetic record retention requirements preserve financial records");
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(decisionRoute, decision)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.PostAsJsonAsync(decisionRoute, decision)).StatusCode);
        var processed = await Read<PersonalDataRequestView>(await owner.PostAsJsonAsync(decisionRoute, decision));
        Assert.Equal(2, processed.History.Count);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(decisionRoute, decision)).StatusCode);
        await using var verify = fixture.Factory!.Services.CreateAsyncScope();
        var context = verify.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.True(await context.Users.AnyAsync(user => user.Id == w.Tenant.Id));
        Assert.True(await context.Set<Contract>().AnyAsync(contract => contract.Id == contractId));
        Assert.True(await context.Set<Invoice>().AnyAsync(invoice => invoice.Id == invoiceId));
        Assert.Equal(1000, await context.Database.SqlQuery<decimal>($"SELECT amount AS \"Value\" FROM payments WHERE id={paymentId}").SingleAsync());
    }
}
