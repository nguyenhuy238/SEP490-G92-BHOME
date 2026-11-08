using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF03OnboardingContract;

/// <summary>
/// Sheet "BF-03 Onboarding Contract" (UC-13, UC-14, UC-15, UC-17). Steps and expected results come only from the plan;
/// routes/bodies from docs/api, docs/development and the Postman collections (see <see cref="ContractFlow"/>).
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-03 Onboarding Contract")]
public sealed class OnboardingContractTests(PlanSessions sessions)
{
    private const string HoldingNotDocumented =
        "No documented API: Holding Contract (UC-14) is not in docs/api. Holding routes appear only in docs/development/HOLDING_CONTRACT_PHASE2.md "
        + "(worktree, not accepted, no request bodies), are absent from API_RUNTIME_ROUTES.md, and CONTRACT_LIFECYCLE.md says the Holding ledger is Unconfigured";

    private readonly ContractFlow _flow = new(sessions);
    private PlanApi Api => sessions.Api;

    // ================= Holding Contract and Holding Deposit (UC-14) =================

    [Fact(DisplayName = "ITC-BF03-001 Test creating a Holding Contract and verifying the Holding Deposit.", Skip = HoldingNotDocumented + " (plan precondition: Room Available).")]
    [Trait("TestCase", "ITC-BF03-001")]
    public void ITC_BF03_001()
    {
    }

    [Fact(DisplayName = "ITC-BF03-002 Test the expiry of a Holding Contract (JOB-05).", Skip = HoldingNotDocumented + "; " + PlanSkip.BackgroundJob + " (JOB-05; plan precondition: Holding Contract pending deposit).")]
    [Trait("TestCase", "ITC-BF03-002")]
    public void ITC_BF03_002()
    {
    }

    // ================= Tenant and Occupant Onboarding with OCR (UC-13) =================

    [SkippableFact(DisplayName = "ITC-BF03-003 Test scanning an ID card and confirming the proposed data.")]
    [Trait("TestCase", "ITC-BF03-003")]
    public async Task ITC_BF03_003()
    {
        var space = await _flow.NewWorkspaceAsync();
        // Another Location (not assigned to this Staff) with its own resident: "records of other people".
        var otherLocation = await _flow.CreateLocationAsync();
        var otherRoom = await _flow.CreateRoomAsync(otherLocation);
        var otherResident = await _flow.CreateResidentAsync(otherRoom, "owner");

        // 1. Sign in as Staff and open the onboarding of a Room.
        var staff = await _flow.Token("staff");
        var residentId = await _flow.CreateResidentAsync(space.RoomId);

        // 2. Take or upload the front side of a synthetic ID card (synthetic image only; the Postman collection uses a synthetic PNG).
        using var ocr = await Api.SendBytesAsync(HttpMethod.Post, $"api/v1/ocr/identity/{residentId}/front", PlanData.TinyPng, "image/png", staff);
        var proposal = ContractFlow.Parse(await PlanAssert.SuccessAsync(ocr, "OCR front side"));

        // Expected: the OCR result is saved only as a proposal.
        Assert.Equal("true", proposal.Str("requiresConfirmation"));
        var before = await ResidentRowAsync(space.LocationId, residentId, "staff");

        // 3. Read the OCR proposal and correct a field.
        var citizen = ContractFlow.Synthetic12Digits();
        var proposedName = proposal.Str("proposedFields.fullName");
        var correctedName = "NGUOI THUE SUA " + (proposedName is null ? "THU CONG" : "TU OCR");

        // 4. Confirm the identity.
        using var confirm = await _flow.ConfirmIdentityAsync(residentId, ContractFlow.Identity(citizen, correctedName));
        var confirmBody = await PlanAssert.SuccessAsync(confirm, "confirm identity");
        var after = await ResidentRowAsync(space.LocationId, residentId, "staff");

        // Expected: identity saved after confirmation (not before), sensitive data encrypted / not returned,
        // records of other people are not shown.
        Assert.Null(before.Str("confirmedAt"));
        Assert.NotNull(after.Str("confirmedAt"));
        Assert.NotEqual(before.Str("verificationStatus"), after.Str("verificationStatus"));
        PlanAssert.DoesNotLeak(confirmBody, citizen);
        using var list = await Api.GetAsync($"api/v1/capture/locations/{space.LocationId}/residents", staff);
        var listBody = await PlanAssert.SuccessAsync(list, "Staff lists residents");
        PlanAssert.DoesNotLeak(listBody, citizen, otherResident);
        using var other = await Api.GetAsync($"api/v1/capture/locations/{otherLocation}/residents", staff);
        if (other.IsSuccessStatusCode)
        {
            PlanAssert.DoesNotLeak(await other.TextAsync(), otherResident);
        }
        else
        {
            await PlanAssert.RefusedAsync(other, "Staff opens residents of a Location that is not assigned");
        }
    }

    [SkippableFact(DisplayName = "ITC-BF03-004 Test adding the same person twice at the same time.")]
    [Trait("TestCase", "ITC-BF03-004")]
    public async Task ITC_BF03_004()
    {
        var space = await _flow.NewWorkspaceAsync();
        var first = await _flow.CreateResidentAsync(space.RoomId);
        var second = await _flow.CreateResidentAsync(space.RoomId);
        var identity = ContractFlow.Identity(ContractFlow.Synthetic12Digits(), "NGUOI TRUNG LAP TONG HOP");

        // 1. Confirm the same identity from two requests at once.
        var results = await Task.WhenAll(_flow.ConfirmIdentityAsync(first, identity), _flow.ConfirmIdentityAsync(second, identity));

        // Expected: only one record is created and the two are not merged automatically.
        Assert.Equal(1, results.Count(r => r.IsSuccessStatusCode));
        await PlanAssert.RefusedAsync(results.Single(r => !r.IsSuccessStatusCode), "second confirmation of the same identity");
        var rows = await ResidentRowsAsync(space.LocationId, "owner");
        Assert.Contains(rows, r => r.Str("id") == first);
        Assert.Contains(rows, r => r.Str("id") == second);
        Assert.Equal(1, rows.Count(r => (r.Str("id") == first || r.Str("id") == second) && r.Str("confirmedAt") is not null));
        foreach (var r in results)
        {
            r.Dispose();
        }
    }

    [SkippableFact(DisplayName = "ITC-BF03-005 Test who can read or confirm the identity data.")]
    [Trait("TestCase", "ITC-BF03-005")]
    public async Task ITC_BF03_005()
    {
        // Precondition: identity exists. staff2 = another Staff (not assigned here); staff3 = Staff whose assignment has expired.
        var locationId = await _flow.CreateLocationAsync();
        await _flow.AssignOkAsync(locationId, "staff3", ContractFlow.Today.AddDays(-10), ContractFlow.Today.AddDays(-1));
        await _flow.AssignOkAsync(locationId, "staff", ContractFlow.Today, ContractFlow.Today.AddDays(400));
        var roomId = await _flow.CreateRoomAsync(locationId);
        var residentId = await _flow.CreateResidentAsync(roomId);
        var citizen = ContractFlow.Synthetic12Digits();
        using (var c = await _flow.ConfirmIdentityAsync(residentId, ContractFlow.Identity(citizen, "NGUOI THUE QUYEN TRUY CAP")))
        {
            await PlanAssert.SuccessAsync(c, "confirm identity");
        }

        var path = $"api/v1/capture/locations/{locationId}/residents";

        // 1. Open the identity as the Owner, as another Staff, as a Staff whose assignment has expired and as a Tenant.
        using var owner = await Api.GetAsync(path, await _flow.Token("owner"));
        using var assigned = await Api.GetAsync(path, await _flow.Token("staff"));
        using var otherStaff = await Api.GetAsync(path, await _flow.Token("staff2"));
        using var expired = await Api.GetAsync(path, await _flow.Token("staff3"));
        using var tenant = await Api.GetAsync(path, await _flow.Token("tenant"));

        // Expected: only the allowed users can read it; other users are refused; identity data is not exposed.
        var ownerBody = await PlanAssert.SuccessAsync(owner, "Owner");
        var staffBody = await PlanAssert.SuccessAsync(assigned, "assigned Staff");
        Assert.Contains(residentId, ownerBody, StringComparison.OrdinalIgnoreCase);
        PlanAssert.DoesNotLeak(ownerBody, citizen);
        PlanAssert.DoesNotLeak(staffBody, citizen);
        await PlanAssert.RefusedAsync(otherStaff, "another Staff");
        await PlanAssert.RefusedAsync(expired, "Staff with an expired assignment");
        await PlanAssert.RefusedAsync(tenant, "Tenant");

        // Confirming the identity is also refused for the other/expired Staff and the Tenant.
        var again = ContractFlow.Identity(citizen, "NGUOI THUE QUYEN TRUY CAP");
        foreach (var account in new[] { "staff2", "staff3", "tenant" })
        {
            using var r = await _flow.ConfirmIdentityAsync(residentId, again, account);
            PlanAssert.DoesNotLeak(await PlanAssert.RefusedAsync(r, account + " confirms the identity"), citizen);
        }
    }

    // ================= Prepare, Sign and Activate the Main Tenancy Contract (UC-15) =================

    [SkippableFact(DisplayName = "ITC-BF03-006 Test creating the contract draft from a verified onboarding.")]
    [Trait("TestCase", "ITC-BF03-006")]
    public async Task ITC_BF03_006()
    {
        var space = await _flow.NewWorkspaceAsync();
        var verified = await _flow.VerifiedResidentAsync(space.RoomId);
        var unverified = await _flow.CreateResidentAsync(space.RoomId);

        // 1. Sign in as Staff and open the onboarding with verified identities.
        await _flow.RequireMainDraftReadyAsync(space.RoomId, verified, [verified]);

        // 2. Create the draft contract.
        var draft = await _flow.MainDraftOkAsync(space.RoomId, verified, [verified]);
        var draftId = ContractFlow.Id(draft, "Main Draft");

        // 3. Open the generated document.
        var files = await _flow.PostKeyedOkAsync($"api/v1/contracts/main-drafts/{draftId}/documents", null, "staff", "generate the draft document");
        var fileId = files.Str("pdf.id") ?? files.Str("docx.id");
        Assert.False(string.IsNullOrEmpty(fileId), "No generated document id: " + files.GetRawText());
        var documentPath = $"api/v1/contracts/main-drafts/{draftId}/documents/{fileId}";
        using var document = await Api.GetAsync(documentPath, await _flow.Token("staff"));
        var bytes = await document.Content.ReadAsByteArrayAsync();

        // Expected: a draft is created without a Tenant account.
        Assert.Equal("Draft", draft.Str("status"));
        var contract = await _flow.GetOkAsync($"api/v1/contracts/{draftId}", "owner", "read the draft contract");
        Assert.Null(contract.Str("tenantUserId"));

        // Expected: the contract document is generated and stored privately.
        Assert.True(document.IsSuccessStatusCode, $"Staff could not open the generated document (HTTP {(int)document.StatusCode}).");
        Assert.NotEmpty(bytes);
        using (var anonymous = await Api.GetAsync(documentPath))
        {
            await PlanAssert.StatusAsync(anonymous, HttpStatusCode.Unauthorized, "anonymous document download");
        }

        using (var tenant = await Api.GetAsync(documentPath, await _flow.Token("tenant")))
        {
            await PlanAssert.RefusedAsync(tenant, "Tenant document download");
        }

        // Expected: a draft is not created when the identity is not confirmed.
        var countBefore = await _flow.CountContractsAsync(space.LocationId);
        using var refused = await _flow.CreateMainDraftAsync(ContractFlow.MainDraftInput(space.RoomId, unverified, [unverified], ContractFlow.Today, ContractFlow.Today.AddYears(1).AddDays(-1)));
        await PlanAssert.RefusedAsync(refused, "draft with an unconfirmed identity");
        Assert.Equal(countBefore, await _flow.CountContractsAsync(space.LocationId));
    }

    [SkippableFact(DisplayName = "ITC-BF03-007 Test refusing a wrong draft.")]
    [Trait("TestCase", "ITC-BF03-007")]
    public async Task ITC_BF03_007()
    {
        var space = await _flow.NewWorkspaceAsync();
        var residentId = await _flow.VerifiedResidentAsync(space.RoomId);
        await _flow.RequireMainDraftReadyAsync(space.RoomId, residentId, [residentId]);
        var draft = await _flow.MainDraftOkAsync(space.RoomId, residentId, [residentId]);
        var draftId = ContractFlow.Id(draft, "Main Draft");
        var start = ContractFlow.Today;
        var end = start.AddYears(1).AddDays(-1);
        var count = await _flow.CountContractsAsync(space.LocationId);

        // 1. Create a draft that already exists.
        using var duplicate = await _flow.CreateMainDraftAsync(ContractFlow.MainDraftInput(space.RoomId, residentId, [residentId], start, end));
        await PlanAssert.RefusedAsync(duplicate, "draft that already exists");

        // 2. Create a draft with an invalid period or for a Room that is not available.
        var other = await _flow.VerifiedResidentAsync(space.RoomId);
        using var invalidPeriod = await _flow.CreateMainDraftAsync(ContractFlow.MainDraftInput(space.RoomId, other, [other], end, start));
        await PlanAssert.RefusedAsync(invalidPeriod, "invalid period");
        var closedRoom = await _flow.CreateRoomAsync(space.LocationId);
        var closedResident = await _flow.VerifiedResidentAsync(closedRoom);
        await CloseRoomAsync(space.LocationId, closedRoom);
        using var unavailable = await _flow.CreateMainDraftAsync(ContractFlow.MainDraftInput(closedRoom, closedResident, [closedResident], start, end));
        await PlanAssert.RefusedAsync(unavailable, "Room that is not available");

        // 3. Create it as a Staff who is not assigned.
        using var notAssigned = await _flow.CreateMainDraftAsync(ContractFlow.MainDraftInput(space.RoomId, other, [other], start, end), "staff2");
        await PlanAssert.RefusedAsync(notAssigned, "Staff who is not assigned");

        // Expected so far: each request is refused with a message and nothing is changed.
        foreach (var r in new[] { duplicate, invalidPeriod, unavailable, notAssigned })
        {
            Assert.False(string.IsNullOrWhiteSpace(await r.TextAsync()), $"Refusal {(int)r.StatusCode} has no message.");
        }

        Assert.Equal(count, await _flow.CountContractsAsync(space.LocationId));

        // 4. Edit a draft that is no longer Draft (Owner reviews and releases it to signing first).
        await _flow.LinkTenantAsync(residentId);
        var review = await _flow.PostKeyedOkAsync($"api/v1/contracts/main-drafts/{draftId}/signing-review", null, "owner", "Owner signing review");
        var version = int.Parse(draft.Str("version") ?? "0");
        await _flow.PostKeyedOkAsync(
            $"api/v1/contracts/main-drafts/{draftId}/release",
            new { tenantUserId = await _flow.UserIdAsync("tenant"), expectedVersion = version, reviewedFileId = ContractFlow.Id(review, "review file"), humanReviewed = true },
            "owner",
            "Owner releases the draft");
        var released = await _flow.GetOkAsync($"api/v1/contracts/{draftId}", "owner", "read released contract");
        using var edit = await Api.SendAsync(
            HttpMethod.Put,
            $"api/v1/contracts/main-drafts/{draftId}",
            ContractFlow.MainDraftInput(space.RoomId, residentId, [residentId], start, end.AddDays(-1), version),
            await _flow.Token("staff"),
            PlanData.IdempotencyKey());

        // Expected: refused with a message and nothing is changed.
        Assert.False(string.IsNullOrWhiteSpace(await PlanAssert.RefusedAsync(edit, "edit a draft that is no longer Draft")), "Refusal has no message.");
        var afterEdit = await _flow.GetOkAsync($"api/v1/contracts/{draftId}", "owner", "read contract after refused edit");
        Assert.Equal(released.Str("endDate"), afterEdit.Str("endDate"));
        Assert.Equal(released.Str("status"), afterEdit.Str("status"));
    }

    [SkippableFact(DisplayName = "ITC-BF03-008 Test one draft for a family and separate contracts for separate representatives.")]
    [Trait("TestCase", "ITC-BF03-008")]
    public async Task ITC_BF03_008()
    {
        var space = await _flow.NewWorkspaceAsync(capacity: 4);

        // 1. Add family members to one Room.
        var representative = await _flow.VerifiedResidentAsync(space.RoomId);
        var member = await _flow.VerifiedResidentAsync(space.RoomId);
        await _flow.RequireMainDraftReadyAsync(space.RoomId, representative, [representative, member]);

        // 2. Create the draft.
        var family = await _flow.MainDraftOkAsync(space.RoomId, representative, [representative, member]);

        // 3. Add a second representative with an independent contract.
        var independent = await _flow.VerifiedResidentAsync(space.RoomId);
        var separate = await _flow.MainDraftOkAsync(space.RoomId, independent, [independent]);

        // Expected: family members share one draft; independent representatives get separate contracts.
        var familyId = ContractFlow.Id(family, "family draft");
        var separateId = ContractFlow.Id(separate, "independent draft");
        Assert.NotEqual(familyId, separateId);
        var familyResidents = ContractFlow.Strings(await _flow.GetOkAsync($"api/v1/contracts/main-drafts/{familyId}", "staff", "read family draft"), "input.residentIds");
        Assert.Contains(representative, familyResidents, StringComparer.OrdinalIgnoreCase);
        Assert.Contains(member, familyResidents, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain(independent, familyResidents, StringComparer.OrdinalIgnoreCase);
        var separateResidents = ContractFlow.Strings(await _flow.GetOkAsync($"api/v1/contracts/main-drafts/{separateId}", "staff", "read independent draft"), "input.residentIds");
        Assert.Equal(independent, Assert.Single(separateResidents), ignoreCase: true);
    }

    [SkippableFact(DisplayName = "ITC-BF03-009 Test signing by both parties and activating the contract.")]
    [Trait("TestCase", "ITC-BF03-009")]
    public async Task ITC_BF03_009()
    {
        await _flow.RequireSimulatedSigningAsync();
        var space = await _flow.NewWorkspaceAsync();
        var (_, contractId) = await _flow.DraftContractAsync(space.RoomId, deposit: "1000000");
        await _flow.GeneratePreviewAsync(contractId);

        // 1. Owner and Tenant sign in turn.
        await _flow.SignAsync(contractId, "owner");
        var signed = await _flow.SignAsync(contractId, "tenant");

        // 2. Verify the deposit.
        using (var d = await _flow.VerifyDepositAsync(contractId, "IT-REF-" + Guid.NewGuid().ToString("N")[..12], "1000000"))
        {
            await PlanAssert.SuccessAsync(d, "verify deposit");
        }

        // 3. Owner activates the contract.
        var key = Guid.NewGuid().ToString();
        using var first = await _flow.ActivateAsync(contractId, key: key);
        var firstBody = await PlanAssert.SuccessAsync(first, "Owner activates");
        var historyAfterFirst = (await _flow.GetOkAsync($"api/v1/contracts/{contractId}/history", "owner", "history")).Items().Count;

        // 4. Run the same activation again.
        using var second = await _flow.ActivateAsync(contractId, key: key);
        await PlanAssert.SuccessAsync(second, "repeated activation");

        // Expected: the signing status and evidence are stored.
        var contract = await _flow.GetOkAsync($"api/v1/contracts/{contractId}", "owner", "read contract");
        var signatures = contract.Find("signatures")!.Value.EnumerateArray().ToList();
        Assert.Equal(2, signatures.Count);
        Assert.All(signatures, s => Assert.NotNull(s.Str("signedAt")));
        Assert.Equal(signed.Find("signatures")!.Value.GetArrayLength(), signatures.Count);

        // Expected: the contract becomes Active and the Room Occupied.
        Assert.Equal("Active", ContractFlow.Parse(firstBody).Str("status"));
        Assert.Equal("Active", contract.Str("status"));
        var room = await _flow.RoomStatusAsync(space.RoomId);
        Assert.True(ContractFlow.RoomIs(room, "Occupied", 2), $"Room status is '{room}', expected Occupied.");

        // Expected: the repeated request does not add the deposit or the audit a second time.
        Assert.Single((await _flow.GetOkAsync($"api/v1/contracts/{contractId}/deposit-verifications", "owner", "deposits")).Items());
        Assert.Equal(historyAfterFirst, (await _flow.GetOkAsync($"api/v1/contracts/{contractId}/history", "owner", "history")).Items().Count);
    }

    [SkippableFact(DisplayName = "ITC-BF03-010 Test that the contract cannot be activated when conditions are missing.")]
    [Trait("TestCase", "ITC-BF03-010")]
    public async Task ITC_BF03_010()
    {
        await _flow.RequireSimulatedSigningAsync();
        var space = await _flow.NewWorkspaceAsync();
        var roomBefore = await _flow.RoomStatusAsync(space.RoomId);
        var (_, contractId) = await _flow.DraftContractAsync(space.RoomId, deposit: "2000000");
        await _flow.GeneratePreviewAsync(contractId);
        await _flow.SignAsync(contractId, "owner");

        // 1. Activate a contract that is not fully signed.
        using var notSigned = await _flow.ActivateAsync(contractId);
        await PlanAssert.RefusedAsync(notSigned, "not fully signed");
        Assert.NotEmpty(ContractFlow.Strings(await _flow.ReadinessAsync(contractId), "blockers"));

        // 2. Activate a contract whose deposit is not enough.
        await _flow.SignAsync(contractId, "tenant");
        using (var d = await _flow.VerifyDepositAsync(contractId, "IT-REF-" + Guid.NewGuid().ToString("N")[..12], "1000000"))
        {
            await PlanAssert.SuccessAsync(d, "verify a partial deposit");
        }

        using var lowDeposit = await _flow.ActivateAsync(contractId);
        await PlanAssert.RefusedAsync(lowDeposit, "deposit not enough");
        var readiness = await _flow.ReadinessAsync(contractId);

        // 3. Try to activate as a role that is not the Owner.
        using var asStaff = await _flow.ActivateAsync(contractId, "staff");
        using var asTenant = await _flow.ActivateAsync(contractId, "tenant");

        // Expected: each activation is refused and the unresolved conditions are shown. The Room stays as it was.
        await PlanAssert.RefusedAsync(asStaff, "Staff activation");
        await PlanAssert.RefusedAsync(asTenant, "Tenant activation");
        Assert.Equal("false", readiness.Str("ready"));
        Assert.NotEmpty(ContractFlow.Strings(readiness, "blockers"));
        Assert.Equal("1000000", readiness.Str("remainingDeposit"));
        Assert.NotEqual("Active", (await _flow.GetOkAsync($"api/v1/contracts/{contractId}", "owner", "read contract")).Str("status"));
        Assert.Equal(roomBefore, await _flow.RoomStatusAsync(space.RoomId));
    }

    [SkippableFact(DisplayName = "ITC-BF03-011 Test two activations at the same time.")]
    [Trait("TestCase", "ITC-BF03-011")]
    public async Task ITC_BF03_011()
    {
        // Precondition: two contracts ready for the same Room (second contract uses the extra account "tenant2").
        await _flow.RequireSimulatedSigningAsync();
        var space = await _flow.NewWorkspaceAsync();
        var (_, a) = await _flow.DraftContractAsync(space.RoomId, "tenant");
        var (_, b) = await _flow.DraftContractAsync(space.RoomId, "tenant2");
        await _flow.SignBothAsync(a, "tenant");
        await _flow.SignBothAsync(b, "tenant2");

        // 1. Send two activation requests for contracts of the same Room at once.
        var results = await Task.WhenAll(_flow.ActivateAsync(a), _flow.ActivateAsync(b));

        // Expected: exactly one wins. The Room state is not half changed.
        Assert.Equal(1, results.Count(r => r.IsSuccessStatusCode));
        await PlanAssert.RefusedAsync(results.Single(r => !r.IsSuccessStatusCode), "losing activation");
        var statuses = new[]
        {
            (await _flow.GetOkAsync($"api/v1/contracts/{a}", "owner", "contract A")).Str("status"),
            (await _flow.GetOkAsync($"api/v1/contracts/{b}", "owner", "contract B")).Str("status"),
        };
        Assert.Equal(1, statuses.Count(s => s == "Active"));
        var room = await _flow.RoomStatusAsync(space.RoomId);
        Assert.True(ContractFlow.RoomIs(room, "Occupied", 2), $"Room status is '{room}', expected Occupied.");
        foreach (var r in results)
        {
            r.Dispose();
        }
    }

    [SkippableFact(DisplayName = "ITC-BF03-012 Test that one bank reference cannot pay two contracts.")]
    [Trait("TestCase", "ITC-BF03-012")]
    public async Task ITC_BF03_012()
    {
        // Precondition: two contracts waiting for a deposit.
        var space = await _flow.NewWorkspaceAsync();
        var otherRoom = await _flow.CreateRoomAsync(space.LocationId);
        var (_, a) = await _flow.DraftContractAsync(space.RoomId, deposit: "1000000");
        var (_, b) = await _flow.DraftContractAsync(otherRoom, deposit: "1000000");
        var reference = "IT-REF-" + Guid.NewGuid().ToString("N")[..12];

        // 1. Verify a deposit with a bank reference for contract A.
        using var forA = await _flow.VerifyDepositAsync(a, reference, "1000000");
        await PlanAssert.SuccessAsync(forA, "deposit for A");

        // 2. Use the same reference for contract B, also in parallel.
        using var forB = await _flow.VerifyDepositAsync(b, reference, "1000000");
        var parallelReference = "IT-REF-" + Guid.NewGuid().ToString("N")[..12];
        var parallel = await Task.WhenAll(_flow.VerifyDepositAsync(a, parallelReference, "500000"), _flow.VerifyDepositAsync(b, parallelReference, "500000"));

        // Expected: the second use is refused. A bank reference is used only once.
        await PlanAssert.RefusedAsync(forB, "same reference for B");
        Assert.Equal(1, parallel.Count(r => r.IsSuccessStatusCode));
        await PlanAssert.RefusedAsync(parallel.Single(r => !r.IsSuccessStatusCode), "parallel second use");
        var refs = new List<string>();
        foreach (var id in new[] { a, b })
        {
            refs.AddRange((await _flow.GetOkAsync($"api/v1/contracts/{id}/deposit-verifications", "owner", "deposits")).Items().Select(v => v.Str("bankTransactionReference") ?? ""));
        }

        Assert.Equal(1, refs.Count(r => r == reference));
        Assert.Equal(1, refs.Count(r => r == parallelReference));
        foreach (var r in parallel)
        {
            r.Dispose();
        }
    }

    // ================= Move-in Room Handover (UC-17) =================

    [SkippableFact(DisplayName = "ITC-BF03-013 Test the move-in handover with a confirmation by both sides.")]
    [Trait("TestCase", "ITC-BF03-013")]
    public async Task ITC_BF03_013()
    {
        // Precondition: active contract; initial meter readings available.
        var lease = await _flow.ActiveLeaseAsync();
        var c = lease.ContractId;

        // 1. Staff opens the handover and records the condition, assets, keys and meter readings with photos.
        await _flow.GetOkAsync($"api/v1/contracts/{c}/handover/choices", "staff", "Staff opens the handover");
        var photo1 = ContractFlow.Id(await _flow.UploadPngOkAsync(HttpMethod.Post, $"api/v1/contracts/{c}/handover/evidence", "staff", "upload photo"), "photo");
        var v1 = await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/handover", _flow.HandoverBody(0, lease, photo1, "Room in good synthetic condition"), "staff", "Staff records the handover");
        var version1 = int.Parse(v1.Str("version") ?? "0");

        // A Staff outside the Location cannot do it.
        using (var outsider = await _flow.PostKeyedAsync($"api/v1/contracts/{c}/handover", _flow.HandoverBody(version1, lease, photo1, "Outsider change"), "staff2"))
        {
            await PlanAssert.RefusedAsync(outsider, "Staff outside the Location records the handover");
        }

        // 2. The Tenant confirms the same version.
        await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/handover/tenant-confirmation", new { version = version1, note = "Tenant confirms" }, "tenant", "Tenant confirms version 1");

        // A changed version needs a new confirmation.
        var photo2 = ContractFlow.Id(await _flow.UploadPngOkAsync(HttpMethod.Post, $"api/v1/contracts/{c}/handover/evidence", "staff", "upload second photo"), "photo");
        var v2 = await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/handover", _flow.HandoverBody(version1, lease, photo2, "Room condition corrected"), "staff", "Staff changes the handover");
        var version2 = int.Parse(v2.Str("version") ?? "0");
        Assert.NotEqual(version1, version2);
        using (var unconfirmed = await _flow.PostKeyedAsync($"api/v1/contracts/{c}/handover/staff-confirmation", new { version = version2, note = "complete" }, "staff"))
        {
            await PlanAssert.RefusedAsync(unconfirmed, "Staff completes a changed version without a new Tenant confirmation");
        }

        using (var stale = await _flow.PostKeyedAsync($"api/v1/contracts/{c}/handover/tenant-confirmation", new { version = version1, note = "old" }, "tenant"))
        {
            await PlanAssert.RefusedAsync(stale, "Tenant confirms the old version");
        }

        await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/handover/tenant-confirmation", new { version = version2, note = "Tenant confirms again" }, "tenant", "Tenant confirms version 2");

        // 3. Staff completes the handover (only a Staff in the Location can do it).
        using (var outsider = await _flow.PostKeyedAsync($"api/v1/contracts/{c}/handover/staff-confirmation", new { version = version2, note = "outsider" }, "staff2"))
        {
            await PlanAssert.RefusedAsync(outsider, "Staff outside the Location completes the handover");
        }

        await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/handover/staff-confirmation", new { version = version2, note = "Staff completes" }, "staff", "Staff completes the handover");

        // Expected: the handover is stored with the actors, times and evidence.
        var handover = await _flow.GetOkAsync($"api/v1/contracts/{c}/handover", "owner", "read handover");
        Assert.Equal(version2.ToString(), handover.Str("version"));
        Assert.Equal(version2.ToString(), handover.Str("tenantConfirmedVersion"));
        Assert.NotNull(handover.Str("tenantConfirmedAt"));
        Assert.NotNull(handover.Str("staffConfirmedAt"));
        Assert.Contains(photo2, ContractFlow.Strings(handover, "snapshot.evidenceIds"), StringComparer.OrdinalIgnoreCase);
        Assert.NotNull(handover.Str("snapshot.electricity.evidenceHash"));
        var history = (await _flow.GetOkAsync($"api/v1/contracts/{c}/handover/history", "owner", "handover history")).Items();
        var staffId = await _flow.UserIdAsync("staff");
        var tenantId = await _flow.UserIdAsync("tenant");
        Assert.Contains(history, h => string.Equals(h.Str("actorId"), staffId, StringComparison.OrdinalIgnoreCase));
        Assert.Contains(history, h => string.Equals(h.Str("actorId"), tenantId, StringComparison.OrdinalIgnoreCase));
        Assert.All(history, h => Assert.NotNull(h.Str("occurredAt")));
    }

    // ---------- helpers ----------
    private async Task<IReadOnlyList<JsonElement>> ResidentRowsAsync(string locationId, string account)
        => (await _flow.GetOkAsync($"api/v1/capture/locations/{locationId}/residents", account, "list residents")).Items();

    private async Task<JsonElement> ResidentRowAsync(string locationId, string residentId, string account)
        => (await ResidentRowsAsync(locationId, account)).Single(r => string.Equals(r.Str("id"), residentId, StringComparison.OrdinalIgnoreCase));

    /// <summary>Room status 3 = out of use (Postman Simple /77); PUT needs the current version (LOCATION_ROOM_API.md).</summary>
    private async Task CloseRoomAsync(string locationId, string roomId)
    {
        var room = await _flow.GetOkAsync($"api/v1/rooms/{roomId}", "owner", "read Room");
        var body = new { locationId, roomNumber = room.Str("roomNumber"), floor = room.Str("floor"), capacity = int.Parse(room.Str("capacity") ?? "1"), status = 3, version = int.Parse(room.Str("version") ?? "0"), reason = "Synthetic: room out of use" };
        using var r = await Api.PutAsync($"api/v1/rooms/{roomId}", body, await _flow.Token("owner"));
        await PlanAssert.SuccessAsync(r, "Owner sets the Room out of use");
    }
}
