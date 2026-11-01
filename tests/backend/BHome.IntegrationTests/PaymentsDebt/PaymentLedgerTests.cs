using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Ocr;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.PaymentsDebt;

[Trait("Category", "Docker")]
public sealed class PaymentLedgerTests(CaptureFixture fixture) : IClassFixture<CaptureFixture>
{
    private sealed class User(Guid id, string role) : ICurrentUser
    { public Guid? UserId => id; public bool IsInRole(string name) => name == role; }
    private sealed record Workspace(Guid Owner, Guid Staff, Guid[] Tenants, Guid Invoice, Guid Contract, Guid Room, Guid Location);
    private async Task<T> As<T>(Guid actor, string role, Func<PaymentService, Task<T>> work)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        return await work(new PaymentService(scope.ServiceProvider.GetRequiredService<IPaymentRepository>(), new User(actor, role), TimeProvider.System));
    }
    private async Task<Workspace> Setup()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        async Task<Guid> Account(string role)
        {
            var email = Guid.NewGuid() + "@example.invalid";
            var account = new ApplicationUser { UserName = email, Email = email };
            Assert.True((await manager.CreateAsync(account, "Synthetic-Payment-Test!123")).Succeeded);
            Assert.True((await manager.AddToRoleAsync(account, role)).Succeeded); return account.Id;
        }
        var owner = await Account(Roles.Owner); var staff = await Account(Roles.Staff);
        var tenants = new[] { await Account(Roles.Tenant), await Account(Roles.Tenant), await Account(Roles.Tenant) };
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow,"Asia/Ho_Chi_Minh").DateTime);
        var period = new DateOnly(today.Year,today.Month,1).AddMonths(-1);
        var location = new Location("SYNTHETIC PAYMENT") { ChainId = await db.Set<Chain>().Select(c => c.Id).SingleAsync() };
        var type = new RoomType { LocationId = location.Id, Name = "Shared", DefaultCapacity = 3 };
        var room = new Room { LocationId = location.Id, RoomTypeId = type.Id, RoomNumber = "PAY-TEST", Capacity = 3, Status = RoomStatus.Occupied };
        db.AddRange(location,type,room);
        var contracts = new List<Contract>();
        foreach(var tenant in tenants)
        {
            var resident = new Resident { RoomId = room.Id, TenantUserId = tenant, OwnerUserId = owner, DisplayLabel = "SYNTHETIC TENANT", VerificationStatus = IdentityVerificationStatus.Verified };
            var contract = new Contract { RoomId = room.Id, OwnerSignerId = owner, TenantUserId = tenant, RepresentativeResidentId = resident.Id,
                StartDate = period.AddMonths(-1), EndDate = period.AddMonths(12), MonthlyRent = 100000, RequiredDeposit = 0, Status = ContractStatus.Active,
                ActivatedAt = DateTimeOffset.UtcNow, ActivatedByUserId = owner, Terms = "SYNTHETIC TEST",
                Residents = [new ContractResident { ResidentId = resident.Id, ResidenceFrom = period.AddMonths(-1), Role = ResidentType.Representative }] };
            db.AddRange(resident,contract); contracts.Add(contract);
        }
        var invoice = new Invoice { RoomId = room.Id, LocationId = location.Id, RoomNumber = room.RoomNumber, LocationName = location.Name,
            BillingPeriod = period, RepresentativeContractId = contracts[0].Id, RepresentativeTenantUserId = tenants[0], Total = 100000,
            CreatedByUserId = owner, ScheduledFinalDate = period, DueDate = today.AddDays(-1), ScheduleSnapshot = "{}",
            Lines = [new InvoiceLine { Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent", Rate = 100000, Quantity = 1, Amount = 100000,
                OccupiedDays = 30, PeriodDays = 30, RateDate = period }], Recipients = tenants.Select(t => new InvoiceRecipient { TenantUserId = t }).ToList() };
        db.Add(invoice); await db.SaveChangesAsync();
        invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = owner; invoice.FinalizedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(); return new(owner,staff,tenants,invoice.Id,contracts[0].Id,room.Id,location.Id);
    }
    private static PaymentTransferInput Input(Workspace w, decimal amount=100000, string? reference=null, string? memo=null) =>
        new("SYNTHETIC-BANK",reference ?? "SYNTHETIC-"+Guid.NewGuid(),amount,"VND",PaymentRules.Timestamp(DateTimeOffset.UtcNow.AddSeconds(-2)),
            memo ?? PaymentRules.InvoiceReference(w.Invoice),"SYNTHETIC-STATEMENT","Owner checked synthetic bank statement",w.Invoice,true);

    [Fact]
    public async Task FullPaymentIsAtomicIdempotentSharedAndDoesNotMutateFinalInvoice()
    {
        var w=await Setup(); var input=Input(w); var key=Guid.NewGuid();
        var transfer=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(input,key,default));
        Assert.Equal(transfer.Id,(await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(input,key,default))).Id);
        var results=await Task.WhenAll(Enumerable.Range(0,3).Select(_=>As(w.Owner,Roles.Owner,s=>s.AllocateAsync(transfer.Id,new(w.Invoice,w.Tenants[0],true),Guid.NewGuid(),default))));
        Assert.All(results,result=>Assert.Equal("Allocated",result.Status));
        foreach(var tenant in w.Tenants)
        {
            var state=await As(tenant,Roles.Tenant,s=>s.InvoicePaymentAsync(w.Invoice,default));
            Assert.Equal("Paid",state.PaymentStatus); Assert.Equal(0,state.OutstandingAmount); Assert.Equal(100000,state.PaidAmount);
            Assert.Equal(tenant==w.Tenants[0]?"Bạn":"Khách thuê khác trong hóa đơn",Assert.Single(state.History).PaidBy);
            Assert.Null(state.History[0].PaidByUserId);
        }
        await using var scope=fixture.Factory.Services.CreateAsyncScope(); var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var invoice=await db.Set<Invoice>().SingleAsync(i=>i.Id==w.Invoice);
        Assert.Equal(InvoiceStatus.Final,invoice.Status); Assert.Equal(100000,invoice.Total); Assert.Equal(1,invoice.Version);
        Assert.Equal(1,await db.Set<PaymentAllocation>().CountAsync(a=>a.InvoiceId==w.Invoice));
        Assert.Equal(1,await db.Set<PaymentConfirmedEvent>().CountAsync(e=>e.InvoiceId==w.Invoice));
        await Assert.ThrowsAsync<PostgresException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"PaymentAllocations\" SET \"Amount\" = 1 WHERE \"InvoiceId\" = {w.Invoice}"));
        await Assert.ThrowsAsync<PostgresException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Invoices\" SET \"Total\" = 1 WHERE \"Id\" = {w.Invoice}"));
    }
    [Fact]
    public async Task ConcurrentTenantsCannotDoubleSettleAndSecondTransferIsPreservedForReview()
    {
        var w=await Setup();
        var a=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(Input(w),Guid.NewGuid(),default));
        var b=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(Input(w),Guid.NewGuid(),default));
        var replies=await Task.WhenAll(new[]{(a,w.Tenants[0]),(b,w.Tenants[1])}.Select(pair=>As(w.Owner,Roles.Owner,s=>s.AllocateAsync(pair.Item1.Id,new(w.Invoice,pair.Item2,true),Guid.NewGuid(),default))));
        Assert.Single(replies,r=>r.Status=="Allocated"); Assert.Equal("invoice_already_settled",Assert.Single(replies,r=>r.Status=="PendingReview").Reason);
        Assert.Equal("Paid",(await As(w.Tenants[2],Roles.Tenant,s=>s.InvoicePaymentAsync(w.Invoice,default))).PaymentStatus);
        await using var scope=fixture.Factory.Services.CreateAsyncScope(); var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(2,await db.Set<PaymentTransfer>().CountAsync(p=>p.ProposedInvoiceId==w.Invoice));
        Assert.Equal(1,await db.Set<PaymentAllocation>().CountAsync(p=>p.InvoiceId==w.Invoice));
    }
    [Theory]
    [InlineData(99999,"partial_payment_policy_required")]
    [InlineData(100001,"excess_payment_policy_required")]
    public async Task AmountMismatchDoesNotInventPartialOrRefundPolicy(decimal amount,string reason)
    {
        var w=await Setup(); var transfer=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(Input(w,amount),Guid.NewGuid(),default));
        Assert.Equal(reason,(await As(w.Owner,Roles.Owner,s=>s.AllocateAsync(transfer.Id,new(w.Invoice,null,true),Guid.NewGuid(),default))).Reason);
        var view=await As(w.Tenants[0],Roles.Tenant,s=>s.InvoicePaymentAsync(w.Invoice,default));
        Assert.Equal("Unpaid",view.PaymentStatus); Assert.Equal(100000,view.OutstandingAmount); Assert.True(view.PendingReview);
    }
    [Fact]
    public async Task DepositReferenceCannotCreditInvoiceAndPaidInvoiceReferenceCannotCreditDeposit()
    {
        var w=await Setup(); var input=Input(w);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            db.Add(new DepositVerification { ContractId=w.Contract,Amount=100000,BankTransactionReference=input.BankReference,VerificationReason="SYNTHETIC",VerifiedByUserId=w.Owner,VerifiedAt=DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }
        var reused=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(input,Guid.NewGuid(),default));
        Assert.Equal("bank_reference_already_credited",(await As(w.Owner,Roles.Owner,s=>s.AllocateAsync(reused.Id,new(w.Invoice,w.Tenants[0],true),Guid.NewGuid(),default))).Reason);
        var freshInput=Input(w); var fresh=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(freshInput,Guid.NewGuid(),default));
        await As(w.Owner,Roles.Owner,s=>s.AllocateAsync(fresh.Id,new(w.Invoice,w.Tenants[0],true),Guid.NewGuid(),default));
        await using var verification=fixture.Factory.Services.CreateAsyncScope(); var verifyDb=verification.ServiceProvider.GetRequiredService<BHomeDbContext>();
        verifyDb.Add(new DepositVerification {ContractId=w.Contract,Amount=100000,BankTransactionReference=freshInput.BankReference.ToLowerInvariant(),VerificationReason="SYNTHETIC",VerifiedByUserId=w.Owner,VerifiedAt=DateTimeOffset.UtcNow});
        var error=await Assert.ThrowsAsync<DbUpdateException>(()=>verifyDb.SaveChangesAsync());
        Assert.Equal("23505",Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }
    [Fact]
    public async Task UnauthorizedAndInvalidOrConflictingInputsCannotCreatePaidState()
    {
        var w=await Setup(); var input=Input(w); var key=Guid.NewGuid();
        Assert.Equal(403,(await Assert.ThrowsAsync<PaymentException>(()=>As(w.Tenants[0],Roles.Tenant,s=>s.RegisterAsync(input,key,default)))).Status);
        Assert.Equal(403,(await Assert.ThrowsAsync<PaymentException>(()=>As(w.Staff,Roles.Staff,s=>s.InvoicePaymentAsync(w.Invoice,default)))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<PaymentException>(()=>As(w.Owner,Roles.Owner,s=>s.RegisterAsync(input with{HumanVerified=false},key,default)))).Status);
        var transfer=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(input,key,default));
        Assert.Equal(409,(await Assert.ThrowsAsync<PaymentException>(()=>As(w.Owner,Roles.Owner,s=>s.RegisterAsync(input with{Amount=1},key,default)))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<PaymentException>(()=>As(w.Owner,Roles.Owner,s=>s.AllocateAsync(transfer.Id,new(w.Invoice,w.Owner,true),Guid.NewGuid(),default)))).Status);
        var outside=await Setup();
        Assert.Equal(404,(await Assert.ThrowsAsync<PaymentException>(()=>As(outside.Tenants[0],Roles.Tenant,s=>s.InvoicePaymentAsync(w.Invoice,default)))).Status);
    }
}
