using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.PaymentsDebt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category","CompactPostgres")]
public sealed class Compact24FinanceLedgerTests
{
    [CompactPostgresFact]
    public async Task ReportsFinalInvoicesAndVerifiedAllocationsWithoutCountingUnallocatedOrSimulatedTransfers()
    {
        var fixture=new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            await new PaymentLedgerTests(fixture.Capture).FullPaymentIsAtomicIdempotentSharedAndDoesNotMutateFinalInvoice();
            string email;
            await using(var scope=fixture.Capture.Factory.Services.CreateAsyncScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
                var owner=await db.Users.SingleAsync(u=>EF.Property<string[]>(u,"roles").Contains("Owner")); email=owner.Email!;
                // Verified, unallocated cash and explicitly simulated receipts must never become revenue.
                foreach(var demo in new[]{false,true}) db.Add(new PaymentTransfer {
                    ProviderIdentity="SyntheticFinance",BankReference=Guid.NewGuid().ToString(),NormalizedReference=Guid.NewGuid().ToString(),
                    Amount=9000000,Currency="VND",OccurredAt=DateTimeOffset.UtcNow,VerifiedAt=DateTimeOffset.UtcNow,
                    VerifiedByUserId=owner.Id,IsDevelopmentDemo=demo,StatementReference="Synthetic",VerificationReason="Synthetic test"
                });
                await db.SaveChangesAsync();
            }
            using var client=fixture.Capture.Factory.CreateClient();
            var login=await client.PostAsJsonAsync("/api/v1/auth/login",new{email,password="Synthetic-Payment-Test!123"});login.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Authorization=new("Bearer",(await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
            var response=await client.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31");
            Assert.True(response.IsSuccessStatusCode,await response.Content.ReadAsStringAsync());
            var report=(await response.Content.ReadFromJsonAsync<FinancialReport>())!;
            Assert.Equal("100000",report.Total.Issued); Assert.Equal("100000",report.Total.VerifiedCollections);
            Assert.Equal("0",report.Total.OutstandingNow); Assert.Equal(1,report.Total.TotalRooms);Assert.Equal(1,report.Total.OccupiedRooms);
            Assert.Equal("100000",report.Total.OperatingProfit);Assert.Null(report.Capital.EstimatedRemainingMonths);
        }
        finally{await fixture.DisposeAsync();}
    }
}
