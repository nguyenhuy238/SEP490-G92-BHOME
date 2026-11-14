using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class MainInitialPayments(BHomePersistenceContext db, ContractService contracts, IContractRepository contractData,
    IMainDraftData drafts, PropertyService prices, IPaymentRepository payments, IPaymentCodeRegistry codes,
    ITransferQrGenerator qr, IMainInitialPaymentLedger orders, SePayOptions sepay, TimeProvider clock) : IMainInitialPayments
{
    public async Task<MainInitialPaymentView> GetAsync(Guid id, bool issueQr, CancellationToken token)
    {
        await contracts.GetAsync(id,token); // Existing role and effective Location assignment.
        if(db is not Compact24DbContext)throw new PaymentException(503,"initial_payment_runtime_unavailable");
        return await payments.TransactionAsync(null,null,async()=>{
            var c=await contractData.FindAsync(id,token) ?? throw new PaymentException(404,"contract_not_found");
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.Room.LocationId.ToString()},0))",token);
            await db.Locked<Room>(c.RoomId).SingleAsync(token);
            if(c.Kind!=ContractKind.Main||c.PreviousContractId is not null)throw new PaymentException(409,"initial_main_contract_required");
            if(!c.InitialPaymentRequired)throw new PaymentException(409,"initial_payment_not_enabled_for_contract");
            var signed=c.SigningMode==ContractSigningModes.Internal ? AnonymousContractSigningService.Complete(c) :
                new[]{c.OwnerSignerId,c.TenantUserId}.All(id=>id is not null&&c.Signatures.Any(s=>s.SignerUserId==id&&s.Status==SignatureStatus.Signed&&s.SnapshotHash==c.SnapshotHash&&!string.IsNullOrWhiteSpace(s.SignedObjectKey)));
            if(!signed||c.Status is not(ContractStatus.PendingActivation or ContractStatus.Active))throw new PaymentException(409,"initial_payment_signatures_required");
            var document=new ContractDocument(c.Id,c.RoomId,c.OwnerSignerId,c.SigningMode==ContractSigningModes.Internal?Guid.Empty:c.TenantUserId??Guid.Empty,c.RepresentativeResidentId,c.Residents.Select(r=>r.ResidentId).Order().ToArray(),c.StartDate,c.EndDate,c.MonthlyRent,c.RequiredDeposit,c.HoldingContractId,c.AppliedHoldingDeposit,c.Terms,""){IsInternalResidentAcceptance=c.SigningMode==ContractSigningModes.Internal};
            if(ContractDocumentSnapshot.Hash(document)!=c.SnapshotHash)throw new PaymentException(409,"signed_terms_changed");
            var order=await orders.ReadAsync(id,token);
            if(order is null){
                var policies=c.DraftMetadata!="{}" ? drafts.Unprotect(c).Charges : (await prices.ResolvePricesAsync(c.RoomId,c.StartDate,token)).Charges;
                var fees=policies.Where(p=>p.Category==ChargeCategory.ServiceFee&&p.Method==ChargingMethod.FixedPerRoomPerMonth)
                    .Select(p=>new MainInitialCharge(p.ChargeCode,p.Name,p.Rate)).OrderBy(p=>p.Code,StringComparer.Ordinal).ToArray();
                if(fees.Any(f=>f.Amount<0||decimal.Truncate(f.Amount)!=f.Amount))throw new PaymentException(409,"initial_charge_invalid_vnd_amount");
                order=new(c.Id,c.Room.LocationId,c.SnapshotHash,c.RequiredDeposit,c.MonthlyRent,fees,clock.GetUtcNow());
                var raw=JsonSerializer.Serialize(order,MainInitialPaymentLedger.Json);
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
                    VALUES({Guid.NewGuid()},'COMMAND',{order.LocationId},{"main-initial:"+id},'Issued',jsonb_build_object('recordType',{MainInitialPaymentLedger.Kind},'state',CAST({raw} AS jsonb)))
                    """,token);
            }
            if(order.SnapshotHash!=c.SnapshotHash)throw new PaymentException(409,"initial_payment_snapshot_changed");
            var deposit=await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Where(a=>a.TargetDepositContractId==id).SumAsync(a=>(decimal?)a.Amount,token)??0;
            var rent=await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Where(a=>a.TargetInitialContractId==id).SumAsync(a=>(decimal?)a.Amount,token)??0;
            if(deposit>order.RequiredDeposit||rent>order.MonthlyRent+order.Charges.Sum(f=>f.Amount))throw new PaymentException(409,"initial_payment_excess_requires_review");
            var outstanding=Math.Max(0,order.RequiredDeposit-deposit)+Math.Max(0,order.MonthlyRent+order.Charges.Sum(f=>f.Amount)-rent);
            var account=await payments.ReceivingAccountAsync(order.LocationId,token);
            var bound=account is not null&&account.Enabled&&account.IsDevelopmentDemo==c.IsDevelopmentDemo&&c.IsDevelopmentDemo==(sepay.Mode=="Test")&&sepay.ReceivingAccounts.Any(a=>a.LocationId==order.LocationId&&a.BankIdentifier==account.BankIdentifier&&a.AccountNumber==account.AccountNumber);
            // IssueAsync joins this transaction; it must not clear tracked state or create nested transactions.
            var reference=issueQr&&outstanding>0&&bound?await codes.IssueAsync("MainInitial",id,order.LocationId,token):await codes.GetAsync("MainInitial",id,token);
            var rendered=issueQr&&bound&&reference is not null&&outstanding>0?qr.Generate(account!.BankIdentifier,account.AccountNumber,outstanding,reference):null;
            return new MainInitialPaymentView(id,outstanding==0?"Settled":!bound?"ReceivingAccountUnavailable":reference is null?"PaymentCodeUnavailable":rendered is null?"InstructionsOnly":"Available",c.Status.ToString(),signed,
                new[]{new MainInitialCharge("RENT","Tiền thuê tháng đầu",order.MonthlyRent)}.Concat(order.Charges).ToArray(),order.RequiredDeposit,c.AppliedHoldingDeposit,deposit,rent,outstanding,outstanding==0,reference,bound?account!.BankIdentifier:null,bound?account!.AccountNumber:null,bound?account!.AccountHolder:null,rendered?.PngDataUri,c.IsDevelopmentDemo);
        },token);
    }
}
