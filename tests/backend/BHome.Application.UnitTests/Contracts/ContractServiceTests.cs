using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.Contracts;

public sealed class ContractServiceTests
{
    [Fact]
    public async Task MainDraftRejectsThreePeopleWhenDatabaseRoomCapacityIsTwo()
    {
        var r = new Rig(); r.Room.Capacity = 2;
        var input = r.Draft with { ResidentIds = [r.Resident.Id, Guid.NewGuid(), Guid.NewGuid()] };
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(input, Guid.NewGuid(), default));
        Assert.Equal("room_capacity_exceeded", error.Code);
        Assert.Empty(r.Contracts); Assert.Empty(r.Operations);
    }
    [Theory]
    [InlineData(false, false, ContractKind.Holding)]
    [InlineData(true, false, ContractKind.Holding)]
    [InlineData(true, true, ContractKind.Holding)]
    [InlineData(false, true, ContractKind.Holding)]
    [InlineData(false, false, ContractKind.Main)]
    [InlineData(true, false, ContractKind.Main)]
    [InlineData(true, true, ContractKind.Main)]
    [InlineData(false, true, ContractKind.Main)]
    [InlineData(false, false, ContractKind.Holding, true)]
    [InlineData(true, true, ContractKind.Holding, true)]
    [InlineData(false, false, ContractKind.Main, true)]
    [InlineData(false, false, ContractKind.Holding, true, true)]
    [InlineData(true, true, ContractKind.Holding, true, true)]
    public async Task BothSigningOrdersKeepInvitationTokenAndEmailStable(bool tenantFirst, bool ownerAlreadyStarted, ContractKind kind, bool resend = false, bool initialDeliveryFails = false)
    {
        var invitations = Substitute.For<IAnonymousSigningRepository>();
        var evidence = Substitute.For<IInternalAcceptanceRenderer>();
        var r = new Rig(signingInvitations: invitations, acceptanceRenderer: evidence);
        var id = kind == ContractKind.Holding
            ? await r.Service.CreateHoldingAsync(r.HoldingDraft with { TenantUserId = null }, Guid.NewGuid(), default)
            : await r.Service.CreateAsync(r.Draft with { TenantUserId = null }, Guid.NewGuid(), default);
        var c = r.Contracts.Single(); var snapshot = c.SnapshotHashOrEmpty;
        var security = Substitute.For<IAnonymousSigningSecurity>();
        var renderer = Substitute.For<IContractDocumentRenderer>();
        var source = Substitute.For<IContractSigningDocumentSource>();
        var rows = new List<ContractSigningInvitation>();
        var objects = new Dictionary<string, byte[]>();
        var raw = "%PDF-1.7 SYNTHETIC REVIEW"u8.ToArray();
        var ownerPdf = "%PDF-1.7 SYNTHETIC OWNER SIGNED"u8.ToArray();
        var tenantPdf = "%PDF-1.7 SYNTHETIC BOTH SIGNED"u8.ToArray();
        string otp = "", emailBody = "", emailAction = "";
        evidence.AppendTenant(default!, default!, default, default, default!).ReturnsForAnyArgs(tenantPdf);
        security.EmailConfigured.Returns(true);
        security.InvitationUrl(Arg.Any<string>()).Returns(call => "https://signing.example.invalid/#token=" + call.Arg<string>());
        security.When(x => x.SendAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), default, Arg.Any<string>()))
            .Do(call =>
            {
                emailBody = call.ArgAt<string>(3);
                emailAction = call.ArgAt<string>(5);
                if (initialDeliveryFails && call.ArgAt<string>(0) == "staff-entered@example.invalid")
                    throw new InvalidOperationException("Synthetic SMTP rejection");
            });
        security.OtpHash(default, default!, default!).ReturnsForAnyArgs(call => { otp = call.ArgAt<string>(2); return "protected:" + otp; });
        source.ReadAsync(default!, default).ReturnsForAnyArgs(_ => ownerAlreadyStarted && tenantFirst
            ? "%PDF-1.7 REGENERATED DIFFERENT BYTES"u8.ToArray() : raw);
        evidence.Accept(default!, default!, default, default, default!, true).ReturnsForAnyArgs(new InternalAcceptedDocument([1, 2, 3], tenantPdf));
        r.Files.PutAsync(default, default!, default!, default!, default).ReturnsForAnyArgs(call =>
        {
            objects[call.ArgAt<string>(1)] = call.ArgAt<byte[]>(2); return Task.CompletedTask;
        });
        r.Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async call =>
            await call.Arg<Stream>().WriteAsync(objects[call.ArgAt<string>(0)]));
        invitations.ListAsync(id.Id, default).Returns(rows);
        invitations.When(x => x.Add(Arg.Any<ContractSigningInvitation>())).Do(call => rows.Add(call.Arg<ContractSigningInvitation>()));
        invitations.FindAsync(Arg.Any<Guid>(), default).Returns(call => rows.SingleOrDefault(x => x.Id == call.Arg<Guid>()));
        invitations.FindByTokenHashAsync(Arg.Any<string>(), default).Returns(call => rows.SingleOrDefault(x => x.TokenHash == call.Arg<string>()));
        r.Repo.InTransactionAsync(default, default(Func<Task<SigningInvitationResult>>)!, default).ReturnsForAnyArgs(call => call.Arg<Func<Task<SigningInvitationResult>>>()());
        r.Repo.InTransactionAsync(default, default(Func<Task<AnonymousSigningAccess?>>)!, default).ReturnsForAnyArgs(call => call.Arg<Func<Task<AnonymousSigningAccess?>>>()());
        var invitationClock = new Clock();
        var service = new AnonymousContractSigningService(r.Repo, invitations, security, evidence, r.User,
            renderer, source, r.Files, r.Storage, invitationClock, Substitute.For<IContractSigningPages>(), r.Service);
        var staff = Guid.NewGuid();
        r.Staff.IsAssignedAsync(default, default, default).ReturnsForAnyArgs(true);
        r.Signing.PrepareAsync(default!, default, default, default(SigningAppearance)!, default).ReturnsForAnyArgs(_ =>
        {
            var bytes = AnonymousContractSigningService.AcceptedEvidence(c) is null ? raw : tenantPdf;
            return new SigningPreparation(bytes, bytes, "field", "digest", "data", "chain", "owner", "credential");
        });
        r.Signing.RequestAsync(default!, default).ReturnsForAnyArgs("synthetic-owner-provider");
        r.Signing.PollAsync(default!, default!, default).ReturnsForAnyArgs(new SigningOutcome("Signed", ownerPdf));
        async Task StartOwner()
        {
            r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
            await r.Service.RequestSigningAsync(id.Id, new(Guid.NewGuid(), Method: SigningMethods.Otp), Guid.NewGuid(), default);
        }
        async Task FinishOwner()
        {
            r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
            await r.Service.SyncSigningAsync(id.Id, default);
        }
        if (ownerAlreadyStarted)
        {
            await StartOwner();
            if (!tenantFirst) await FinishOwner();
        }
        r.User.Role = Roles.Staff; r.User.UserId = staff;
        var input = new SigningInvitationInput(new Clock().GetUtcNow().AddHours(1), snapshot, "staff-entered@example.invalid");
        var representative = (await r.Repo.ResidentsAsync(c.RoomId, [c.RepresentativeResidentId], default)).Single();
        var originalEmail = representative.ContactEmail;
        invitations.IsEmailInUseAsync(id.Id, c.RepresentativeResidentId, "duplicate@example.invalid", default).Returns(true);
        var emailConflict = await Assert.ThrowsAsync<ContractException>(() => service.InviteAsync(id.Id,
            input with { RecipientEmail = " DUPLICATE@EXAMPLE.INVALID " }, default));
        Assert.Equal("signing_email_already_in_use", emailConflict.Code);
        Assert.Empty(rows); Assert.Equal(originalEmail, representative.ContactEmail);
        await security.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default!, default);
        var submitted = await service.InviteAsync(id.Id, input, default);
        Assert.Equal(originalEmail, representative.ContactEmail);
        var tokenHash = rows.Single().TokenHash;
        var retry = await service.InviteAsync(id.Id, input, default);
        Assert.Equal(submitted.Id, retry.Id); Assert.Single(rows);
        Assert.Equal(initialDeliveryFails ? "InvitationPendingManualDelivery" : "InvitationAcceptedByProvider", submitted.Status); Assert.Null(submitted.Token);
        Assert.Equal(1, rows.Single().OtpSendCount);
        await security.Received(1).SendAsync("staff-entered@example.invalid", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), default, Arg.Any<string>());
        r.Repo.Received(1).Audit(staff, kind == ContractKind.Holding ? "HoldingSigningSubmitted" : "MainSigningSubmitted", id.Id, Arg.Any<DateTimeOffset>());
        if (resend)
        {
            var originalHash = rows.Single().DocumentHash;
            var originalToken = System.Text.RegularExpressions.Regex.Match(emailAction, "[A-F0-9]{64}").Value;
            var otpBefore = System.Text.RegularExpressions.Regex.Match(emailBody, @"Mã OTP của bạn: (\d{6})").Groups[1].Value;
            await service.VerifyOtpAsync(new(originalToken, otpBefore), default);
            Assert.NotNull(rows.Single().SessionHash);
            var resendInput = input with { Resend = true };
            var blockedResend = await Assert.ThrowsAsync<ContractException>(() => service.InviteAsync(id.Id,
                resendInput with { RecipientEmail = "duplicate@example.invalid" }, default));
            Assert.Equal("signing_email_already_in_use", blockedResend.Code);
            Assert.Equal(tokenHash, rows.Single().TokenHash); Assert.NotNull(rows.Single().SessionHash);
            Assert.Equal(input.RecipientEmail, rows.Single().RecipientEmail);
            var throttled = await Assert.ThrowsAsync<ContractException>(() => service.InviteAsync(id.Id, resendInput, default));
            Assert.Equal(429, throttled.Status);
            Assert.Equal(tokenHash, rows.Single().TokenHash);
            invitationClock.Now = invitationClock.Now.AddSeconds(61);
            var mismatched = await Assert.ThrowsAsync<ContractException>(() => service.InviteAsync(id.Id,
                resendInput with { RecipientEmail = "invalid-email" }, default));
            Assert.Equal("signing_contacts_required", mismatched.Code);
            resendInput = resendInput with { RecipientEmail = "corrected@example.invalid" };
            var resent = await service.InviteAsync(id.Id, resendInput, default);
            Assert.Equal("corrected@example.invalid", rows.Single(row => row.RevokedAt is null).RecipientEmail);
            Assert.Equal(originalEmail, representative.ContactEmail);
            input = input with { RecipientEmail = "corrected@example.invalid" };
            Assert.NotEqual(submitted.Id, resent.Id); Assert.Null(resent.Token);
            Assert.Equal(2, rows.Count);
            var revoked = rows.Single(row => row.Id == submitted.Id);
            Assert.NotNull(revoked.RevokedAt); Assert.Null(revoked.OtpHash); Assert.Null(revoked.SessionHash);
            Assert.NotEqual(tokenHash, rows.Single(row => row.RevokedAt is null).TokenHash); Assert.Null(rows.Single(row => row.RevokedAt is null).SessionHash);
            Assert.Equal(originalHash, rows.Single(row => row.RevokedAt is null).DocumentHash);
            Assert.Equal(input.ExpiresAt, rows.Single(row => row.RevokedAt is null).ExpiresAt);
            Assert.Equal(1, rows.Single(row => row.RevokedAt is null).OtpSendCount);
            await Assert.ThrowsAsync<ContractException>(() => service.InfoAsync(originalToken, default));
            tokenHash = rows.Single(row => row.RevokedAt is null).TokenHash;
            await service.InviteAsync(id.Id, input, default);
            Assert.Equal(tokenHash, rows.Single(row => row.RevokedAt is null).TokenHash);
            var count = rows.Single(row => row.RevokedAt is null).OtpSendCount;
            rows.Single(row => row.RevokedAt is null).OtpSendCount = 5;
            invitationClock.Now = invitationClock.Now.AddSeconds(61);
            var limited = await Assert.ThrowsAsync<ContractException>(() => service.InviteAsync(id.Id, resendInput, default));
            Assert.Equal(429, limited.Status);
            rows.Single(row => row.RevokedAt is null).OtpSendCount = count;
            await security.Received(1).SendAsync("corrected@example.invalid", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), default, Arg.Any<string>());
            r.Repo.Received(1).Audit(staff, kind == ContractKind.Holding ? "HoldingSigningSubmitted" : "MainSigningSubmitted", id.Id, Arg.Any<DateTimeOffset>());
        }
        if (!tenantFirst && !ownerAlreadyStarted) { await StartOwner(); await FinishOwner(); }
        if (!tenantFirst)
        {
            r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
            using var reviewedOwnerPdf = new MemoryStream();
            await r.Service.CopyDocumentAsync(id.Id, reviewedOwnerPdf, default);
            Assert.Equal(ownerPdf, reviewedOwnerPdf.ToArray());
            await service.DispatchHoldingInvitationAsync(id.Id, default);
            Assert.Equal(tokenHash, rows.Single(row => row.RevokedAt is null).TokenHash);
            Assert.Equal(1, rows.Single(row => row.RevokedAt is null).OtpSendCount);
        }
        var invite = rows.Single(row => row.RevokedAt is null); var token = System.Text.RegularExpressions.Regex.Match(emailAction, "[A-F0-9]{64}").Value;
        Assert.DoesNotContain(token, emailBody);
        Assert.Equal(64, token.Length);
        var deliveredOtp = System.Text.RegularExpressions.Regex.Match(emailBody, @"Mã OTP của bạn: (\d{6})").Groups[1].Value;
        var access = await service.VerifyOtpAsync(new(token, deliveredOtp), default);
        invitations.IsEmailInUseAsync(c.Id, c.RepresentativeResidentId, invite.RecipientEmail, default).Returns(true);
        var blockedAcceptance = await Assert.ThrowsAsync<ContractException>(() => service.AcceptAsync(new(token, access.Session,
            access.DocumentHash, access.ConsentVersion, true, [[new(.1, .1), new(.8, .8)]]), default));
        Assert.Equal("signing_email_already_in_use", blockedAcceptance.Code);
        Assert.Null(invite.AcceptedAt); Assert.Equal(originalEmail, representative.ContactEmail);
        invitations.IsEmailInUseAsync(c.Id, c.RepresentativeResidentId, invite.RecipientEmail, default).Returns(false);
        await service.AcceptAsync(new(token, access.Session, access.DocumentHash, access.ConsentVersion, true, [[new(.1, .1), new(.8, .8)]]), default);
        Assert.Equal(resend ? "corrected@example.invalid" : "staff-entered@example.invalid", representative.ContactEmail);
        if (tenantFirst)
        {
            Assert.False(AnonymousContractSigningService.Complete(c));
            Assert.Equal(ContractStatus.PendingSigning, c.Status);
            if (!ownerAlreadyStarted) await StartOwner();
            await FinishOwner();
        }
        await security.Received(1).SendAsync("staff-entered@example.invalid", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), default, Arg.Any<string>());
        Assert.Equal(resend ? 2 : 1, rows.Count);
        Assert.Single(rows, row => row.RevokedAt is null);
        Assert.Equal(tokenHash, invite.TokenHash);
        Assert.Equal(ContractStatus.PendingActivation, c.Status);
        Assert.True(AnonymousContractSigningService.Complete(c));
        Assert.Equal(snapshot, c.SnapshotHashOrEmpty); Assert.Null(c.ApprovedAt); Assert.Null(c.ApprovedByUserId);
        Assert.Equal(ContractSigningModes.Internal, c.SigningMode);
        var accepted = AnonymousContractSigningService.AcceptedEvidence(c)!;
        Assert.Equal(c.OwnerSignerId, accepted.OwnerId);
        Assert.NotNull(accepted.FinalDocumentHash);
        if (resend)
        {
            var signedEvidence = c.InternalAcceptance;
            r.User.Role = Roles.Staff; r.User.UserId = staff;
            await Assert.ThrowsAsync<ContractException>(() => service.InviteAsync(id.Id, input with { Resend = true }, default));
            Assert.Equal(signedEvidence, c.InternalAcceptance);
            await security.Received(1).SendAsync("corrected@example.invalid", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), default, Arg.Any<string>());
        }
        if (!tenantFirst)
            evidence.Received(1).Accept(Arg.Is<byte[]>(x => x.SequenceEqual(ownerPdf)), Arg.Any<DrawnPoint[][]>(), c.RepresentativeResidentId,
                Arg.Any<DateTimeOffset>(), invite.DocumentHash, true);
        if (tenantFirst && ownerAlreadyStarted)
            evidence.Received(1).AppendTenant(Arg.Is<byte[]>(x => x.SequenceEqual(ownerPdf)), Arg.Any<byte[]>(),
                c.RepresentativeResidentId, accepted.AcceptedAt, invite.DocumentHash);

    }

    [Theory]
    [InlineData(Roles.Owner)]
    [InlineData(Roles.Tenant)]
    public async Task EitherHoldingSignerCanSignFirstWithoutApprovalAndPreservesModeAndSnapshot(string role)
    {
        var r = new Rig();
        var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        var c = r.Contracts.Single();
        var snapshot = c.SnapshotHashOrEmpty;
        var mode = c.SigningMode;
        r.User.Role = role; r.User.UserId = role == Roles.Owner ? c.OwnerSignerId : r.Tenant;
        var pdf = "%PDF-1.7 SYNTHETIC HOLDING"u8.ToArray();
        r.Signing.PrepareAsync(default!, default, default, default(SigningAppearance)!, default).ReturnsForAnyArgs(new SigningPreparation(
            pdf, pdf, "field", "digest", "data", "chain", "owner", "credential"));
        r.Signing.RequestAsync(default!, default).ReturnsForAnyArgs("synthetic-provider");
        r.Signing.PollAsync(default!, default!, default).ReturnsForAnyArgs(new SigningOutcome("Signed", pdf));
        r.Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async x => await x.Arg<Stream>().WriteAsync(pdf));
        var input = new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp); var key = Guid.NewGuid();
        var requested = await r.Service.RequestSigningAsync(id.Id, input, key, default);
        await r.Service.SyncSigningAsync(id.Id, default);
        var replay = await r.Service.RequestSigningAsync(id.Id, input, key, default);
        Assert.Equal(requested.Id, replay.Id);
        Assert.Single(c.Signatures);
        Assert.Equal(SignatureStatus.Signed, c.Signatures.Single().Status);
        Assert.Null(c.ApprovedAt); Assert.Null(c.ApprovedByUserId);
        Assert.Equal(snapshot, c.SnapshotHashOrEmpty); Assert.Equal(mode, c.SigningMode);
        Assert.Equal(ContractStatus.PendingSigning, c.Status);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
        await r.Signing.Received(1).RequestAsync(Arg.Any<ContractSigning>(), default);
        r.User.Role = role == Roles.Owner ? Roles.Tenant : Roles.Owner;
        r.User.UserId = role == Roles.Owner ? r.Tenant : c.OwnerSignerId;
        await r.Service.RequestSigningAsync(id.Id, new(Guid.NewGuid(), Method: SigningMethods.Otp), Guid.NewGuid(), default);
        await r.Service.SyncSigningAsync(id.Id, default);
        Assert.Equal(2, c.Signatures.Count);
        Assert.All(c.Signatures, s => Assert.Equal(SignatureStatus.Signed, s.Status));
        Assert.Equal(ContractStatus.PendingActivation, c.Status);
        Assert.Equal(snapshot, c.SnapshotHashOrEmpty); Assert.Equal(mode, c.SigningMode);
        Assert.Null(c.ApprovedAt); Assert.Equal(RoomStatus.Available, r.Room.Status);
    }

    [Fact]
    public async Task HoldingCanActivateWithoutApprovalAfterBothSignaturesAndVerifiedDeposit()
    {
        var r = new Rig();
        var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        var c = r.Contracts.Single(); c.Status = ContractStatus.PendingActivation;
        var pdf = "%PDF-1.7 SYNTHETIC SIGNED"u8.ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(pdf));
        foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId!.Value }) c.Signatures.Add(new ContractSigning
        {
            ContractId = id.Id,
            SignerUserId = signer,
            Status = SignatureStatus.Signed,
            SnapshotHash = c.SnapshotHashOrEmpty,
            SignedObjectKey = "synthetic-signed",
            SignedHash = hash,
            ProviderReference = "synthetic",
            SignedAt = new Clock().GetUtcNow()
        });
        r.Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async x => await x.Arg<Stream>().WriteAsync(pdf));
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-NO-APPROVAL", c.RequiredDeposit, "Synthetic bank statement"), Guid.NewGuid(), default);
        Assert.True((await r.Service.ReadinessAsync(id.Id, default)).Ready);
        var key = Guid.NewGuid();
        await r.Service.ActivateHoldingAsync(id.Id, key, default);
        await r.Service.ActivateHoldingAsync(id.Id, key, default);
        await r.Service.AutoActivatePaidMainAsync(id.Id, default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.OnHold, r.Room.Status);
        Assert.Equal(2, r.Room.Version); Assert.Null(c.ApprovedAt); Assert.Null(c.ApprovedByUserId);
    }

    [Fact]
    public async Task HoldingPreparationUsesOneMonthOfRentAndLocationTermWithVietnamMidnightExpiry()
    {
        var rig = new Rig();
        rig.Settings.GetForLocationAsync(rig.Room.LocationId, default).ReturnsForAnyArgs(new HoldingSettings(Guid.NewGuid(), 1, 1m, "Owner configured terms", 3, DateTimeOffset.UtcNow, Guid.NewGuid()));
        var result = await rig.Service.HoldingPreparationAsync(rig.Room.Id, default);
        Assert.Equal(Today, result.StartDate); Assert.Equal(Today.AddMonths(1), result.EndDate);
        Assert.Equal(new DateTimeOffset(Today.AddMonths(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime(), result.ExpiresAt);
        Assert.Equal(3000000, result.HoldingDeposit); Assert.Equal(3000000, result.MonthlyRent);
        Assert.Equal(1, result.HoldingMonths);
        Assert.Equal(3, result.SettingsVersion);
    }
    [Fact]
    public async Task HoldingPreparationDoesNotInventMissingLocationConfiguration()
    {
        var rig = new Rig();
        rig.Settings.GetForLocationAsync(rig.Room.LocationId, default).ReturnsForAnyArgs((HoldingSettings?)null);
        var error = await Assert.ThrowsAsync<ContractException>(() => rig.Service.HoldingPreparationAsync(rig.Room.Id, default));
        Assert.Equal("holding_settings_required", error.Code);
    }
    [Fact]
    public async Task HoldingCreationCannotBypassMissingOrStaleGlobalPolicy()
    {
        var rig = new Rig();
        rig.Settings.GetForLocationAsync(rig.Room.LocationId, default).ReturnsForAnyArgs((HoldingSettings?)null);
        var missing = await Assert.ThrowsAsync<ContractException>(() => rig.Service.CreateHoldingAsync(rig.HoldingDraft, Guid.NewGuid(), default));
        Assert.Equal("holding_settings_required", missing.Code);
        rig.Settings.GetForLocationAsync(rig.Room.LocationId, default).ReturnsForAnyArgs(
            new HoldingSettings(Guid.NewGuid(), 1, 1m, "Synthetic Holding terms", 3, DateTimeOffset.UtcNow, Guid.NewGuid()));
        var stale = await Assert.ThrowsAsync<ContractException>(() => rig.Service.CreateHoldingAsync(rig.HoldingDraft with { SettingsVersion = null }, Guid.NewGuid(), default));
        Assert.Equal("holding_configuration_changed_reload", stale.Code);
        Assert.Empty(rig.Contracts);
    }
    [Fact]
    public async Task HoldingMetadataDoesNotTurnItsDetailIntoMainOnboarding()
    {
        var rig = new Rig();
        var id = await rig.Service.CreateHoldingAsync(rig.HoldingDraft, Guid.NewGuid(), default);
        var holding = rig.Contracts.Single();
        holding.DraftMetadata = "{\"holdingNote\":\"synthetic\"}";
        var detail = await rig.Service.GetAsync(id.Id, default);
        Assert.Equal("Holding", detail.Kind);
        Assert.False(detail.OnboardingDraft);
        Assert.Equal(3000000, detail.RequiredDeposit);
    }
    [Fact]
    public async Task HoldingReadinessRequiresSignaturesInsteadOfSeparateApprovalOrMainRules()
    {
        var rig = new Rig();
        var id = await rig.Service.CreateHoldingAsync(rig.HoldingDraft, Guid.NewGuid(), default);
        var result = await rig.Service.ReadinessAsync(id.Id, default);
        Assert.False(result.Ready);
        Assert.DoesNotContain("holding_owner_approval_required", result.Blockers);
        Assert.Contains("verified_signature_evidence_required", result.Blockers);
        Assert.DoesNotContain("main_contract_required", result.Blockers);
    }
    private static readonly DateOnly Today = new(2026, 10, 29);
    private sealed class Clock : TimeProvider { public DateTimeOffset Now { get; set; } = new(2026, 10, 29, 8, 0, 0, TimeSpan.Zero); public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class User : ICurrentUser
    {
        public Guid? UserId { get; set; } = Guid.NewGuid(); public string Role { get; set; } = Roles.Owner;
        public bool IsInRole(string role) => role == Role;
    }
    private sealed class Rig
    {
        public readonly BHome.Application.PaymentsDebt.IMainInitialPaymentLedger InitialPayments = Substitute.For<BHome.Application.PaymentsDebt.IMainInitialPaymentLedger>();
        public readonly User User = new();
        public readonly IContractRepository Repo = Substitute.For<IContractRepository>();
        public readonly IStaffLocationAccess Staff = Substitute.For<IStaffLocationAccess>();
        public readonly IContractSigningProvider Signing = Substitute.For<IContractSigningProvider>();
        public readonly IContractSigningMethods SigningMethodsConfig = Substitute.For<IContractSigningMethods>();
        public readonly IObjectStorage Storage = Substitute.For<IObjectStorage>();
        public readonly IContractFileStore Files = Substitute.For<IContractFileStore>();
        public readonly IContractImageValidator Images = Substitute.For<IContractImageValidator>();
        public readonly IContractSettlementLedger Ledger = Substitute.For<IContractSettlementLedger>();
        public readonly IContractHoldingLedger Holdings = Substitute.For<IContractHoldingLedger>();
        public readonly IContractHandoverRepository Handovers = Substitute.For<IContractHandoverRepository>();
        public readonly IContractDepositPosition Positions = Substitute.For<IContractDepositPosition>();
        public readonly IHoldingSettingsData Settings = Substitute.For<IHoldingSettingsData>();
        public readonly List<Contract> Contracts = [];
        public readonly List<ContractMoveOut> Moves = [];
        public readonly List<ContractMoveOutHistory> MoveHistory = [];
        public readonly List<ContractOperation> Operations = [];
        public readonly List<DepositVerification> Deposits = [];
        public readonly Resident Resident = new() { VerificationStatus = IdentityVerificationStatus.Verified };
        public readonly Room Room = new() { Location = new Location("Synthetic"), Status = RoomStatus.Available };
        public Guid Owner => Contracts[0].OwnerSignerId;
        public Guid Tenant { get; } = Guid.NewGuid();
        public ContractService Service { get; }
        public Rig(bool withInitialPayments = true, IAnonymousSigningRepository? signingInvitations = null, IInternalAcceptanceRenderer? acceptanceRenderer = null, IContractWorkflowRepository? workflowRepository = null, IHandoverInventory? inventory = null, TimeProvider? clock = null)
        {
            Room.LocationId = Room.Location.Id; Resident.RoomId = Room.Id;
            Repo.RoomAsync(Room.Id, default).ReturnsForAnyArgs(Room);
            Repo.ResidentsAsync(default, default!, default).ReturnsForAnyArgs(new[] { Resident });
            Repo.ActiveUserInRoleAsync(default, default!, default).ReturnsForAnyArgs(true);
            Repo.FindAsync(default, default).ReturnsForAnyArgs(c => Contracts.SingleOrDefault(x => x.Id == c.Arg<Guid>()));
            Repo.MoveOutAsync(default, default).ReturnsForAnyArgs(c => Moves.SingleOrDefault(x => x.ContractId == c.Arg<Guid>()));
            Repo.RoomActiveContractsAsync(default, default).ReturnsForAnyArgs(c => Contracts.Where(x => x.RoomId == c.Arg<Guid>() && x.Status == ContractStatus.Active && x.Kind is ContractKind.Main or ContractKind.Renewal).ToArray());
            Repo.MoveOutHistoryAsync(default, default).ReturnsForAnyArgs(c => MoveHistory.Where(x => x.ContractId == c.Arg<Guid>()).OrderByDescending(x => x.Version).ToArray());
            Repo.DepositTotalAsync(default, default).ReturnsForAnyArgs(c => Deposits.Where(d => d.ContractId == c.Arg<Guid>()).Sum(d => d.Amount));
            Repo.BankReferenceAsync(default!, default).ReturnsForAnyArgs(c => Deposits.SingleOrDefault(d => d.BankTransactionReference == c.Arg<string>()));
            Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(Room.Id, Today,
                [new PolicyDto(Guid.NewGuid(), Room.LocationId, Room.Id, ChargeCategory.Rent, "RENT", "Rent",
                    ChargingMethod.FixedPerRoomPerMonth, 3000000, Today.AddMonths(-1), null, 1),
                 new PolicyDto(Guid.NewGuid(), Room.LocationId, Room.Id, ChargeCategory.Electricity, "ELECTRICITY", "Electricity",
                    ChargingMethod.Metered, 3500, Today.AddMonths(-1), null, 1),
                 new PolicyDto(Guid.NewGuid(), Room.LocationId, Room.Id, ChargeCategory.Water, "WATER", "Water",
                    ChargingMethod.Metered, 15000, Today.AddMonths(-1), null, 1),
                 new PolicyDto(Guid.NewGuid(), Room.LocationId, Room.Id, ChargeCategory.ServiceFee, "INTERNET", "Internet",
                    ChargingMethod.FixedPerRoomPerMonth, 100000, Today.AddMonths(-1), null, 1)], []));
            Settings.GetForLocationAsync(Room.LocationId, default).ReturnsForAnyArgs(
                new HoldingSettings(Guid.NewGuid(), 1, 1m, "Synthetic Holding terms", 3, DateTimeOffset.UtcNow, Guid.NewGuid()));
            Repo.BindingContractsAsync(default, default, default, default, default).ReturnsForAnyArgs(Array.Empty<Contract>());
            Repo.MainForHoldingAsync(default, default).ReturnsForAnyArgs(c => Contracts.SingleOrDefault(x => x.HoldingContractId == c.Arg<Guid>()));
            Repo.OperationAsync(default, default, default!, default).ReturnsForAnyArgs(c => Operations.SingleOrDefault(o => o.ActorId == c.ArgAt<Guid>(0) && o.Key == c.ArgAt<Guid>(1) && o.Operation == c.Arg<string>()));
            Repo.InTransactionAsync(default, default(Func<Task<ContractId>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<ContractId>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<ContractView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<ContractView>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<MoveOutView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<MoveOutView>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<bool>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<bool>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<Guid>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<Guid>>>()());
            Repo.When(r => r.Add(Arg.Any<object>())).Do(c =>
            {
                switch (c.Arg<object>())
                {
                    case Contract x: x.Room = Room; Contracts.Add(x); break;
                    case ContractMoveOut x: Moves.Add(x); break;
                    case ContractMoveOutHistory x: MoveHistory.Add(x); break;
                    case ContractOperation x: Operations.Add(x); break;
                    case DepositVerification x: Deposits.Add(x); break;
                    case ContractSigning x: Contracts.Single(a => a.Id == x.ContractId).Signatures.Add(x); break;
                }
            });
            Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(Task.FromException<HoldingDepositApplication>(new IntegrationUnavailableException("holding ledger")));
            Positions.ReadAsync(default!, default, default!).ReturnsForAnyArgs(call => (DepositLedgerPosition?)new(Deposits.Where(d => call.Arg<Guid[]>().Contains(d.ContractId)).Sum(d => d.Amount), 0, 0, 0));
            SigningMethodsConfig.IsEnabled(SigningMethods.Otp).Returns(true);
            Service = new(Repo, User, new ResourceAccess(User, Staff), Signing, Storage, Files, Images, Ledger, Holdings, clock ?? new Clock(), workflowRepository: workflowRepository, handoverRepository: Handovers, handoverInventory: inventory, depositPositions: Positions, holdingSettings: Settings, initialPayments: withInitialPayments ? InitialPayments : null, signingInvitations: signingInvitations, acceptanceRenderer: acceptanceRenderer, signingMethods: SigningMethodsConfig);
        }
        public ContractDraftInput Draft => new(Room.Id, User.UserId!.Value, Tenant, Resident.Id, [Resident.Id], Today.AddDays(-10), Today.AddDays(30), 3000000, 3000000, "Synthetic approved terms");
        public HoldingDraftInput HoldingDraft => new(Room.Id, User.UserId!.Value, Tenant, Resident.Id, [Resident.Id],
            Today, Today.AddMonths(1), new DateTimeOffset(Today.AddMonths(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime(),
            3000000, "Synthetic Holding terms", 1, 3);
        public async Task<Contract> Create()
        { var id = await Service.CreateAsync(Draft, Guid.NewGuid(), default); return Contracts.Single(c => c.Id == id.Id); }
        public async Task<Contract> Ready()
        {
            var c = await Create(); c.Status = ContractStatus.PendingActivation;
            var bytes = Encoding.UTF8.GetBytes("TEST ONLY verified PDF boundary"); var hash = Convert.ToHexString(SHA256.HashData(bytes));
            foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId ?? throw new InvalidOperationException("Signing fixture requires an existing Tenant account.") }) c.Signatures.Add(new ContractSigning
            {
                ContractId = c.Id,
                SignerUserId = signer,
                Status = SignatureStatus.Signed,
                SnapshotHash = c.SnapshotHashOrEmpty,
                SignedObjectKey = "test-private-key",
                SignedHash = hash,
                ProviderReference = Guid.NewGuid().ToString(),
                SignedAt = DateTimeOffset.UtcNow
            });
            Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async x => await x.Arg<Stream>().WriteAsync(bytes));
            Deposits.Add(new DepositVerification { ContractId = c.Id, Amount = c.RequiredDeposit }); return c;
        }
    }

    [Theory]
    [InlineData(ContractKind.Main, ContractStatus.Draft, true, true)]
    [InlineData(ContractKind.Main, ContractStatus.PendingSigning, true, true)]
    [InlineData(ContractKind.Main, ContractStatus.Active, true, false)]
    [InlineData(ContractKind.Holding, ContractStatus.Draft, true, false)]
    [InlineData(ContractKind.Renewal, ContractStatus.Draft, true, false)]
    [InlineData(ContractKind.Main, ContractStatus.Draft, false, false)]
    public async Task StaffPreviewIsScopedToAssignedMainPreparationAndCurrentSnapshot(ContractKind kind, ContractStatus status, bool assigned, bool allowed)
    {
        var workflow = Substitute.For<IContractWorkflowRepository>(); var r = new Rig(workflowRepository: workflow);
        r.Repo.InTransactionAsync(default, default(Func<Task<ContractDocumentView>>)!, default).ReturnsForAnyArgs(call => call.Arg<Func<Task<ContractDocumentView>>>()());
        var id = await r.Service.CreateAsync(r.Draft, Guid.NewGuid(), default);
        var c = r.Contracts.Single(); c.Kind = kind; c.Status = status;
        r.User.Role = Roles.Staff; r.User.UserId = Guid.NewGuid();
        r.Staff.IsAssignedAsync(default, default, default).ReturnsForAnyArgs(assigned);
        var bytes = "%PDF-1.7 SYNTHETIC PREVIEW"u8.ToArray();
        var file = new ContractDocumentFile
        {
            ContractId = c.Id,
            Kind = ContractFileKind.Preview,
            SnapshotHash = c.SnapshotHashOrEmpty,
            ObjectKey = "synthetic-preview",
            Length = bytes.Length,
            FileHash = Convert.ToHexString(SHA256.HashData(bytes))
        };
        var old = new ContractDocumentFile { ContractId = c.Id, Kind = ContractFileKind.Preview, SnapshotHash = "OLD" };
        workflow.FilesAsync(c.Id, ContractFileKind.Preview, default).Returns(new[] { file, old });
        workflow.FileAsync(c.Id, file.Id, default).Returns(file); workflow.FileAsync(c.Id, old.Id, default).Returns(old);
        r.Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async call => await call.Arg<Stream>().WriteAsync(bytes));
        using var output = new MemoryStream();
        if (allowed)
        {
            Assert.Equal(file.Id, Assert.Single(await r.Service.PreviewDocumentsAsync(c.Id, default)).Id);
            await r.Service.CopyPreviewAsync(c.Id, file.Id, output, default); Assert.Equal(bytes, output.ToArray());
            var stale = await Assert.ThrowsAsync<ContractException>(() => r.Service.CopyPreviewAsync(c.Id, old.Id, Stream.Null, default));
            Assert.Equal("signed_terms_changed", stale.Code);
        }
        else
        {
            await Assert.ThrowsAsync<ContractException>(() => r.Service.PreviewDocumentsAsync(c.Id, default));
            await Assert.ThrowsAsync<ContractException>(() => r.Service.CopyPreviewAsync(c.Id, file.Id, output, default));
            await Assert.ThrowsAsync<ContractException>(() => r.Service.GeneratePreviewAsync(c.Id, Guid.NewGuid(), default));
            Assert.Empty(output.ToArray()); await r.Storage.DidNotReceiveWithAnyArgs().CopyToAsync(default!, default!, default);
        }
    }

    [Fact]
    public async Task MainDraftSealsAgreedRentAndAllRoomChargesAgainstLaterPolicyChanges()
    {
        var r = new Rig();
        var id = await r.Service.CreateAsync(r.Draft with { MonthlyRent = 3200000 }, Guid.NewGuid(), default);
        var contract = r.Contracts.Single();
        var snapshot = ContractChargeSnapshot.Read(contract);
        Assert.Equal(1, snapshot.SnapshotVersion);
        Assert.Equal(3200000, snapshot.Charges.Single(c => c.ChargeCode == "RENT").Rate);
        Assert.Equal(3500, snapshot.Charges.Single(c => c.ChargeCode == "ELECTRICITY").Rate);
        Assert.Equal(15000, snapshot.Charges.Single(c => c.ChargeCode == "WATER").Rate);
        Assert.Equal(100000, snapshot.Charges.Single(c => c.ChargeCode == "INTERNET").Rate);
        Assert.True(ContractChargeSnapshot.IsIntact(contract));
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today, [], []));
        var view = await r.Service.GetAsync(id.Id, default);
        Assert.Equal(snapshot.Charges, view.AgreedCharges);
        contract.AgreedPriceSnapshot = JsonSerializer.Serialize(snapshot with
        {
            Charges = snapshot.Charges.Select(c => c.ChargeCode == "INTERNET" ? c with { Rate = 999999 } : c).ToArray()
        });
        Assert.False(ContractChargeSnapshot.IsIntact(contract));
        Assert.Contains("signed_terms_changed", (await r.Service.ReadinessAsync(contract.Id, default)).Blockers);
    }

    [Fact]
    public async Task BindingRejectsIncompleteOrDifferentOverlappingCharges()
    {
        var r = new Rig(); var original = await r.Ready(); original.Status = ContractStatus.Active;
        var next = await r.Service.CreateAsync(r.Draft with { MonthlyRent = 4000000 }, Guid.NewGuid(), default);
        r.Repo.BindingContractsAsync(default, default, default, default, default).ReturnsForAnyArgs(new[] { original });
        var readiness = await r.Service.ReadinessAsync(next.Id, default);
        Assert.Contains("room_contract_price_conflict", readiness.Blockers);
        var draft = r.Contracts.Single(c => c.Id == next.Id);
        var snapshot = ContractChargeSnapshot.Read(draft);
        draft.AgreedPriceSnapshot = JsonSerializer.Serialize(snapshot with { Charges = snapshot.Charges.Where(c => c.ChargeCode != "WATER").ToArray() });
        Assert.Contains("missing_policy_water", (await r.Service.ReadinessAsync(next.Id, default)).Blockers);
    }

    [Fact]
    public async Task HoldingDraftRejectsMultipleResidents()
    {
        var r = new Rig();
        var input = r.HoldingDraft with { ResidentIds = [r.Resident.Id, Guid.NewGuid()] };
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateHoldingAsync(input, Guid.NewGuid(), default));
        Assert.Equal(400, error.Status);
        Assert.Empty(r.Contracts);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
    }

    [Theory]
    [InlineData("3000000")]
    [InlineData("3000000.000000")]
    public async Task HoldingDraftUsesResolvedRentAndDoesNotReserveRoom(string rate)
    {
        var r = new Rig();
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today,
            [new PolicyDto(Guid.NewGuid(), r.Room.LocationId, r.Room.Id, ChargeCategory.Rent, "RENT", "Rent",
                ChargingMethod.FixedPerRoomPerMonth, decimal.Parse(rate, System.Globalization.CultureInfo.InvariantCulture), Today, null, 1)], []));
        var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        var holding = Assert.Single(r.Contracts, c => c.Id == id.Id);
        Assert.Equal(ContractKind.Holding, holding.Kind);
        Assert.Equal(3000000, holding.RentAmount);
        Assert.Equal(ContractStatus.Draft, holding.Status);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
        Assert.Null(holding.ApprovedAt);
        var persistedDocument = new ContractDocument(holding.Id, holding.RoomId, holding.OwnerSignerId, holding.TenantUserId!.Value,
            holding.RepresentativeResidentId, holding.Residents.Select(x => x.ResidentId).Order().ToArray(), holding.StartDate, holding.EndDate,
            decimal.Truncate(holding.RentAmount), decimal.Truncate(holding.RequiredDeposit), holding.HoldingContractId,
            holding.AppliedHoldingDeposit, holding.Terms, holding.SnapshotHashOrEmpty)
        { AgreedCharges = ContractChargeSnapshot.Read(holding).Charges };
        Assert.Equal(holding.SnapshotHashOrEmpty, ContractDocumentSnapshot.Hash(persistedDocument));
    }

    [Theory]
    [InlineData("3000000.5")]
    [InlineData("-1")]
    [InlineData("0")]
    public async Task HoldingDraftRejectsInvalidRentInsteadOfTruncatingIt(string rate)
    {
        var r = new Rig();
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today,
            [new PolicyDto(Guid.NewGuid(), r.Room.LocationId, r.Room.Id, ChargeCategory.Rent, "RENT", "Rent",
                ChargingMethod.FixedPerRoomPerMonth, decimal.Parse(rate, System.Globalization.CultureInfo.InvariantCulture), Today, null, 1)], []));
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default));
        Assert.Equal("invalid_vnd_amount", error.Code);
        Assert.Empty(r.Contracts);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
    }

    [Fact]
    public async Task HoldingDepositLocksApprovedPriceOnlyOnce()
    {
        var r = new Rig(); var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        await r.Service.ApproveHoldingAsync(id.Id, new("Owner approved reviewed terms"), Guid.NewGuid(), default);
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-ONE", 1000000, "Verified bank statement"), Guid.NewGuid(), default);
        var holding = r.Contracts.Single(); Assert.Null(holding.PriceLockedAt);
        foreach (var signer in new[] { holding.OwnerSignerId, holding.TenantUserId!.Value }) holding.Signatures.Add(new ContractSigning
        {
            ContractId = holding.Id,
            SignerUserId = signer,
            Status = SignatureStatus.Signed,
            SnapshotHash = holding.SnapshotHashOrEmpty,
            SignedObjectKey = "synthetic-signed",
            SignedHash = "synthetic-hash",
            ProviderReference = "synthetic-provider",
            SignedAt = new Clock().GetUtcNow()
        });
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today,
            [new PolicyDto(Guid.NewGuid(), r.Room.LocationId, r.Room.Id, ChargeCategory.Rent, "RENT", "Changed",
                ChargingMethod.FixedPerRoomPerMonth, 9000000, Today, null, 2)], []));
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-TWO", 2000000, "Verified bank statement"), Guid.NewGuid(), default);
        Assert.Equal("SigningAndDepositCompleted", holding.PriceLockTrigger); Assert.NotNull(holding.PriceLockedAt);
        var locked = holding.AgreedPriceSnapshot; var lockedAt = holding.PriceLockedAt;
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-TWO", 2000000, "Verified bank statement"), Guid.NewGuid(), default);
        Assert.Equal(lockedAt, holding.PriceLockedAt); Assert.Equal(locked, holding.AgreedPriceSnapshot);
    }

    [Fact]
    public async Task FullySatisfiedHoldingActivatesOnHoldAndCancellationReleasesIt()
    {
        var r = new Rig(); var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        await r.Service.ApproveHoldingAsync(id.Id, new("Owner approved reviewed terms"), Guid.NewGuid(), default);
        var holding = r.Contracts.Single(); holding.Status = ContractStatus.PendingActivation;
        var bytes = Encoding.UTF8.GetBytes("TEST ONLY signed Holding PDF"); var hash = Convert.ToHexString(SHA256.HashData(bytes));
        foreach (var signer in new[] { holding.OwnerSignerId, holding.TenantUserId!.Value }) holding.Signatures.Add(new ContractSigning
        {
            ContractId = holding.Id,
            SignerUserId = signer,
            Status = SignatureStatus.Signed,
            SnapshotHash = holding.SnapshotHashOrEmpty,
            SignedObjectKey = "holding-signed",
            SignedHash = hash,
            ProviderReference = Guid.NewGuid().ToString(),
            SignedAt = new Clock().GetUtcNow()
        });
        r.Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async x => await x.Arg<Stream>().WriteAsync(bytes));
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-FULL", holding.RequiredDeposit, "Verified bank statement"), Guid.NewGuid(), default);
        await r.Service.ActivateHoldingAsync(id.Id, Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Active, holding.Status); Assert.Equal(RoomStatus.OnHold, r.Room.Status); Assert.Equal(2, r.Room.Version);
        await r.Service.CancelHoldingAsync(id.Id, new("Synthetic Tenant voluntarily cancelled", HoldingCancellationCause.TenantVoluntary, true), Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Cancelled, holding.Status); Assert.Equal(RoomStatus.Available, r.Room.Status); Assert.Equal(3, r.Room.Version);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(3000000)]
    [InlineData(0)]
    public async Task ConversionReusesHoldingLedgerAndDoesNotMarkHoldingConvertedAtDraftTime(int? clientDeposit)
    {
        var r = new Rig(); var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        await r.Service.ApproveHoldingAsync(id.Id, new("Owner approved terms"), Guid.NewGuid(), default);
        var holding = r.Contracts.Single(); holding.Status = ContractStatus.Active;
        holding.RequiredDeposit = 2000000; // Historical signed Holding, created before the one-month rule.
        holding.PriceLockedAt = new Clock().GetUtcNow(); r.Room.Status = RoomStatus.OnHold;
        var charges = ContractChargeSnapshot.Read(holding).Charges;
        r.Repo.ClearReceivedCalls();
        r.Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(call =>
            new HoldingDepositApplication(holding.Id, holding.RoomId, holding.TenantUserId!.Value, 2000000, "allocation-once"));
        var mainId = await r.Service.ConvertHoldingAsync(holding.Id, new(clientDeposit), Guid.NewGuid(), default);
        var main = r.Contracts.Single(c => c.Id == mainId.Id);
        Assert.Equal(holding.Id, main.HoldingContractId); Assert.Equal(2000000, main.AppliedHoldingDeposit);
        Assert.Equal(3000000, main.RequiredDeposit);
        Assert.Equal(1000000, main.RequiredDeposit - main.AppliedHoldingDeposit);
        Assert.Equal(2000000, holding.RequiredDeposit);
        await r.Holdings.Received(1).ApplyAsync(holding.Id, main.Id, main.RoomId, main.TenantUserId, main.RequiredDeposit, default);
        Assert.Equal(ContractStatus.Active, holding.Status); Assert.Null(holding.ConvertedMainContractId);
        Assert.Equal(charges, ContractChargeSnapshot.Read(main).Charges);
        Assert.True(ContractChargeSnapshot.IsIntact(main));
        await r.Repo.DidNotReceiveWithAnyArgs().ResolvePricesAsync(default, default, default);
    }

    [Theory]
    [InlineData(RoomStatus.OnHold)]
    [InlineData(RoomStatus.Unavailable)]
    public async Task DraftRejectsHeldOrUnavailableRoomWithoutChangingItsStatus(RoomStatus status)
    {
        var r = new Rig(); r.Room.Status = status;
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft, Guid.NewGuid(), default));
        Assert.Equal(409, error.Status);
        Assert.Equal(status, r.Room.Status);
        Assert.Empty(r.Contracts);
        Assert.Empty(r.Operations);
    }

    [Fact]
    public async Task SharedRoomDraftIsAllowedWhenOccupantsAndCapacityDoNotConflict()
    {
        var r = new Rig(); r.Room.Status = RoomStatus.Occupied;
        await r.Service.CreateAsync(r.Draft, Guid.NewGuid(), default);
        Assert.Single(r.Contracts); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
    }

    [Fact]
    public async Task T01_ActivationCommitsContractAndRoomAndReplaysWithoutDuplicateAudit()
    {
        var r = new Rig(); var c = await r.Ready(); var key = Guid.NewGuid();
        await r.Service.ActivateAsync(c.Id, key, default); await r.Service.ActivateAsync(c.Id, key, default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
        Assert.Equal(2, r.Room.Version);
        r.Repo.Received(1).Add(Arg.Is<PropertyChange>(a => a.TargetId == r.Room.Id && a.ActorId == r.User.UserId &&
            a.Before!.Contains("\"Version\":1") && a.After.Contains("\"Version\":2")));
        r.Repo.Received(1).Audit(r.User.UserId!.Value, "ContractActivated", c.Id, Arg.Any<DateTimeOffset>());
        await r.Handovers.Received(1).EnsureMoveInTaskAsync(c, r.User.UserId.Value, Arg.Any<DateTimeOffset>(), default);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task InitialPaymentMustBeConfirmedByBackendBeforeOwnerActivation(bool serviceAvailable, bool settled)
    {
        var r = new Rig(serviceAvailable); var c = await r.Ready(); c.InitialPaymentRequired = true;
        r.InitialPayments.SatisfiedAsync(c.Id, default).Returns(settled);
        var ready = await r.Service.ReadinessAsync(c.Id, default);
        if (settled)
        {
            Assert.True(ready.Ready);
            await r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default);
            Assert.Equal(ContractStatus.Active, c.Status);
        }
        else
        {
            Assert.Contains("initial_payment_required", ready.Blockers);
            Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default))).Status);
            Assert.Equal(ContractStatus.PendingActivation, c.Status);
            Assert.Equal(RoomStatus.Available, r.Room.Status);
            r.Repo.DidNotReceive().Audit(Arg.Any<Guid>(), "ContractActivated", c.Id, Arg.Any<DateTimeOffset>());
        }
    }
    [Fact]
    public async Task ActivationInAlreadyOccupiedRoomDoesNotIncrementRoomVersionOrAddRoomHistory()
    {
        var r = new Rig(); var c = await r.Ready(); r.Room.Status = RoomStatus.Occupied;
        await r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(1, r.Room.Version);
        r.Repo.DidNotReceive().Add(Arg.Any<PropertyChange>());
    }
    [Fact]
    public async Task ActivationRechecksRoomTypeConfiguration()
    {
        var r = new Rig(); var c = await r.Ready(); r.Room.RoomType = new RoomType { IsActive = false };
        await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.PendingActivation, c.Status); Assert.Equal(1, r.Room.Version);
        r.Repo.DidNotReceive().Add(Arg.Any<PropertyChange>());
    }
    [Theory]
    [InlineData("signature")]
    [InlineData("deposit")]
    [InlineData("room")]
    [InlineData("terms")]
    [InlineData("identity")]
    public async Task T02_T03_T05_InvalidReadinessCannotActivate(string invalid)
    {
        var r = new Rig(); var c = await r.Ready();
        if (invalid == "signature") c.Signatures.RemoveAt(0);
        if (invalid == "deposit") r.Deposits.Clear();
        if (invalid == "room") r.Repo.ConflictsAsync(default, default, default, default, default!, default).ReturnsForAnyArgs(true);
        if (invalid == "terms") c.Terms = "tampered";
        if (invalid == "identity") r.Resident.VerificationStatus = IdentityVerificationStatus.Pending;
        Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default))).Status);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
    }
    [Fact]
    public async Task T04_StaffCannotActivateOrVerifyDeposits()
    {
        var r = new Rig(); var c = await r.Ready(); r.User.Role = Roles.Staff;
        Assert.Equal(403, (await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id, new("TEST", 1, "TEST"), Guid.NewGuid(), default))).Status);
    }
    [Fact]
    public async Task T06_MissingHoldingModuleCannotFabricateCredit()
    {
        var r = new Rig(); Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft with { HoldingContractId = Guid.NewGuid() }, Guid.NewGuid(), default))).Status);
        Assert.Empty(r.Contracts); Assert.Empty(r.Deposits);
    }
    [Fact]
    public async Task T06_EligibleHoldingAllocationReducesRemainingDepositExactlyOnce()
    {
        var r = new Rig(); var holdingId = (await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default)).Id;
        var holding = r.Contracts.Single(); holding.Status = ContractStatus.Active; holding.PriceLockedAt = new Clock().GetUtcNow(); r.Room.Status = RoomStatus.OnHold;
        r.Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(new HoldingDepositApplication(holdingId, r.Room.Id, r.Tenant, 1000000, "synthetic-allocation"));
        var key = Guid.NewGuid(); var input = r.Draft with { HoldingContractId = holdingId, StartDate = holding.StartDate, EndDate = holding.EndDate, Terms = holding.Terms, MonthlyRent = holding.RentAmount };
        var one = await r.Service.CreateAsync(input, key, default); var two = await r.Service.CreateAsync(input, key, default);
        Assert.Equal(one, two);
        var ready = await r.Service.ReadinessAsync(one.Id, default);
        Assert.Equal(1000000, ready.VerifiedDeposit); Assert.Equal(2000000, ready.RemainingDeposit);
        await r.Holdings.Received(1).ApplyAsync(holdingId, one.Id, r.Room.Id, r.Tenant, holding.RequiredDeposit, default);
    }
    [Fact]
    public async Task RepeatedBankReferenceCreditsExactlyOnceAndCannotBeReallocated()
    {
        var r = new Rig(); var c = await r.Create(); var input = new DepositInput("SYNTHETIC-BANK", 100, "Owner checked bank statement");
        await r.Service.VerifyDepositAsync(c.Id, input, Guid.NewGuid(), default);
        await r.Service.VerifyDepositAsync(c.Id, input, Guid.NewGuid(), default); Assert.Single(r.Deposits);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id, input with { Amount = 200 }, Guid.NewGuid(), default));
    }
    [Fact]
    public async Task MainDepositOnlyAcceptsTheAgreedRemainderAfterHoldingAndEarlierReceipts()
    {
        var r = new Rig(); var c = await r.Create(); c.AppliedHoldingDeposit = 2000000;
        await r.Service.VerifyDepositAsync(c.Id, new("PARTIAL", 400000, "Synthetic statement"), Guid.NewGuid(), default);
        var excess = await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id,
            new("EXCESS", 600001, "Synthetic statement"), Guid.NewGuid(), default));
        Assert.Equal("main_deposit_excess_requires_manual_review", excess.Code);
        Assert.Equal(400000, Assert.Single(r.Deposits).Amount);
        var key = Guid.NewGuid(); var input = new DepositInput("REMAINDER", 600000, "Synthetic statement");
        var saved = await r.Service.VerifyDepositAsync(c.Id, input, key, default);
        Assert.Equal(1000000, r.Deposits.Sum(d => d.Amount));
        Assert.Equal(3000000, c.AppliedHoldingDeposit + r.Deposits.Sum(d => d.Amount));
        var extra = await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id,
            new("ALREADY-FUNDED", 1, "Synthetic statement"), Guid.NewGuid(), default));
        Assert.Equal("main_deposit_excess_requires_manual_review", extra.Code);
        c.Status = ContractStatus.Terminated;
        Assert.Equal(saved, await r.Service.VerifyDepositAsync(c.Id, input, key, default));
        Assert.Equal(2, r.Deposits.Count);
    }
    [Fact]
    public async Task ZeroAgreedDepositCannotBeTurnedIntoAnUnapprovedDeposit()
    {
        var r = new Rig(); var c = await r.Create(); c.RequiredDeposit = 0;
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id,
            new("ZERO-DEPOSIT", 1, "Synthetic statement"), Guid.NewGuid(), default));
        Assert.Equal("main_deposit_excess_requires_manual_review", error.Code); Assert.Empty(r.Deposits);
    }
    [Theory]
    [InlineData(ContractStatus.Terminated)]
    [InlineData(ContractStatus.Superseded)]
    [InlineData(ContractStatus.Cancelled)]
    [InlineData(ContractStatus.Expired)]
    [InlineData(ContractStatus.Converted)]
    [InlineData(ContractStatus.Applied)]
    public async Task ClosedContractCannotAcceptANewDeposit(ContractStatus status)
    {
        var r = new Rig(); var c = await r.Create(); c.Status = status;
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id,
            new("CLOSED", 1, "Synthetic statement"), Guid.NewGuid(), default));
        Assert.Equal("deposit_not_payable", error.Code); Assert.Empty(r.Deposits);
    }
    [Fact]
    public async Task ReusingIdempotencyKeyWithChangedInputFails()
    {
        var r = new Rig(); var key = Guid.NewGuid(); await r.Service.CreateAsync(r.Draft, key, default);
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft with { MonthlyRent = 4000000 }, key, default));
        Assert.Equal("idempotency_key_reused", error.Code); Assert.Single(r.Contracts);
    }
    [Fact]
    public async Task T09_RenewalRejectsInvalidDatesAndUnsignedActivation()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active;
        await Assert.ThrowsAsync<ContractException>(() => r.Service.RenewAsync(c.Id, new(c.EndDate, 1, "terms"), Guid.NewGuid(), default));
        var next = await r.Service.RenewAsync(c.Id, new(c.EndDate.AddYears(1), 4000000, "new terms"), Guid.NewGuid(), default);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(next.Id, Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(3000000, c.RentAmount);
    }
    [Fact]
    public async Task T10_T11_RequestPreservesActiveContractOwnerApprovesAndStaffCannotApprove()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.User.Role = Roles.Tenant; r.User.UserId = c.TenantUserId;
        c.EndDate = Today.AddDays(60);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestTerminationAsync(c.Id, new(Today.AddDays(29), "Synthetic move out"), Guid.NewGuid(), false, default));
        await r.Service.RequestTerminationAsync(c.Id, new(Today.AddDays(30), "Synthetic move out"), Guid.NewGuid(), false, default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(MoveOutStatus.Requested, r.Moves.Single().Status);
        r.User.Role = Roles.Staff; await Assert.ThrowsAsync<ContractException>(() => r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default));
        r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
        await r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default); Assert.Equal(MoveOutStatus.Approved, r.Moves.Single().Status);
    }

    [Theory]
    [InlineData("Good", 2, true, null)]
    [InlineData("Good", 1, true, "invalid_move_out_asset_quantities")]
    [InlineData("Good", 2, false, "asset_evidence_required")]
    [InlineData("Missing", 2, true, "invalid_move_out_asset_quantities")]
    [InlineData("Missing", 0, false, null)]
    [InlineData("Missing", 1, false, "asset_evidence_required")]
    [InlineData("Damaged", 2, true, null)]
    [InlineData("Damaged", 3, true, "invalid_move_out_asset_quantities")]
    [InlineData("Unrecognized", 2, true, "invalid_move_out_asset")]
    public async Task MoveOutDraftInventoryMatchesMoveInQuantityAndPhotoRequirements(string condition,
        int actual, bool withPhoto, string? expectedError)
    {
        var inventory = Substitute.For<IHandoverInventory>();
        var r = new Rig(inventory: inventory);
        var c = await r.Ready();
        c.Status = ContractStatus.Active;
        r.User.Role = Roles.Staff;
        r.User.UserId = Guid.NewGuid();
        r.Staff.IsAssignedAsync(default, default, default).ReturnsForAnyArgs(true);
        r.Moves.Add(new() { ContractId = c.Id, Status = MoveOutStatus.Approved, ProposedDate = Today });
        var group = new HandoverAsset(Guid.NewGuid(), "Synthetic chairs", "Good", "",
            ConfiguredQuantity: 2, PhysicalAssets: [new(Guid.NewGuid(), 1, 2, "Good", "Active")]);
        inventory.PrepareAsync(c.RoomId, default).Returns(new HandoverInventory("test-token", "Ready", false, [group]));
        r.Repo.FinalReadingsAsync(c.Id, c.RoomId, Today, default).Returns(Array.Empty<HandoverReading>());
        var photo = new ContractInspectionEvidence { ContractId = c.Id, UploadedByUserId = r.User.UserId.Value };
        r.Repo.InspectionEvidenceAsync(c.Id, default).Returns(new[] { photo });
        r.Repo.InTransactionAsync(default, default(Func<Task<MoveOutInspectionDraftView>>)!, default)
            .ReturnsForAnyArgs(call => call.Arg<Func<Task<MoveOutInspectionDraftView>>>()());
        r.Handovers.ReplaceMoveOutInspectionDraftAsync(default, default, default!, default)
            .ReturnsForAnyArgs(true);
        var input = new MoveOutInspectionDraftWrite(0,
            Assets: [new(group.Id, condition, actual, EvidenceIds: withPhoto ? [photo.Id] : [])],
            InventoryToken: "test-token");
        if (expectedError is not null)
        {
            var error = await Assert.ThrowsAsync<ContractException>(() =>
                r.Service.SaveMoveOutInspectionDraftAsync(c.Id, input, Guid.NewGuid(), default));
            Assert.Equal(expectedError, error.Code);
            await r.Handovers.DidNotReceiveWithAnyArgs().ReplaceMoveOutInspectionDraftAsync(default, default, default!, default);
        }
        else
        {
            var saved = await r.Service.SaveMoveOutInspectionDraftAsync(c.Id, input, Guid.NewGuid(), default);
            Assert.Equal(1, saved.Version);
            Assert.Equal(condition, Assert.Single(saved.Assets).Condition);
            Assert.Equal(actual, saved.Assets[0].ObservedQuantity);
        }
    }
    [Theory]
    [InlineData("", true, null)]
    [InlineData("   ", true, null)]
    [InlineData(null, true, null)]
    [InlineData("", false, "room_summary_evidence_required")]
    [InlineData(null, false, "room_summary_evidence_required")]
    public async Task MoveOutDraftRoomSummaryRequiresPhotoButNotNotes(string? notes, bool withPhoto, string? expectedError)
    {
        var r = new Rig();
        var c = await r.Ready();
        c.Status = ContractStatus.Active;
        r.User.Role = Roles.Staff;
        r.User.UserId = Guid.NewGuid();
        r.Staff.IsAssignedAsync(default, default, default).ReturnsForAnyArgs(true);
        r.Moves.Add(new() { ContractId = c.Id, Status = MoveOutStatus.Approved, ProposedDate = Today });
        r.Repo.FinalReadingsAsync(c.Id, c.RoomId, Today, default).Returns(Array.Empty<HandoverReading>());
        var photo = new ContractInspectionEvidence { ContractId = c.Id, UploadedByUserId = r.User.UserId.Value };
        r.Repo.InspectionEvidenceAsync(c.Id, default).Returns(new[] { photo });
        r.Repo.InTransactionAsync(default, default(Func<Task<MoveOutInspectionDraftView>>)!, default)
            .ReturnsForAnyArgs(call => call.Arg<Func<Task<MoveOutInspectionDraftView>>>()());
        r.Handovers.ReplaceMoveOutInspectionDraftAsync(default, default, default!, default)
            .ReturnsForAnyArgs(true);
        var input = new MoveOutInspectionDraftWrite(0, RoomCondition: notes, EvidenceIds: withPhoto ? [photo.Id] : []);
        if (expectedError is not null)
        {
            var error = await Assert.ThrowsAsync<ContractException>(() =>
                r.Service.SaveMoveOutInspectionDraftAsync(c.Id, input, Guid.NewGuid(), default));
            Assert.Equal(expectedError, error.Code);
            await r.Handovers.DidNotReceiveWithAnyArgs().ReplaceMoveOutInspectionDraftAsync(default, default, default!, default);
        }
        else
        {
            var saved = await r.Service.SaveMoveOutInspectionDraftAsync(c.Id, input, Guid.NewGuid(), default);
            Assert.Equal("", saved.RoomCondition);
            Assert.Equal(photo.Id, Assert.Single(saved.EvidenceIds));
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(30)]
    [InlineData(45)]
    public async Task OwnerCannotInitiateOrdinaryMoveOutAtAnyFutureLeaseDate(int daysFromToday)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active;
        var date = Today.AddDays(daysFromToday); var input = new TerminationInput(date, "Synthetic owner move-out");
        var key = Guid.NewGuid();
        await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestTerminationAsync(c.Id, input, key, true, default));
        Assert.Equal(ContractStatus.Active, c.Status);
        Assert.Empty(r.Moves);
    }
    [Fact]
    public async Task RoomMoveOutUsesDemoBusinessDateForResidencyAndProposedDate()
    {
        var real = new Clock(); var demo = new DemoBusinessClock(real);
        var r = new Rig(clock: demo); var c = await r.Ready(); c.Status = ContractStatus.Active;
        var start = new DateOnly(2027, 2, 27);
        c.StartDate = start; c.EndDate = start.AddYears(1);
        Assert.Single(c.Residents).ResidenceFrom = start;
        r.User.Role = Roles.Tenant; r.User.UserId = c.TenantUserId;
        r.Repo.ResidentsAsync(default, default!, default).ReturnsForAnyArgs(call => new[] { r.Resident }
            .Where(x => call.Arg<Guid[]>().Contains(x.Id)).ToArray());
        var input = new TerminationInput(start.AddDays(31), "Personal termination");
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestTerminationAsync(c.Id, input, Guid.NewGuid(), false, default));
        Assert.Equal("move_out_residence_not_started", error.Code);
        Assert.Empty(r.Moves);
        Assert.NotNull(demo.Change(start.AddDays(1), 0));
        var past = await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestTerminationAsync(c.Id, input with { ProposedDate = start }, Guid.NewGuid(), false, default));
        Assert.Equal("invalid_move_out_date", past.Code);
        var move = await r.Service.RequestTerminationAsync(c.Id, input, Guid.NewGuid(), false, default);
        Assert.Equal("Requested", move.Status);
        Assert.Null(move.RequiredConsents); Assert.Null(move.ReceivedConsents);
        Assert.Equal(real.Now, demo.GetUtcNow());
        r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
        Assert.Equal("Approved", (await r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default)).Status);
    }
    [Fact]
    public async Task PersonalTerminationDoesNotRequestConsentOrAffectOtherTenant()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active;
        c.EndDate = Today.AddDays(60);
        var member = new Resident { RoomId = c.RoomId, TenantUserId = Guid.NewGuid(), VerificationStatus = IdentityVerificationStatus.Verified };
        var second = new Contract
        {
            RoomId = c.RoomId,
            Room = c.Room,
            Kind = ContractKind.Main,
            Status = ContractStatus.Active,
            OwnerSignerId = c.OwnerSignerId,
            TenantUserId = member.TenantUserId,
            RepresentativeResidentId = member.Id,
            StartDate = c.StartDate,
            EndDate = c.EndDate,
            Residents = [new() { ResidentId = member.Id, ResidenceFrom = c.StartDate }]
        };
        r.Contracts.Add(second);
        r.Repo.ResidentsAsync(default, default!, default).ReturnsForAnyArgs(call => new[] { r.Resident, member }
            .Where(x => call.Arg<Guid[]>().Contains(x.Id)).ToArray());
        r.User.Role = Roles.Tenant; r.User.UserId = c.TenantUserId;
        var first = await r.Service.RequestTerminationAsync(c.Id, new(Today.AddDays(30), "Personal termination"), Guid.NewGuid(), false, default);
        Assert.Equal("Requested", first.Status);
        Assert.Null(first.RequiredConsents); Assert.Null(first.ReceivedConsents);
        Assert.Single(r.Moves);
        r.User.Role = Roles.Tenant; r.User.UserId = second.TenantUserId;
        await Assert.ThrowsAsync<ContractException>(() => r.Service.GetMoveOutAsync(c.Id, default));
        r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
        var approved = await r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default);
        Assert.Equal("Approved", approved.Status);
        Assert.Equal("personal_termination_scheduled", Assert.Single(r.Moves).PendingReason);
        Assert.Equal(ContractStatus.Active, second.Status);
        await r.Handovers.DidNotReceiveWithAnyArgs().EnsureMoveOutTaskAsync(default!, default!, default, default, default);
    }
    [Fact]
    public async Task TenantCanReopenRejectedRequestAndOwnerCanApprove()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active;
        c.EndDate = Today.AddDays(60);
        r.User.Role = Roles.Tenant; r.User.UserId = c.TenantUserId;
        await r.Service.RequestTerminationAsync(c.Id, new(Today.AddDays(30), "Synthetic tenant request"), Guid.NewGuid(), false, default);
        r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
        await r.Service.RejectTerminationAsync(c.Id, new("Synthetic rejection"), Guid.NewGuid(), default);
        var rejected = Assert.Single(r.Moves);
        var rejectedVersion = rejected.Version;
        Assert.Equal(MoveOutStatus.Rejected, rejected.Status);

        await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestTerminationAsync(c.Id,
            new(Today.AddDays(2), "Synthetic owner reopening"), Guid.NewGuid(), true, default));
        r.User.Role = Roles.Tenant; r.User.UserId = c.TenantUserId;
        var opened = await r.Service.RequestTerminationAsync(c.Id,
            new(Today.AddDays(31), "Synthetic tenant reopening"), Guid.NewGuid(), false, default);
        Assert.Equal("Requested", opened.Status);
        Assert.Equal(rejectedVersion + 1, rejected.Version);
        r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
        await r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default);
        Assert.Same(rejected, Assert.Single(r.Moves));
        Assert.Equal(c.OwnerSignerId, rejected.ApprovedByUserId);
        Assert.Null(rejected.InspectionStaffId);
        Assert.NotNull(rejected.InspectionScheduledAt);
        await r.Handovers.Received(1).EnsureMoveOutTaskAsync(c, rejected, c.OwnerSignerId,
            Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RejectedMoveOutCanBeResubmittedByTenantOrReplacedByOwnerExpiryWithoutLosingVersion(bool expiry)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active;
        var move = new ContractMoveOut
        {
            ContractId = c.Id,
            Status = MoveOutStatus.Rejected,
            ProposedDate = Today,
            Reason = "Original request",
            PendingReason = "Original rejection",
            Version = 2
        };
        r.Moves.Add(move);
        r.User.Role = expiry ? Roles.Owner : Roles.Tenant;
        r.User.UserId = expiry ? c.OwnerSignerId : c.TenantUserId;
        c.EndDate = expiry ? Today : Today.AddDays(60);
        var date = expiry ? Today : Today.AddDays(30);
        var updated = await r.Service.RequestTerminationAsync(c.Id, new(date, "Revised request"), Guid.NewGuid(), expiry, default);

        Assert.Single(r.Moves);
        Assert.Equal(move.Id, updated.Id);
        Assert.Equal(expiry ? "Approved" : "Requested", updated.Status);
        Assert.Equal(3, updated.Version);
        Assert.Equal("Revised request", move.Reason);
        Assert.Equal(expiry ? "inspection_and_financial_dependencies" : "personal_termination_requested", move.PendingReason);
        Assert.Equal(expiry, move.IsExpiry);
        Assert.Equal(expiry ? c.OwnerSignerId : null, move.ApprovedByUserId);
        Assert.Equal(ContractStatus.Active, c.Status);
        var error = await Assert.ThrowsAsync<ContractException>(() =>
            r.Service.RequestTerminationAsync(c.Id, new(date, "Duplicate request"), Guid.NewGuid(), expiry, default));
        Assert.Equal("move_out_already_requested", error.Code);
    }
    [Theory]
    [InlineData(MoveOutStatus.Approved)]
    [InlineData(MoveOutStatus.Inspected)]
    [InlineData(MoveOutStatus.PendingSettlement)]
    [InlineData(MoveOutStatus.Settled)]
    public async Task T12_T13_MissingInspectionCannotReleaseRoom(MoveOutStatus status)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.Room.Status = RoomStatus.Occupied;
        r.Moves.Add(new() { ContractId = c.Id, Status = status, ProposedDate = Today });
        await Assert.ThrowsAsync<ContractException>(() => r.Service.CompleteAsync(c.Id, new(Today), Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task T14_OwnerReviewedHandoverReleasesPhysicalOccupancyWithUnresolvedFinanceAndPreservesHistory(bool otherActive)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.Room.Status = RoomStatus.Occupied;
        r.Moves.Add(new()
        {
            ContractId = c.Id,
            Status = MoveOutStatus.PendingSettlement,
            ProposedDate = Today,
            InspectedAt = new Clock().GetUtcNow(),
            ElectricityReadingId = Guid.NewGuid(),
            WaterReadingId = Guid.NewGuid(),
            SettlementLedgerReference = "verified-synthetic-ledger"
        });
        r.Ledger.ReadAsync(default, default, default, default).ReturnsForAnyArgs(new SettlementLedgerState(false, false, false, ""));
        var image = Encoding.UTF8.GetBytes("synthetic private meter image");
        var imageHash = Convert.ToHexString(SHA256.HashData(image));
        var move = r.Moves.Single();
        var electricity = new HandoverReading(move.ElectricityReadingId!.Value, "E-SYN", 0, Today, 120, Guid.NewGuid(), "private/e", imageHash);
        var water = new HandoverReading(move.WaterReadingId!.Value, "W-SYN", 1, Today, 30, Guid.NewGuid(), "private/w", imageHash);
        var observed = new HandoverSnapshot(Today, "SYN", "Checked", "Returned", "", [], electricity, water, []);
        r.Repo.FinalInspectionsAsync(c.Id, default).Returns(new[] { new ContractFinalInspection { ContractId = c.Id, OwnerDecision = "Confirmed", ObservedSnapshot = JsonSerializer.Serialize(observed) } });
        r.Repo.FinalReadingsAsync(c.Id, c.RoomId, Today, default).Returns(new[] { electricity, water });
        r.Storage.CopyToAsync(Arg.Any<string>(), Arg.Any<Stream>(), default).Returns(call => call.Arg<Stream>().WriteAsync(image).AsTask());
        r.Repo.HasOtherActiveContractsAsync(c.RoomId, c.Id, default).Returns(otherActive);
        await r.Service.CompleteAsync(c.Id, new(Today), Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Terminated, c.Status); Assert.Equal(otherActive ? RoomStatus.Occupied : RoomStatus.Available, r.Room.Status);
        Assert.Equal(otherActive ? 1 : 2, r.Room.Version);
        r.Repo.Received(otherActive ? 0 : 1).Add(Arg.Any<PropertyChange>());
        Assert.Equal(Today, c.Residents.Single().ResidenceTo); Assert.Equal(2, c.Signatures.Count);
        await r.Ledger.DidNotReceiveWithAnyArgs().ReadAsync(default, default, default, default);
        await r.Repo.Received(1).CloseResidenceAsync(c, Today, r.User.UserId!.Value, Arg.Any<DateTimeOffset>(), default);
    }
    [Fact]
    public async Task T15_UnconfiguredProviderKeepsPendingSigning()
    {
        var r = new Rig(); var c = await r.Create();
        r.Signing.PrepareAsync(default!, default, default, default(SigningAppearance)!, default).ReturnsForAnyArgs<SigningPreparation>(_ => throw new IntegrationUnavailableException("test-only"));
        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => r.Service.RequestSigningAsync(c.Id, new(Guid.NewGuid(), Method: SigningMethods.Otp), Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.PendingSigning, c.Status); Assert.Empty(c.Signatures); Assert.Equal(RoomStatus.Available, r.Room.Status);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task SIGN03_AmbiguousProviderTimeoutOrNetworkFailureRemainsInManualReviewWithoutResending(bool timeout)
    {
        var r = new Rig(); var c = await r.Create(); var key = Guid.NewGuid(); var input = new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp);
        var source = "%PDF-1.7 SYNTHETIC PROVIDER BOUNDARY"u8.ToArray();
        r.Signing.PrepareAsync(default!, default, default, default(SigningAppearance)!, default).ReturnsForAnyArgs(new SigningPreparation(
            source, source, "synthetic-field", "synthetic-digest", "synthetic-data-to-sign", "synthetic-chain", "synthetic-user", "synthetic-credential"));
        Exception failure = timeout ? new OperationCanceledException("Synthetic provider timeout") : new HttpRequestException("Synthetic provider outage");
        r.Signing.RequestAsync(default!, default).ReturnsForAnyArgs(Task.FromException<string>(failure));

        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => r.Service.RequestSigningAsync(c.Id, input, key, default));
        var signature = Assert.Single(c.Signatures);
        Assert.Equal(SignatureStatus.ManualReview, signature.Status);
        Assert.Null(signature.SignedAt); Assert.Null(signature.SignedObjectKey); Assert.Null(signature.ProviderReference);
        var replay = await r.Service.RequestSigningAsync(c.Id, input, key, default);
        Assert.Equal(signature.Id, replay.Id); Assert.Equal("ManualReview", replay.Status);
        await r.Signing.Received(1).PrepareAsync(Arg.Any<ContractDocument>(), input.CertificateId, null, Arg.Is<SigningAppearance>(a => a.Method == SigningMethods.Otp), Arg.Any<CancellationToken>());
        await r.Signing.Received(1).RequestAsync(Arg.Any<ContractSigning>(), Arg.Any<CancellationToken>());
        Assert.Equal(ContractStatus.PendingSigning, c.Status); Assert.Equal(RoomStatus.Available, r.Room.Status);
    }
    [Fact]
    public async Task SIGN02_AnotherOwnerCannotSignOnBehalfOfEitherContractSigner()
    {
        var r = new Rig(); var c = await r.Create(); r.User.UserId = Guid.NewGuid();
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestSigningAsync(c.Id, new(Guid.NewGuid(), Method: SigningMethods.Otp), Guid.NewGuid(), default));
        Assert.Equal(403, error.Status); Assert.Equal("contract_signer_required", error.Code);
        Assert.Empty(c.Signatures); Assert.Equal(ContractStatus.Draft, c.Status);
        await r.Signing.DidNotReceiveWithAnyArgs().PrepareAsync(default!, default, default, default(SigningAppearance)!, default);
    }
    [Theory]
    [InlineData(Roles.Tenant)]
    [InlineData(Roles.Staff)]
    public async Task T16_OtherTenantOrUnassignedStaffCannotReadContract(string role)
    {
        var r = new Rig(); var c = await r.Create(); r.User.Role = role; r.User.UserId = Guid.NewGuid();
        Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.GetAsync(c.Id, default))).Status);
    }
}
