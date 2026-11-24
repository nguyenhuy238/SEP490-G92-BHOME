using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

public sealed partial class ContractLifecycleApiTests
{
    [Theory]
    [InlineData(3500000, "Payable", 500000)]
    [InlineData(2800000, "RefundEligible", 200000)]
    [InlineData(3000000, "Settled", 0)]
    public async Task TenantAcceptedVerifiedMoveOutQuotePostsOnlyNetMoneyAndSePaySettlesOnce(
        int proposedFee, string expectedStatus, int expectedAmount, bool recoverPreviousConsent = false)
    {
        if (!await UsesCompact24()) return;
        const string account = "123456789012";
        const string secret = "SYNTHETIC-BHOME-SEPAY-TEST-SIGNING-KEY-12345678";
        var w = await Setup(); var contractId = await Active(w);
        // A testing bank account and a marked synthetic contract keep every
        // test webhook out of the real/Live SePay payment environment.
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var contract = await db.Set<Contract>().SingleAsync(c => c.Id == contractId);
            contract.PaymentMode = "Test";
            contract.IsDevelopmentDemo = true;
            db.Add(new ReceivingBankAccount
            {
                LocationId = w.Location,
                BankIdentifier = "970416",
                AccountNumber = account,
                AccountHolder = "SYNTHETIC BHOME ACCOUNT",
                Enabled = true,
                IsDevelopmentDemo = true,
                Version = 1,
                ConfirmedByUserId = w.Owner.Id,
                ConfirmedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }
        var termination = new TerminationInput(Today, "Synthetic verified move-out quote");
        await Success<MoveOutView>(await Post(w.Tenant, Path(contractId, "termination-requests"), termination));
        await Success<MoveOutView>(await Post(w.Owner, Path(contractId, "move-out/approve")));
        await StartMoveOutTaskForInspection(w, contractId);
        var electricity = await FinalReading(w, contractId, UtilityType.Electricity);
        var water = await FinalReading(w, contractId, UtilityType.Water);
        var opening = await EmptyRoomHandoverChoices(w, contractId);
        await PrepareHistoricalHandoverFixture(contractId);
        using (var photo = new ByteArrayContent(Image()))
        {
            photo.Headers.ContentType = new("image/png");
            var openingProof = (await Success<ContractId>(await w.Staff.Client.PostAsync(
                Path(contractId, "handover/evidence"), photo))).Id;
            await Success<HandoverView>(await Post(w.Staff, Path(contractId, "handover"),
                new HandoverInput(0, opening.Readings.First(r => r.UtilityType == 0).Date,
                    "Synthetic initial condition", "Synthetic original keys", "", [],
                    opening.Readings.First(r => r.UtilityType == 0).Id,
                    opening.Readings.First(r => r.UtilityType == 1).Id,
                    [openingProof], opening.InventoryToken)));
        }
        await Success<HandoverView>(await Post(w.Tenant, Path(contractId, "handover/tenant-confirmation"),
            new HandoverDecision(1, "Synthetic tenant confirmed")));
        await Success<HandoverView>(await Post(w.Staff, Path(contractId, "handover/staff-confirmation"),
            new HandoverDecision(1, "Synthetic staff confirmed")));
        using var photoProof = new ByteArrayContent(Image());
        photoProof.Headers.ContentType = new("image/png");
        var proof = (await Success<ContractId>(await w.Staff.Client.PostAsync(
            Path(contractId, "move-out/evidence"), photoProof))).Id;
        using var roomProofPhoto = new ByteArrayContent(Image());
        roomProofPhoto.Headers.ContentType = new("image/png");
        var roomProof = (await Success<ContractId>(await w.Staff.Client.PostAsync(
            Path(contractId, "move-out/evidence"), roomProofPhoto))).Id;
        var preparation = await Success<InspectionPreparation>(await w.Staff.Client.GetAsync(
            Path(contractId, "move-out/inspection-preparation")));
        var roomChecks = HandoverRoomChecklist.RequiredCodes.Select(code =>
            new HandoverRoomCheck(code, code == "cleanliness" ? "Issue" : "Passed",
                code == "cleanliness" ? "Synthetic cleaning damage" : null,
                code == "cleanliness" ? [roomProof] : [])).ToArray();
        var inspection = new InspectionInput(electricity, water, "Synthetic final condition", [proof], [],
            "Synthetic room final", "Synthetic returned keys", InventoryToken: preparation.Inventory?.StateToken,
            RoomChecks: roomChecks, AccessItems: [new HandoverAccessItem("RoomKey", 0, "")]);
        var draft = await Success<MoveOutInspectionDraftView>(await w.Staff.Client.GetAsync(
            Path(contractId, "move-out/inspection-draft")));
        using (var request = new HttpRequestMessage(HttpMethod.Patch,
                   Path(contractId, "move-out/inspection-draft"))
        {
            Content = JsonContent.Create(new MoveOutInspectionDraftWrite(draft.Version,
                   RoomCondition: inspection.RoomCondition, EvidenceIds: [proof],
                   ElectricityReadingId: electricity, WaterReadingId: water))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            await Success<MoveOutInspectionDraftView>(await w.Staff.Client.SendAsync(request));
        }
        await Success<MoveOutView>(await Post(w.Staff, Path(contractId, "move-out/inspection"), inspection));
        var path = Path(contractId, "move-out/receivables/proposal");
        var preview = await Success<MoveOutChargeProposalPreview>(await w.Owner.Client.GetAsync(path));
        var cleaning = Assert.Single(preview.Items, i => i.Kind == "RoomCheck" && i.RoomCheckCode == "cleanliness");
        Assert.Contains(roomProof, cleaning.EvidenceIds);
        var quoteInput = new MoveOutChargeProposalInput(preview.Reference, preview.InspectionId,
            preview.InspectionVersion,
            [new MoveOutProposedCharge("RoomCheck", null, "cleanliness", null, proposedFee,
                "Synthetic Owner verified cleaning loss")]);
        MoveOutChargeProposal proposal;
        if (recoverPreviousConsent)
        {
            // The database enforces append-only history. Seed the old-format
            // Owner-approved quote once rather than altering a modern record.
            proposal = new MoveOutChargeProposal(Guid.NewGuid(), contractId, preview.Reference,
                preview.InspectionId, preview.InspectionVersion, quoteInput.Items,
                preview.VerifiedDeposit, preview.AvailableDeposit, proposedFee,
                preview.AvailableDeposit - proposedFee - preview.ExistingOutstanding,
                null, w.Owner.Id, DateTimeOffset.UtcNow, [w.Tenant.Id], Guid.NewGuid(),
                "synthetic-original-owner-financial-approval", true,
                ExistingOutstanding: preview.ExistingOutstanding, PhysicalReference: "");
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var json = JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                recordType = "MoveOutChargeProposalV1",
                recordKey = proposal.Id,
                state = proposal
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contracts SET history=history||jsonb_build_array(CAST({json} AS jsonb))
                WHERE id={contractId}
                """);
        }
        else
            proposal = await Success<MoveOutChargeProposal>(await Post(w.Owner, path, quoteInput));
        var feedbackInput = new MoveOutChargeProposalFeedbackInput(proposal.Id, preview.Reference, true);
        var key = Guid.NewGuid();
        MoveOutChargeProposalFeedback accepted;
        if (recoverPreviousConsent)
        {
            // Simulate an earlier authenticated Tenant confirmation persisted
            // while the obsolete OwnerDecision gate existed. Reconcile that
            // original immutable consent through the real authorized API.
            var prior = new MoveOutChargeProposalFeedback(Guid.NewGuid(), contractId, proposal.Id,
                true, "", w.Tenant.Id, DateTimeOffset.UtcNow, key,
                "synthetic-existing-tenant-consent", Settlement: new MoveOutProposalSettlement(
                    "PendingOwnerReview", 0, 0, null, [], [], "owner_confirmed_inspection_required"));
            await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
                var record = JsonSerializer.Serialize(new
                {
                    schemaVersion = 1,
                    recordType = "MoveOutChargeProposalFeedbackV1",
                    recordKey = prior.Id,
                    state = prior
                }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE contracts SET history=history||jsonb_build_array(CAST({record} AS jsonb))
                    WHERE id={contractId}
                    """);
            }
            Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Owner, path + "/reconcile",
                new MoveOutChargeProposalReconcileInput(proposal.Id))).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, path + "/reconcile",
                new MoveOutChargeProposalReconcileInput(Guid.NewGuid()))).StatusCode);
            accepted = await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                path + "/reconcile", new MoveOutChargeProposalReconcileInput(proposal.Id)));
            Assert.Equal(prior.Id, accepted.Id);
            Assert.Equal(prior.RespondedAt, accepted.RespondedAt);
            var replayedReconciliation = await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                path + "/reconcile", new MoveOutChargeProposalReconcileInput(proposal.Id)));
            Assert.Equal(accepted.Id, replayedReconciliation.Id);
            Assert.Equal(accepted.Settlement!.Status, replayedReconciliation.Settlement?.Status);
            Assert.Equal(accepted.Settlement.PayableAmount, replayedReconciliation.Settlement?.PayableAmount);
            Assert.Equal(accepted.Settlement.PayableReceivableId, replayedReconciliation.Settlement?.PayableReceivableId);
            Assert.Equal(accepted.Settlement.CreatedReceivableIds,
                replayedReconciliation.Settlement?.CreatedReceivableIds);
            Assert.StartsWith("PHYSICAL-", accepted.VerifiedPhysicalReference);
            var persisted = await Success<MoveOutChargeProposalPreview>(await w.Tenant.Client.GetAsync(path));
            Assert.Equal(string.Empty, persisted.LatestProposal?.PhysicalReference);
            Assert.Equal(accepted.VerifiedPhysicalReference,
                persisted.LatestProposal?.TenantFeedback?.VerifiedPhysicalReference);
        }
        else
        {
            accepted = await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                path + "/tenant-feedback", feedbackInput, key));
            var replay = await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                path + "/tenant-feedback", feedbackInput, key));
            Assert.Equal(accepted.Id, replay.Id);
        }
        Assert.Equal(expectedStatus, accepted.Settlement?.Status);
        // Agreement is not proof of payment. Never vacate the room while any
        // accepted settlement still requires a real verified transfer.
        var beforePayment = await Success<ContractView>(await w.Tenant.Client.GetAsync(
            Path(contractId, "")));
        Assert.Equal("Active", beforePayment.Status);
        Assert.Equal(expectedStatus == "RefundEligible" ? expectedAmount : 0, accepted.Settlement!.RefundAmount);
        Assert.Equal(expectedStatus == "Payable" ? expectedAmount : 0, accepted.Settlement.PayableAmount);
        Assert.Equal("Accepted", (await Success<MoveOutChargeProposalPreview>(
            await w.Tenant.Client.GetAsync(path))).Status);
        var view = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(
            Path(contractId, "move-out/receivables")));
        var charge = Assert.Single(view.Receivables);
        Assert.Equal(proposedFee, charge.Charge.Amount);
        Assert.Equal(expectedStatus == "Payable" ? expectedAmount : 0, charge.Outstanding);
        Assert.Equal(Math.Min(3000000, proposedFee), Assert.Single(view.Offsets).Amount);

        if (expectedStatus == "RefundEligible")
        {
            // The Tenant must ask for the actual refundable balance, and the
            // Owner must approve the petition. This is NOT an executable
            // second refund outside the classified deposit ledger.
            var petitionPath = "/api/v1/tenant/refund-requests";
            var request = new TenantRefundPetitionInput(expectedAmount,
                "Synthetic request for remaining move-out deposit", null, contractId, proposal.Id);
            var requestKey = Guid.NewGuid();
            var petition = await Success<TenantRefundPetitionView>(await Post(w.Tenant,
                petitionPath, request, requestKey));
            Assert.Equal("REQUESTED", petition.Status);
            Assert.Equal(proposal.Id, petition.MoveOutProposalId);
            Assert.Equal(contractId, petition.SourceContractId);
            Assert.Equal(expectedAmount, petition.Amount);
            Assert.Equal(petition.Id, (await Success<TenantRefundPetitionView>(await Post(w.Tenant,
                petitionPath, request, requestKey))).Id);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, petitionPath,
                request, Guid.NewGuid())).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, petitionPath,
                request with { Amount = expectedAmount + 1000 }, Guid.NewGuid())).StatusCode);
            var decision = await Success<TenantRefundPetitionView>(await Post(w.Owner,
                $"/api/v1/owner/tenant-refund-requests/{petition.Id}/decision",
                new TenantRefundPetitionDecision(petition.Version, true,
                    "Synthetic Owner approved verified deposit refund", true)));
            Assert.Equal("APPROVED", decision.Status);
            return;
        }
        if (expectedStatus != "Payable") return;
        await using var sepayHost = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SePay:Enabled"] = "true",
                ["SePay:Mode"] = "Test",
                ["SePay:WebhookSecret"] = secret,
                ["SePay:ReceivingAccounts:0:LocationId"] = w.Location.ToString(),
                ["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416",
                ["SePay:ReceivingAccounts:0:Gateway"] = "ACB",
                ["SePay:ReceivingAccounts:0:AccountNumber"] = account
            })));
        using var tenant = sepayHost.CreateClient();
        tenant.DefaultRequestHeaders.Authorization = w.Tenant.Client.DefaultRequestHeaders.Authorization;
        var instructions = await Success<SettlementTransferInstructions>(await tenant.GetAsync(
            Path(contractId, $"move-out/receivables/{charge.Charge.Id}/transfer-instructions")));
        Assert.Equal("Available", instructions.Availability);
        Assert.Equal(expectedAmount, instructions.OutstandingAmount);
        Assert.Matches("^BH[0-9]{8}$", instructions.TransferReference);
        Assert.StartsWith("data:image/png;base64,", instructions.QrImageDataUri);
        var receiptRef = "SYN-" + Guid.NewGuid();
        var content = JsonSerializer.Serialize(new
        {
            id = Guid.NewGuid().ToString(),
            gateway = "ACB",
            transactionDate = DateTimeOffset.UtcNow.AddSeconds(-5).ToOffset(TimeSpan.FromHours(7))
                .ToString("yyyy-MM-dd HH:mm:ss"),
            accountNumber = account,
            subAccount = "",
            code = instructions.TransferReference,
            content = "Synthetic " + instructions.TransferReference,
            transferType = "in",
            transferAmount = expectedAmount,
            referenceCode = receiptRef,
            description = "Synthetic settlement bank transfer",
            accumulated = expectedAmount
        });
        using var unsigned = sepayHost.CreateClient();
        async Task<HttpResponseMessage> SendWebhook()
        {
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
            var signature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(
                Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(timestamp + "." + content)));
            using var request = new HttpRequestMessage(HttpMethod.Post, SePayOptions.WebhookRoute)
            { Content = new StringContent(content, Encoding.UTF8, "application/json") };
            request.Headers.Add("X-SePay-Timestamp", timestamp);
            request.Headers.Add("X-SePay-Signature", signature);
            return await unsigned.SendAsync(request);
        }
        Assert.Equal(HttpStatusCode.OK, (await SendWebhook()).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SendWebhook()).StatusCode);
        view = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(
            Path(contractId, "move-out/receivables")));
        Assert.Equal(0, Assert.Single(view.Receivables).Outstanding);
        await using var verification = sepayHost.Services.CreateAsyncScope();
        var dbVerified = verification.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(2, await dbVerified.Set<PaymentAllocation>().CountAsync(a =>
            a.TargetSettlementContractId == contractId && a.SettlementReceivableId == charge.Charge.Id));
        var afterPayment = await Success<SettlementTransferInstructions>(await tenant.GetAsync(
            Path(contractId, $"move-out/receivables/{charge.Charge.Id}/transfer-instructions")));
        Assert.Equal("Settled", afterPayment.Availability);
        Assert.Null(afterPayment.QrImageDataUri);
        var completed = await Success<ContractView>(await tenant.GetAsync(Path(contractId, "")));
        Assert.Equal("Terminated", completed.Status);
        Assert.Equal(Today, completed.ActualEndDate);
        var move = await Success<MoveOutView>(await tenant.GetAsync(Path(contractId, "move-out")));
        Assert.Equal("Completed", move.Status);
        dbVerified.ChangeTracker.Clear();
        var closedRoom = await dbVerified.Set<Room>().AsNoTracking().SingleAsync(r => r.Id == completed.RoomId);
        Assert.Equal(RoomStatus.Available, closedRoom.Status);
        Assert.Single(await dbVerified.Set<ContractMoveOutHistory>().AsNoTracking().Where(h =>
            h.ContractId == contractId && h.Action == "Completed").ToArrayAsync());
    }
}
