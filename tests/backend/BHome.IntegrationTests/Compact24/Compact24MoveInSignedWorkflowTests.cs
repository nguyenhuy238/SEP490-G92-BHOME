using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence.Compact24;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private sealed class HandoverOtpMailbox : INotificationChannelProvider
    {
        internal ConcurrentQueue<ChannelMessage> Sent { get; } = new();
        public bool IsConfigured(string channel) => channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => false;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken t)
        {
            Sent.Enqueue(message);
            return Task.FromResult("testing-mail-sent");
        }
    }

    private WebApplicationFactory<Program> HandoverSigningHost(HandoverOtpMailbox mailbox) =>
        Host().WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?> { ["ContractSigning:Methods:Otp"] = "true" }));
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IContractSigningProvider>();
                services.AddScoped<IContractSigningProvider, ContractSigningRouter>();
                services.RemoveAll<INotificationChannelProvider>();
                services.AddSingleton<INotificationChannelProvider>(mailbox);
            });
        });

    private static HandoverDraftReady OwnerSignature(int version, string? reason = null,
        string? plan = null) => new(version, reason, plan,
            new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true),
            new HandoverInkInput(360, 150,
                [[[20, 100], [60, 40], [90, 110], [130, 50]],
                  [[150, 90], [200, 60], [260, 95], [320, 70]]]));

    [CompactPostgresFact]
    public async Task StaffCanSubmitFourCompletedSectionsWithRoomIssueAndMissingInventoryWithoutDraftAssets()
    {
        var w = await Seed();
        var mailbox = new HandoverOtpMailbox(); using var host = HandoverSigningHost(mailbox);
        var contractId = (await SeedAssetHandover(w, host.Services, configured: 1, checkedGroups: 1)).Contract;
        using var staff = await Client(w.Staff, host);
        using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host);
        var draft = await StartRealMoveInTask(staff, host.Services, contractId, w.Staff.Id);
        var group = Assert.Single((await staff.GetFromJsonAsync<HandoverChoices>(
            $"/api/v1/contracts/{contractId}/handover/choices"))!.Assets);
        var inventoryTaskId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"contract-pre-move-in-inventory:{contractId:N}")).AsSpan(0, 16));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var task = new OperationalTask
            {
                Kind = OperationalTaskKind.MoveInInventory,
                ContractId = contractId,
                LocationId = w.Location,
                TargetRoomId = w.Room,
                Title = "Kiểm kê tài sản trước bàn giao",
                Requirements = "Ghi nhận thiếu/hỏng kèm ảnh",
                Status = MeterTaskStatus.Assigned,
                AssignedStaffUserId = w.Staff.Id,
                AssignedAt = DateTimeOffset.UtcNow,
                MoveInInventoryJson = JsonSerializer.Serialize(new MoveInInventorySnapshot(
                    (await staff.GetFromJsonAsync<HandoverChoices>(
                        $"/api/v1/contracts/{contractId}/handover/choices"))!.InventoryToken!,
                    [new MoveInInventoryItem(group.Id, null, "Ghế kiểm kê", 4)]))
            };
            db.Entry(task).Property(t => t.Id).CurrentValue = inventoryTaskId;
            db.Add(task);
            await db.SaveChangesAsync();
        }

        var roomPhoto = await HandoverPhoto(staff, contractId);
        var incompleteChecks = HandoverRoomChecklist.RequiredCodes.Take(6).Select(code =>
            new HandoverRoomCheck(code, code == "doors_windows_locks" ? "Issue" : "Passed",
                code == "doors_windows_locks" ? "Khóa bị hỏng, đã chụp ảnh" : "",
                code == "doors_windows_locks" ? [roomPhoto] : [])).ToArray();
        var partial = await Read<HandoverDraftView>(await HandoverPost(staff, contractId,
            "handover/draft", new HandoverDraftWrite(draft.Version,
                RoomCondition: "Có hư hỏng ở khóa cửa", RoomChecks: incompleteChecks)));
        var prematurelySubmitted = await HandoverPost(staff, contractId, "handover/draft/submit",
            new HandoverDraftSubmit(partial.Version));
        Assert.Equal(HttpStatusCode.Conflict, prematurelySubmitted.StatusCode);
        Assert.Contains("room_checklist", await prematurelySubmitted.Content.ReadAsStringAsync());

        var completedChecks = await Read<HandoverDraftView>(await HandoverPost(staff, contractId,
            "handover/draft", new HandoverDraftWrite(partial.Version,
                RoomChecks: [new HandoverRoomCheck("safety_equipment", "Passed", "", [])],
                AccessItems: [new HandoverAccessItem("RoomKey", 2, "Đã kiểm đếm")])));
        var beforeInventory = await HandoverPost(staff, contractId, "handover/draft/submit",
            new HandoverDraftSubmit(completedChecks.Version));
        Assert.Equal(HttpStatusCode.Conflict, beforeInventory.StatusCode);
        Assert.Contains("move_in_inventory", await beforeInventory.Content.ReadAsStringAsync());

        var taskRoute = $"/api/v1/operational-tasks/{inventoryTaskId}";
        var inventoryTask = (await staff.GetFromJsonAsync<TaskView>(taskRoute))!;
        using (var request = new HttpRequestMessage(HttpMethod.Post, taskRoute + "/start")
        {
            Content = JsonContent.Create(new TaskAction(inventoryTask.Version))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal("InProgress", (await Read<TaskView>(await staff.SendAsync(request))).Status);
        }
        TaskEvidenceView proof;
        using (var upload = new HttpRequestMessage(HttpMethod.Put, taskRoute + "/evidence")
        {
            Content = new ByteArrayContent(ReviewEvidenceImage())
        })
        {
            upload.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            upload.Content.Headers.ContentType = new("image/png");
            proof = await Read<TaskEvidenceView>(await staff.SendAsync(upload));
        }
        var inventoryView = (await staff.GetFromJsonAsync<MoveInInventoryView>(taskRoute + "/move-in-inventory"))!;
        using (var request = new HttpRequestMessage(HttpMethod.Put,
            taskRoute + $"/move-in-inventory/items/{group.Id}")
        {
            Content = JsonContent.Create(new MoveInInventoryItemWrite(inventoryView.Version,
                3, "Missing", "Thiếu một ghế, đã chụp ảnh thật", [proof.Id]))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            inventoryView = await Read<MoveInInventoryView>(await staff.SendAsync(request));
        }
        Assert.Equal("Missing", inventoryView.Outcome);
        using (var request = new HttpRequestMessage(HttpMethod.Post, taskRoute + "/move-in-inventory/complete")
        {
            Content = JsonContent.Create(new MoveInInventoryComplete(inventoryView.Version))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            inventoryView = await Read<MoveInInventoryView>(await staff.SendAsync(request));
        }
        Assert.Equal("Completed", inventoryView.Status);
        Assert.False(inventoryView.ReadyForHandover); // Owner has not resolved the missing asset.

        var beforeSubmit = (await staff.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{contractId}/handover/draft"))!;
        Assert.DoesNotContain("assets", beforeSubmit.Missing);
        Assert.DoesNotContain("inventory_changed", beforeSubmit.Missing);
        Assert.Contains("inventory_issue", beforeSubmit.Missing);
        Assert.Contains("room_check_failed", beforeSubmit.Missing);
        Assert.Equal("Completed", beforeSubmit.MoveInTask!.InventoryStatus);
        Assert.True(beforeSubmit.InventoryHasIssues);
        var actualObservation = Assert.Single(beforeSubmit.InspectedAssets!);
        Assert.Equal("Ghế kiểm kê", actualObservation.Name);
        Assert.Equal(4, actualObservation.ExpectedQuantity);
        Assert.Equal(3, actualObservation.ActualQuantity);
        Assert.Equal("Missing", actualObservation.Condition);
        // The PDF must reflect the canonical completed Staff task, even when
        // the optional and still-unapproved draft.assets copy is untouched.
        var previewResponse = await owner.GetAsync($"/api/v1/contracts/{contractId}/handover/draft/pdf");
        Assert.Equal(HttpStatusCode.OK, previewResponse.StatusCode);
        using var previewPdf = new PdfDocument(new PdfReader(new MemoryStream(
            await previewResponse.Content.ReadAsByteArrayAsync())));
        var previewText = BHome.IntegrationTests.Contracts.ContractPdfRendererTests.Text(previewPdf);
        Assert.Contains("Ghế kiểm kê", previewText);
        Assert.Contains("Thiếu", previewText);
        Assert.DoesNotContain("Chưa kiểm kê", previewText);
        var submitKey = Guid.NewGuid();
        var submitted = await Read<HandoverDraftView>(await HandoverPost(staff, contractId,
            "handover/draft/submit", new HandoverDraftSubmit(beforeSubmit.Version), submitKey));
        Assert.Equal("PendingOwnerReview", submitted.Status);
        Assert.Equal("PendingVerification", submitted.MoveInTask!.Status);
        Assert.Equal(w.Staff.Id, submitted.StaffSubmittedBy);
        Assert.NotNull(submitted.StaffSubmittedAt);
        Assert.DoesNotContain("assets", submitted.Missing);
        Assert.DoesNotContain("inventory_changed", submitted.Missing);
        Assert.Contains("inventory_issue", submitted.Missing);
        Assert.Contains("room_check_failed", submitted.Missing);
        Assert.Equal(submitted.Version, (await Read<HandoverDraftView>(await HandoverPost(staff,
            contractId, "handover/draft/submit", new HandoverDraftSubmit(beforeSubmit.Version), submitKey))).Version);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, contractId,
            "handover/draft/submit", new HandoverDraftSubmit(beforeSubmit.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await HandoverPost(tenant, contractId,
            "handover/draft/submit", new HandoverDraftSubmit(submitted.Version))).StatusCode);
        // No acceptance of an actual defect by entering a reason or plan.
        var blocked = await HandoverPost(owner, contractId, "handover/draft/ready",
            OwnerSignature(submitted.Version, "Chấp thuận khóa hỏng", "Sửa sau"));
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Contains("handover_draft_incomplete", await blocked.Content.ReadAsStringAsync());
        var inspection = await Read<HandoverDraftView>(await HandoverPost(owner, contractId,
            "handover/draft/reinspection",
            new HandoverDraftReinspection(submitted.Version, "Kiểm tra lại khóa và ghế thiếu",
                [new HandoverReinspectionItem("RoomCheck", "doors_windows_locks"),
                 new HandoverReinspectionItem("Asset", AssetId: group.Id)])));
        Assert.Equal("ReinspectionRequested", inspection.Status);
        Assert.Equal("InProgress", inspection.MoveInTask!.Status);
        Assert.Equal("InProgress", inspection.MoveInTask.InventoryStatus);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, contractId,
            "handover/draft/resubmit", new HandoverDraftSubmit(inspection.Version))).StatusCode);
        var updatedRoom = await Read<HandoverDraftView>(await HandoverPost(staff, contractId,
            "handover/draft", new HandoverDraftWrite(inspection.Version,
                RoomChecks: [new HandoverRoomCheck("doors_windows_locks", "Passed",
                    "Đã xử lý và kiểm tra khóa", [])])));
        Assert.False(updatedRoom.ReinspectionItems!.Single(item => item.Kind == "Asset").Rechecked);

        var oldEvidenceVersion = (await staff.GetFromJsonAsync<MoveInInventoryView>(
            taskRoute + "/move-in-inventory"))!.Version;
        using (var request = new HttpRequestMessage(HttpMethod.Put,
            taskRoute + $"/move-in-inventory/items/{group.Id}")
        {
            Content = JsonContent.Create(new MoveInInventoryItemWrite(oldEvidenceVersion,
                4, "Good", "Đã đếm lại, nhưng chưa có ảnh mới", [proof.Id]))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            oldEvidenceVersion = (await Read<MoveInInventoryView>(
                await staff.SendAsync(request))).Version;
        }
        using (var request = new HttpRequestMessage(HttpMethod.Post,
            taskRoute + "/move-in-inventory/complete")
        {
            Content = JsonContent.Create(new MoveInInventoryComplete(oldEvidenceVersion))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            var response = await staff.SendAsync(request);
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Contains("move_in_inventory_reinspection_new_evidence_required",
                await response.Content.ReadAsStringAsync());
        }
        TaskEvidenceView replacementPhoto;
        using (var upload = new HttpRequestMessage(HttpMethod.Put, taskRoute + "/evidence")
        {
            Content = new ByteArrayContent(ReviewEvidenceImage())
        })
        {
            upload.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            upload.Content.Headers.ContentType = new("image/png");
            replacementPhoto = await Read<TaskEvidenceView>(await staff.SendAsync(upload));
        }
        Assert.NotEqual(proof.Id, replacementPhoto.Id);
        var inventoryAgain = (await staff.GetFromJsonAsync<MoveInInventoryView>(
            taskRoute + "/move-in-inventory"))!;
        using (var request = new HttpRequestMessage(HttpMethod.Put,
            taskRoute + $"/move-in-inventory/items/{group.Id}")
        {
            Content = JsonContent.Create(new MoveInInventoryItemWrite(inventoryAgain.Version,
                4, "Good", "Kiểm tra lại đủ bốn ghế", [replacementPhoto.Id]))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            inventoryAgain = await Read<MoveInInventoryView>(await staff.SendAsync(request));
        }
        using (var request = new HttpRequestMessage(HttpMethod.Post,
            taskRoute + "/move-in-inventory/complete")
        {
            Content = JsonContent.Create(new MoveInInventoryComplete(inventoryAgain.Version))
        })
        {
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            inventoryAgain = await Read<MoveInInventoryView>(await staff.SendAsync(request));
        }
        Assert.Equal("Completed", inventoryAgain.Status);
        Assert.Equal("Good", inventoryAgain.Outcome);
        var reconciled = (await staff.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{contractId}/handover/draft"))!;
        Assert.DoesNotContain("assets", reconciled.Missing);
        Assert.DoesNotContain("inventory_changed", reconciled.Missing);
        Assert.DoesNotContain("inventory_issue", reconciled.Missing);
        Assert.DoesNotContain("room_check_failed", reconciled.Missing);
        Assert.All(reconciled.ReinspectionItems!, item => Assert.True(item.Rechecked));
        var resubmitted = await Read<HandoverDraftView>(await HandoverPost(staff, contractId,
            "handover/draft/resubmit", new HandoverDraftSubmit(reconciled.Version)));
        Assert.Equal("PendingOwnerReview", resubmitted.Status);
        Assert.Empty(resubmitted.Missing);
        var ready = await Read<HandoverDraftView>(await HandoverPost(owner, contractId,
            "handover/draft/ready", OwnerSignature(resubmitted.Version)));
        Assert.Equal("Ready", ready.Status);
        Assert.NotNull(ready.OwnerDocumentHash);
        var tenantReadyView = (await tenant.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{contractId}/handover/draft"))!;
        Assert.True(tenantReadyView.Missing.Length == 0,
            "Unexpected Tenant Ready blockers: " + string.Join(", ", tenantReadyView.Missing));
        var tenantRequest = await Read<HandoverDraftView>(await HandoverPost(tenant, contractId,
            "handover/draft/tenant-sign", new HandoverDraftTenantSign(ready.Version,
                new SigningInput(Guid.Empty, Method: SigningMethods.Otp))));
        Assert.True(tenantRequest.Missing.Length == 0,
            "Unexpected Tenant OTP blockers: " + string.Join(", ", tenantRequest.Missing));
        var otpMail = Assert.Single(mailbox.Sent,
            message => message.EventType == "HANDOVER_SIGNING_OTP");
        var otp = otpMail.Title[(otpMail.Title.LastIndexOf(' ') + 1)..];
        var signed = await Read<HandoverDraftView>(await HandoverPost(tenant, contractId,
            "handover/draft/tenant-sign/otp/confirm",
            new HandoverDraftTenantSignOtp(tenantRequest.Version, otp)));
        Assert.Equal("Confirmed", signed.Status);
        var final = (await tenant.GetFromJsonAsync<HandoverView>(
            $"/api/v1/contracts/{contractId}/handover"))!;
        var handedOverAsset = Assert.Single(final.Snapshot.Assets);
        Assert.Equal(4, handedOverAsset.ObservedQuantity);
        Assert.Equal(4, handedOverAsset.HandedOverQuantity);
        Assert.Equal(0, handedOverAsset.MissingQuantity);
        Assert.True(handedOverAsset.Checked);
    }

    [CompactPostgresFact]
    public async Task MissingAssetCannotBeSignedEvenWithOwnerReasonAndHandlingPlan()
    {
        var w = await Seed();
        var mailbox = new HandoverOtpMailbox(); using var host = HandoverSigningHost(mailbox);
        var id = (await SeedAssetHandover(w, host.Services, configured: 1, checkedGroups: 1)).Contract;
        using var staff = await Client(w.Staff, host); using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host);
        var initial = await StartRealMoveInTask(staff, host.Services, id, w.Staff.Id);
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(
            $"/api/v1/contracts/{id}/handover/choices"))!;
        var group = Assert.Single(choices.Assets);
        var overviewPhoto = await HandoverPhoto(staff, id);
        var missingPhoto = await HandoverPhoto(staff, id);
        Assert.NotEqual(overviewPhoto, missingPhoto);

        var draft = await Read<HandoverDraftView>(await HandoverPost(staff, id, "handover/draft",
            new HandoverDraftWrite(initial.Version, "Đã kiểm tra phòng", "Hai chìa khóa",
                "Ghi nhận một ghế bị thiếu",
                [new HandoverAssetInput(group.Id, "Thiếu một ghế", 3, 3, 3, 0, 0, 1,
                    true, "Đã kiểm kê và chụp riêng ghế bị thiếu", [missingPhoto])],
                [overviewPhoto], choices.InventoryToken,
                RoomChecks: HandoverRoomChecklist.RequiredCodes.Select(code =>
                    new HandoverRoomCheck(code, "Passed", "", [])).ToArray(),
                AccessItems: [new HandoverAccessItem("RoomKey", 2, "Đã đối chiếu")])));
        Assert.Contains("asset_not_passed", draft.Missing);
        Assert.Equal(1, Assert.Single(draft.Assets).MissingQuantity);
        var submitted = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft/submit", new HandoverDraftSubmit(draft.Version)));
        Assert.Equal("PendingOwnerReview", submitted.Status);
        Assert.False(submitted.OwnerInkSigningSupported); // Staff cannot sign.
        var ownerPending = (await owner.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{id}/handover/draft"))!;
        Assert.True(ownerPending.OwnerInkSigningSupported);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, id, "handover/draft/ready",
                OwnerSignature(submitted.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, id, "handover/draft/ready",
                OwnerSignature(submitted.Version, "Chấp thuận thiếu một ghế"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, id, "handover/draft/ready",
                OwnerSignature(submitted.Version, plan: "Bổ sung sau khi kiểm kê lại"))).StatusCode);
        var reason = "Owner chấp thuận hiện trạng còn thiếu một ghế";
        var handlingPlan = "Owner tạo nhiệm vụ bổ sung tài sản riêng";
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(owner, id,
            "handover/draft/ready", OwnerSignature(submitted.Version, reason, handlingPlan))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign", new HandoverDraftTenantSign(submitted.Version,
                new SigningInput(Guid.Empty, Method: SigningMethods.Otp)))).StatusCode);
        Assert.Equal("PendingOwnerReview",
            (await owner.GetFromJsonAsync<HandoverDraftView>($"/api/v1/contracts/{id}/handover/draft"))!.Status);
    }

    [CompactPostgresFact]
    public async Task TenantSessionSignatureCompletesOwnerSignedMoveInWithoutOtpAndCannotBeReplayedOrSpoofed()
    {
        var w = await Seed(); var outside = await Seed();
        var mailbox = new HandoverOtpMailbox(); using var host = HandoverSigningHost(mailbox);
        var id = (await SeedAssetHandover(w, host.Services, configured: 1, checkedGroups: 1)).Contract;
        using var staff = await Client(w.Staff, host); using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host); using var otherTenant = await Client(outside.Tenant, host);
        var route = $"/api/v1/contracts/{id}/handover/draft";
        var initial = await StartRealMoveInTask(staff, host.Services, id, w.Staff.Id);
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(
            $"/api/v1/contracts/{id}/handover/choices"))!;
        var asset = Assert.Single(choices.Assets);
        var photo = await HandoverPhoto(staff, id);
        var draft = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft", new HandoverDraftWrite(initial.Version,
                "Phòng tốt", "Hai chìa", "Đã kiểm kê",
                [new HandoverAssetInput(asset.Id, "Tốt", 4, 4, 4, 0, 0, 0,
                    true, "Đủ tài sản", [])], [photo], choices.InventoryToken,
                RoomChecks: HandoverRoomChecklist.RequiredCodes.Select(code =>
                    new HandoverRoomCheck(code, "Passed", null, [])).ToArray(),
                AccessItems: [new HandoverAccessItem("RoomKey", 2, "Hai chìa")])));
        Assert.Empty(draft.Missing);
        var submitted = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft/submit", new HandoverDraftSubmit(draft.Version)));
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", new HandoverDraftTenantSessionSign(
                submitted.Version, true, OwnerSignature(submitted.Version).Ink))).StatusCode);
        var ready = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            "handover/draft/ready", OwnerSignature(submitted.Version)));
        Assert.Equal("Ready", ready.Status);
        var ink = new HandoverInkInput(360, 150,
            [[[20, 75], [70, 32], [110, 100], [180, 42], [260, 92], [330, 60]]]);
        var input = new HandoverDraftTenantSessionSign(ready.Version, true, ink, "Đã kiểm tra và nhận phòng");
        Assert.Equal(HttpStatusCode.Forbidden, (await HandoverPost(owner, id,
            "handover/draft/tenant-sign/session", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await HandoverPost(staff, id,
            "handover/draft/tenant-sign/session", input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await HandoverPost(otherTenant, id,
            "handover/draft/tenant-sign/session", input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input with { Consent = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input with { Ink = null })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input with
            { Ink = new HandoverInkInput(360, 150, []) })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input with { Version = ready.Version - 1 })).StatusCode);

        var key = Guid.NewGuid();
        var signed = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input, key));
        Assert.Equal("Confirmed", signed.Status);
        Assert.NotNull(signed.TenantSignedAt);
        Assert.Equal("Completed", signed.MoveInTask!.Status);
        var repeat = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input, key));
        Assert.Equal(signed.Version, repeat.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/session", input)).StatusCode);
        Assert.DoesNotContain(mailbox.Sent, message => message.EventType == "HANDOVER_SIGNING_OTP");
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(
            await tenant.GetByteArrayAsync(route + "/pdf"))));
        var signatures = new SignatureUtil(pdf);
        var names = signatures.GetSignatureNames();
        Assert.Equal(2, names.Count);
        Assert.All(names, name => Assert.True(signatures.ReadSignatureData(name)
            .VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(names[^1]));
        Assert.Equal("Confirmed", (await tenant.GetFromJsonAsync<HandoverView>(
            $"/api/v1/contracts/{id}/handover"))!.Status);
    }

    [CompactPostgresFact]
    public async Task StaffSubmitOwnerSignedPdfAndTenantOtpProduceVerifiedTwoSignatureHandover()
    {
        var w = await Seed(); var outside = await Seed();
        var mailbox = new HandoverOtpMailbox(); using var host = HandoverSigningHost(mailbox);
        var id = (await SeedAssetHandover(w, host.Services, configured: 1, checkedGroups: 1)).Contract;
        using var staff = await Client(w.Staff, host); using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host); using var outsideTenant = await Client(outside.Tenant, host);
        var route = $"/api/v1/contracts/{id}/handover/draft";
        var initial = (await staff.GetFromJsonAsync<HandoverDraftView>(route))!;

        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync(route + "/pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsideTenant.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(staff, id, "handover/draft/submit", new HandoverDraftSubmit(initial.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await HandoverPost(tenant, id, "handover/draft/submit", new HandoverDraftSubmit(initial.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, id, "handover/draft/tenant-sign",
                new HandoverDraftTenantSign(initial.Version,
                    new SigningInput(Guid.Empty, Method: SigningMethods.Otp)))).StatusCode);

        await StartRealMoveInTask(staff, host.Services, id, w.Staff.Id);
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>($"/api/v1/contracts/{id}/handover/choices"))!;
        var asset = Assert.Single(choices.Assets);
        var photo = await HandoverPhoto(staff, id);
        var draft = await Read<HandoverDraftView>(await HandoverPost(staff, id, "handover/draft",
            new HandoverDraftWrite(initial.Version, "Tường sàn tốt", "Hai chìa", "Đã kiểm kê",
                [new HandoverAssetInput(asset.Id, "Tốt", 4, 4, 4, 0, 0, 0,
                    true, "Đủ tài sản", [])], [photo], choices.InventoryToken,
                RoomChecks: HandoverRoomChecklist.RequiredCodes.Select(code =>
                    new HandoverRoomCheck(code, "Passed", "", [])).ToArray(),
                AccessItems: [new HandoverAccessItem("RoomKey", 2, "Hai chìa")])));
        Assert.Empty(draft.Missing);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, id, "handover/draft/ready", OwnerSignature(draft.Version))).StatusCode);
        var submitted = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft/submit", new HandoverDraftSubmit(draft.Version)));
        Assert.Equal("PendingOwnerReview", submitted.Status);
        Assert.False(submitted.OwnerInkSigningSupported);
        Assert.True((await owner.GetFromJsonAsync<HandoverDraftView>(route))!.OwnerInkSigningSupported);
        Assert.Equal(w.Staff.Id, submitted.StaffSubmittedBy);
        Assert.NotNull(submitted.StaffSubmittedAt);
        Assert.Equal("PendingVerification", submitted.MoveInTask!.Status);
        var tenantPending = (await tenant.GetFromJsonAsync<HandoverDraftView>(route))!;
        Assert.Equal("PendingOwnerReview", tenantPending.Status);
        Assert.False(tenantPending.OwnerInkSigningSupported);
        Assert.Empty(tenantPending.EvidenceIds);
        Assert.Empty(tenantPending.RoomChecks ?? []);
        Assert.Null(tenantPending.InspectedAssets); // No unapproved Staff observations to Tenant.
        // Meter photos must stay private until the Owner signs the handover.
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync(
            $"/api/v1/contracts/{id}/handover/meter-evidence/{submitted.Electricity!.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await HandoverPost(owner, id, "handover/draft/ready",
                new HandoverDraftReady(submitted.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await HandoverPost(staff, id, "handover/draft/ready",
                OwnerSignature(submitted.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await HandoverPost(tenant, id, "handover/draft/ready",
                OwnerSignature(submitted.Version))).StatusCode);
        var withoutInk = await HandoverPost(owner, id, "handover/draft/ready",
            new HandoverDraftReady(submitted.Version, Signature: new SigningInput(
                Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true)));
        Assert.Equal(HttpStatusCode.BadRequest, withoutInk.StatusCode);
        Assert.Contains("handover_owner_ink_required", await withoutInk.Content.ReadAsStringAsync());
        var invalidDrawing = await HandoverPost(owner, id, "handover/draft/ready",
            OwnerSignature(submitted.Version) with { Ink = new HandoverInkInput(360, 150, []) });
        Assert.Equal(HttpStatusCode.BadRequest, invalidDrawing.StatusCode);
        Assert.Contains("signature_drawing_invalid", await invalidDrawing.Content.ReadAsStringAsync());
        var ownerInk = OwnerSignature(submitted.Version);
        var ownerReadyKey = Guid.NewGuid();
        var ready = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            "handover/draft/ready", ownerInk, ownerReadyKey));
        Assert.Equal("Ready", ready.Status);
        Assert.NotNull(ready.OwnerDocumentHash);
        Assert.NotNull(ready.OwnerSignedAt);
        // The Tenant reviews both verified Initial meter photos BEFORE OTP.
        // The immutable ContractHandover does not exist yet at this stage.
        foreach (var reading in new[] { ready.Electricity!, ready.Water! })
            Assert.Equal(HttpStatusCode.OK, (await tenant.GetAsync(
                $"/api/v1/contracts/{id}/handover/meter-evidence/{reading.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync(
            $"/api/v1/contracts/{id}/handover/meter-evidence/{Guid.NewGuid()}")).StatusCode);
        var repeated = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            "handover/draft/ready", ownerInk, ownerReadyKey));
        Assert.Equal(ready.Version, repeated.Version);
        Assert.Equal(ready.OwnerDocumentHash, repeated.OwnerDocumentHash);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(owner, id,
            "handover/draft/ready", ownerInk with
            {
                Ink = new HandoverInkInput(360, 150,
                    [[[20, 40], [60, 100], [90, 45], [130, 110], [170, 60]]])
            }, ownerReadyKey)).StatusCode);
        var ownerPdf = await tenant.GetByteArrayAsync(route + "/pdf");
        Assert.Equal(ready.OwnerDocumentHash, Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(ownerPdf)));
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(ownerPdf))))
        {
            var names = new SignatureUtil(pdf).GetSignatureNames();
            Assert.Single(names);
            Assert.True(new SignatureUtil(pdf).ReadSignatureData(names[0]).VerifySignatureIntegrityAndAuthenticity());
            Assert.Contains(Enumerable.Range(1, pdf.GetNumberOfPdfObjects()),
                index => pdf.GetPdfObject(index) is PdfStream stream &&
                         PdfName.Image.Equals(stream.GetAsName(PdfName.Subtype)));
            var signedText = BHome.IntegrationTests.Contracts.ContractPdfRendererTests.Text(pdf);
            Assert.Contains("BIÊN BẢN BÀN GIAO PHÒNG", signedText);
            Assert.DoesNotContain("PHỤ LỤC BẰNG CHỨNG", signedText);
            Assert.DoesNotContain("Ảnh và bằng chứng được lưu riêng", signedText);
        }
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, id, "handover/draft/tenant-confirmation",
                new HandoverDraftTenantConfirmation(ready.Version))).StatusCode);

        var pending = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/tenant-sign", new HandoverDraftTenantSign(ready.Version,
                new SigningInput(Guid.Empty, Method: SigningMethods.Otp))));
        Assert.True(pending.TenantSigningPending);
        Assert.Equal(ready.Version + 1, pending.Version);
        var challenge = (await tenant.GetFromJsonAsync<SigningOtpView>(route + "/tenant-sign/otp"))!;
        Assert.Equal("Sent", challenge.Status);
        var sent = Assert.Single(mailbox.Sent, m => m.EventType == "HANDOVER_SIGNING_OTP" && m.Destination == w.Tenant.Email);
        var code = sent.Title[(sent.Title.LastIndexOf(' ') + 1)..];
        Assert.Matches("^[0-9]{6}$", code);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, id, "handover/draft/tenant-sign/otp/confirm",
                new HandoverDraftTenantSignOtp(ready.Version, code))).StatusCode);
        var badCode = code == "000000" ? "111111" : "000000";
        Assert.Equal(HttpStatusCode.BadRequest,
            (await HandoverPost(tenant, id, "handover/draft/tenant-sign/otp/confirm",
                new HandoverDraftTenantSignOtp(pending.Version, badCode))).StatusCode);
        var key = Guid.NewGuid();
        var confirmed = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/otp/confirm",
            new HandoverDraftTenantSignOtp(pending.Version, code), key));
        Assert.Equal("Confirmed", confirmed.Status);
        Assert.NotNull(confirmed.TenantSignedAt);
        Assert.Equal("Completed", confirmed.MoveInTask!.Status);
        var replay = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/tenant-sign/otp/confirm",
            new HandoverDraftTenantSignOtp(pending.Version, code), key));
        Assert.Equal(confirmed.Version, replay.Version);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, id, "handover/draft/tenant-sign/otp/confirm",
                new HandoverDraftTenantSignOtp(pending.Version, code))).StatusCode);
        using var finalPdf = new PdfDocument(new PdfReader(new MemoryStream(await tenant.GetByteArrayAsync(route + "/pdf"))));
        var signatures = new SignatureUtil(finalPdf);
        var signatureNames = signatures.GetSignatureNames();
        Assert.Equal(2, signatureNames.Count);
        Assert.All(signatureNames, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(signatureNames[^1]));
        Assert.Equal("Confirmed", (await tenant.GetFromJsonAsync<HandoverView>($"/api/v1/contracts/{id}/handover"))!.Status);
    }

    [CompactPostgresFact]
    public async Task OwnerReinspectionAndAcceptedTenantChangeInvalidateOldSignatureAndRequireStaffResubmit()
    {
        var w = await Seed(); var outside = await Seed();
        var mailbox = new HandoverOtpMailbox(); using var host = HandoverSigningHost(mailbox);
        var id = (await SeedAssetHandover(w, host.Services, configured: 1, checkedGroups: 1)).Contract;
        using var staff = await Client(w.Staff, host); using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host); using var otherTenant = await Client(outside.Tenant, host);
        var route = $"/api/v1/contracts/{id}/handover/draft";
        var initial = await StartRealMoveInTask(staff, host.Services, id, w.Staff.Id);
        var group = Assert.Single((await staff.GetFromJsonAsync<HandoverChoices>(
            $"/api/v1/contracts/{id}/handover/choices"))!.Assets);
        var photo = await HandoverPhoto(staff, id);
        var saved = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft", new HandoverDraftWrite(initial.Version,
                "Phòng đủ", "2 chìa", "Lần đầu",
                [new HandoverAssetInput(group.Id, "Tốt", 4, 4, 4, 0, 0, 0, true,
                    "Đủ tài sản", [])],
                [photo], initial.InventoryToken,
                RoomChecks: HandoverRoomChecklist.RequiredCodes.Select(code =>
                    new HandoverRoomCheck(code, "Passed", "", [])).ToArray(),
                AccessItems: [new HandoverAccessItem("RoomKey", 2, "")])));
        var submitted = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft/submit", new HandoverDraftSubmit(saved.Version)));
        var selection = new HandoverReinspectionItem("RoomCheck", "doors_windows_locks");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await HandoverPost(otherTenant, id, "handover/draft/reinspection",
                new HandoverDraftReinspection(submitted.Version, "Cần xem khóa", [selection]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await HandoverPost(owner, id, "handover/draft/reinspection",
                new HandoverDraftReinspection(submitted.Version, "Kiểm tra", [selection, selection]))).StatusCode);
        var recheck = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            "handover/draft/reinspection", new HandoverDraftReinspection(submitted.Version,
                "Chụp lại khóa cửa", [selection])));
        Assert.Equal("ReinspectionRequested", recheck.Status);
        Assert.Equal("InProgress", recheck.MoveInTask!.Status);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(staff, id, "handover/draft/resubmit",
                new HandoverDraftSubmit(recheck.Version))).StatusCode);
        using var recheckPhoto = new ByteArrayContent(ReviewEvidenceImage());
        recheckPhoto.Headers.ContentType = new("image/png");
        var extraPhoto = (await Read<ContractId>(await staff.PostAsync(
            route + "/evidence", recheckPhoto))).Id;
        var updated = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft", new HandoverDraftWrite(recheck.Version,
                RoomChecks: [new HandoverRoomCheck("doors_windows_locks", "Passed", "Đã kiểm lại khóa", [extraPhoto])])));
        Assert.True(Assert.Single(updated.ReinspectionItems!).Rechecked);
        var resubmitted = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft/resubmit", new HandoverDraftSubmit(updated.Version)));
        var ready = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            "handover/draft/ready", OwnerSignature(resubmitted.Version)));
        var signedHash = ready.OwnerDocumentHash;
        var requested = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/requests", new HandoverDraftCorrection(ready.Version, "Bổ sung mô tả cửa")));
        var rejected = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            $"handover/draft/requests/{Assert.Single(requested.Requests).Id}/decision",
            new HandoverDraftCorrectionDecision(requested.Version, false, "Ảnh thể hiện khóa tốt")));
        Assert.Equal("Ready", rejected.Status);
        Assert.Equal(signedHash, rejected.OwnerDocumentHash);
        var requestedAgain = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/requests", new HandoverDraftCorrection(rejected.Version, "Cần kiểm lại cửa")));
        var accepted = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            $"handover/draft/requests/{requestedAgain.Requests.Last().Id}/decision",
            new HandoverDraftCorrectionDecision(requestedAgain.Version, true, "Staff kiểm lại")));
        Assert.Equal("Draft", accepted.Status);
        Assert.Null(accepted.OwnerDocumentHash);
        Assert.Equal("InProgress", accepted.MoveInTask!.Status);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync(route + "/pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, id, "handover/draft/ready", OwnerSignature(accepted.Version))).StatusCode);
        var edited = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft", new HandoverDraftWrite(accepted.Version, Notes: "Đã kiểm tra lại cửa")));
        var reSubmitted = await Read<HandoverDraftView>(await HandoverPost(staff, id,
            "handover/draft/submit", new HandoverDraftSubmit(edited.Version)));
        var newReady = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            "handover/draft/ready", OwnerSignature(reSubmitted.Version)));
        Assert.NotEqual(signedHash, newReady.OwnerDocumentHash);
    }
}
