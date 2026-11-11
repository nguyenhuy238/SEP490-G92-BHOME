using System.Net;
using BHome.Application.Contracts;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    internal async Task DamageAboveDepositRemainsRoomDebtWithSeparateCanonicalOffsets()
    {
        var (w, proof, _) = await DamageFixture(true);
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var root = $"/api/v1/contracts/{w.Contract}"; var route = root + "/move-out/receivables";
        var originalInvoice = await owner.GetStringAsync($"/api/v1/invoices/{w.Invoice}");
        var view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        Assert.Equal(400000, view.AvailableDeposit); Assert.Empty(view.Receivables);
        Guid inspectionId; int inspectionVersion; int originalInvoiceCount; Guid outsiderId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var inspection = await db.Set<BHome.Domain.TenantContracts.ContractFinalInspection>().SingleAsync(i => i.ContractId == w.Contract);
            inspectionId = inspection.Id; inspectionVersion = inspection.Version;
            originalInvoiceCount = await db.Set<BHome.Domain.Billing.Invoice>().CountAsync(i => i.RoomId == w.Room);
            outsiderId = (await BHome.IntegrationTests.Compact24.WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { UserName = Guid.NewGuid() + "@example.invalid", Email = Guid.NewGuid() + "@example.invalid" },
                BHome.Domain.IdentityAccess.Roles.Tenant, BHome.IntegrationTests.Compact24.WorkflowTestUsers.Password)).Id;
            // A replacement arrives on the same calendar day, after the final inspection.
            // Capacity remains three; the replacement must never inherit this damage debt.
            var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(inspection.InspectedAt, "Asia/Ho_Chi_Minh").DateTime);
            var departed = await db.Set<BHome.Domain.TenantContracts.Contract>().SingleAsync(c => c.RoomId == w.Room && c.TenantUserId == w.Tenants[1]);
            departed.Status = BHome.Domain.TenantContracts.ContractStatus.Terminated; departed.ActualEndDate = date.AddDays(-1);
            var departedMember = await db.Set<BHome.Domain.TenantContracts.ContractResident>().SingleAsync(cr => cr.ContractId == departed.Id);
            departedMember.ResidenceTo = date.AddDays(-1);
            (await db.Set<BHome.Domain.TenantContracts.Resident>().SingleAsync(r => r.TenantUserId == w.Tenants[1])).RoomId = null;
            var newcomer = new BHome.Domain.TenantContracts.Resident { RoomId = w.Room, TenantUserId = outsiderId, OwnerUserId = w.Owner, DisplayLabel = "Synthetic new occupant" };
            db.AddRange(newcomer, new BHome.Domain.TenantContracts.Contract { RoomId = w.Room, TenantUserId = outsiderId, OwnerSignerId = w.Owner,
                RepresentativeResidentId = newcomer.Id, StartDate = date, EndDate = date.AddMonths(1), Terms = "Synthetic replacement tenancy",
                Status = BHome.Domain.TenantContracts.ContractStatus.Active, ActivatedAt = DateTimeOffset.UtcNow, ActivatedByUserId = w.Owner,
                Residents = [new BHome.Domain.TenantContracts.ContractResident { ResidentId = newcomer.Id, Role = BHome.Domain.TenantContracts.ResidentType.Representative, ResidenceFrom = date }] });
            await db.SaveChangesAsync();
        }
        using var outsider = await Client(outsiderId);
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        var input = new DamageChargeInput(view.Reference, inspectionId, inspectionVersion, null, 600000,
            "Synthetic damage exceeding the security deposit", [proof], true);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, route + "/damage", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, route + "/damage", input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, route + "/damage", input with { EvidenceIds = [Guid.NewGuid()] })).StatusCode);
        var key = Guid.NewGuid();
        var competing = await Task.WhenAll(Post(owner, route + "/damage", input, key), Post(owner, route + "/damage", input, key));
        var charge = await RefundValue<SettlementReceivable>(competing[0]);
        Assert.Equal(charge.Id, (await RefundValue<SettlementReceivable>(competing[1])).Id);
        Assert.Equal(600000, charge.Amount); Assert.NotEmpty(charge.RecipientUserIds); Assert.Single(charge.Evidence);
        Assert.DoesNotContain(outsiderId, charge.RecipientUserIds); Assert.DoesNotContain(w.Tenants[1], charge.RecipientUserIds);
        using var coTenant = await Client(w.Tenants[2]);
        Assert.Equal(600000, Assert.Single((await RefundValue<SettlementReceivablesView>(await coTenant.GetAsync(route))).Receivables).Outstanding);
        Assert.Single((await RefundValue<SettlementReceivablePage>(await coTenant.GetAsync("/api/v1/tenant/settlement-receivables"))).Items);
        Assert.Empty((await RefundValue<SettlementReceivablePage>(await outsider.GetAsync("/api/v1/tenant/settlement-receivables"))).Items);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/damage", input with { Amount = 600001 }, key)).StatusCode);
        view = await RefundValue<SettlementReceivablesView>(await tenant.GetAsync(route));
        Assert.Equal(600000, Assert.Single(view.Receivables).Outstanding);
        Assert.Empty(view.Receivables[0].Charge.RecipientUserIds);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/damage", input with { ExpectedReference = view.Reference })).StatusCode);
        var offset = new DepositOffsetInput(view.Reference, charge.Id, null, 250000, "Synthetic source-specific Owner offset", true);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, route + "/deposit-offsets", offset)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/deposit-offsets", offset with { Amount = 400001 })).StatusCode);
        key = Guid.NewGuid();
        var first = await RefundValue<DepositOffsetApproval>(await Post(owner, route + "/deposit-offsets", offset, key));
        Assert.Equal(first.Id, (await RefundValue<DepositOffsetApproval>(await Post(owner, route + "/deposit-offsets", offset, key))).Id);
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        Assert.Equal(150000, view.AvailableDeposit); Assert.Equal(350000, Assert.Single(view.Receivables).Outstanding);
        offset = offset with { ExpectedReference = view.Reference, Amount = 150000 };
        competing = await Task.WhenAll(Post(owner, route + "/deposit-offsets", offset), Post(owner, route + "/deposit-offsets", offset));
        Assert.Single(competing, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(competing, r => r.StatusCode == HttpStatusCode.Conflict);
        view = await RefundValue<SettlementReceivablesView>(await tenant.GetAsync(route));
        Assert.Equal(0, view.AvailableDeposit); Assert.Equal(200000, Assert.Single(view.Receivables).Outstanding);
        Assert.Equal("PartiallyPaid", view.Receivables[0].Status); Assert.Equal(2, view.Offsets.Count);
        Assert.Equal(originalInvoice, await owner.GetStringAsync($"/api/v1/invoices/{w.Invoice}"));
        // Physical closure preserves the debt and historical access, independently of its payment.
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await RefundValue<ContractView>(await Post(owner, root + "/move-out/complete", new CompletionInput(today)));
        var historical = await RefundValue<SettlementReceivablesView>(await tenant.GetAsync(route));
        Assert.Equal(200000, historical.Receivables[0].Outstanding);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope();
        var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var allocations = await finalDb.Set<PaymentAllocation>().Where(a => a.SettlementReceivableId == charge.Id).ToArrayAsync();
        Assert.Equal(2, allocations.Length); Assert.Equal(400000, allocations.Sum(a => a.Amount));
        Assert.All(allocations, a => { Assert.Null(a.PaidByUserId); Assert.NotNull(a.DepositOffsetApprovalId); Assert.Equal(w.Contract, a.SourceDepositContractId); });
        Assert.Equal(3, await finalDb.SecurityAudit.CountAsync(a => a.TargetType == "SettlementReceivableV1" || a.TargetType == "DepositOffsetApprovalV1"));
        Assert.Equal(originalInvoiceCount, await finalDb.Set<BHome.Domain.Billing.Invoice>().CountAsync(i => i.RoomId == w.Room));
        var report = await RefundValue<BHome.Application.Finance.FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&roomId={w.Room}"));
        Assert.Equal("600000", report.SettlementSources!.ApprovedCharges); Assert.Equal("200000", report.SettlementSources.OutstandingNow);
        Assert.Equal("400000", report.SettlementSources.DepositOffsetsApplied); Assert.Equal("0", report.SettlementSources.VerifiedBankCollections);
        Assert.Equal("200000", report.Total.OutstandingNow); Assert.Equal("800000", report.Total.Issued);
        var priorReport = await RefundValue<BHome.Application.Finance.FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to={today.AddDays(-1):yyyy-MM-dd}&roomId={w.Room}"));
        Assert.Equal("0", priorReport.SettlementSources!.ApprovedCharges); Assert.Equal("0", priorReport.SettlementSources.DepositOffsetsApplied);
        // A future/unrecognized money source must require review rather than
        // disappear from an apparently complete financial report.
        var unsupported = charge with { Id = Guid.NewGuid(), Kind = "FutureUnknown", Amount = 1, SourceKey = "synthetic-unsupported-source" };
        var envelope = System.Text.Json.JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "SettlementReceivableV1", recordKey = unsupported.Id, state = unsupported }, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        await finalDb.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history=history||jsonb_build_array({envelope}::jsonb) WHERE id={w.Contract}");
        var incomplete = await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&roomId={w.Room}");
        Assert.Equal(HttpStatusCode.Conflict, incomplete.StatusCode); Assert.Contains("settlement_report_sources_require_review", await incomplete.Content.ReadAsStringAsync());
        var invalid = new PaymentAllocation
        {
            SourceDepositContractId = w.Contract,
            TargetSettlementContractId = w.Contract,
            SettlementReceivableId = charge.Id,
            Amount = 1,
            VerifiedByUserId = w.Owner,
            AllocatedAt = DateTimeOffset.UtcNow
        };
        finalDb.Add(invalid); await Assert.ThrowsAsync<DbUpdateException>(() => finalDb.SaveChangesAsync());
        finalDb.ChangeTracker.Clear();
        var rejected = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => finalDb.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_deposit_contract_id,target_settlement_contract_id,settlement_receivable_id,
              amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
            VALUES({Guid.NewGuid()},{w.Contract},{w.Contract},{charge.Id},1,{Guid.NewGuid()},1,{w.Owner},{DateTimeOffset.UtcNow},'Synthetic bypass must fail')
            """));
        Assert.Equal("23514", rejected.SqlState);
    }
    internal async Task DepositOffsetsVerifyDamageEvidenceAndFinalInvoiceBalance()
    {
        var (w, proof, photo) = await DamageFixture(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var route = $"/api/v1/contracts/{w.Contract}/move-out/receivables";
        var view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var inspection = await db.Set<BHome.Domain.TenantContracts.ContractFinalInspection>().SingleAsync(i => i.ContractId == w.Contract);
        var charge = await RefundValue<SettlementReceivable>(await Post(owner, route + "/damage",
            new DamageChargeInput(view.Reference, inspection.Id, inspection.Version, null, 600000, "Synthetic damage", [proof], true)));
        var evidence = await db.Set<BHome.Domain.TenantContracts.ContractInspectionEvidence>().SingleAsync(e => e.Id == proof);
        var storage = scope.ServiceProvider.GetRequiredService<BHome.Application.Storage.IObjectStorage>();
        using var image = new OpenCvSharp.Mat(40, 100, OpenCvSharp.MatType.CV_8UC3, OpenCvSharp.Scalar.Black);
        var changed = image.ImEncode(".png");
        using (var content = new MemoryStream(changed)) await storage.PutAsync(evidence.ObjectKey, content, changed.Length, "image/png", default);
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/deposit-offsets", new DepositOffsetInput(view.Reference, charge.Id, null, 1, "Tampered proof", true))).StatusCode);
        using (var content = new MemoryStream(photo)) await storage.PutAsync(evidence.ObjectKey, content, photo.Length, "image/png", default);
        // An approved post-finalization adjustment creates a real remaining invoice balance.
        var adjustment = await AdjustRequest(tenant, w.Invoice, 1, 150000);
        (await Post(owner, $"/api/v1/invoice-adjustments/{adjustment.Id}/approve",
            new BHome.Application.Billing.AdjustmentDecisionInput(1, 1, 0, 150000, null, "Synthetic additional approved rent", true))).EnsureSuccessStatusCode();
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        var input = new DepositOffsetInput(view.Reference, null, w.Invoice, 50000, "Owner applies deposit to this invoice", true);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/deposit-offsets", input with { Amount = 50001 })).StatusCode);
        await RefundValue<DepositOffsetApproval>(await Post(owner, route + "/deposit-offsets", input));
        var summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/settlement-summary"));
        Assert.Equal(0, summary.Invoices.Single(i => i.InvoiceId == w.Invoice).Financials.OutstandingAmount);
        Assert.Equal(350000, summary.Calculation!.AvailableSecurityDeposit);
        Assert.Equal(600000, Assert.Single(summary.Receivables!).Outstanding);
        Assert.Equal(1, await db.Set<PaymentAllocation>().CountAsync(a => a.DepositOffsetApprovalId != null));
    }
}
