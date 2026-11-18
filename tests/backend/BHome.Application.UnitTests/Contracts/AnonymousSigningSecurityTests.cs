using System.Security.Cryptography;
using System.Text;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.Contracts;

public sealed class AnonymousSigningSecurityTests
{
    [Fact]
    public async Task DuplicateEmailCannotRequestAnotherOtpOrMutateTheInvitation()
    {
        var r = new Rig(); r.Security.EmailConfigured.Returns(true);
        r.Invites.IsEmailInUseAsync(r.Contract.Id, r.Invite.ResidentId, r.Invite.RecipientEmail, default).Returns(true);
        r.Contracts.InTransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<(Guid, string, string, int)>>>(), default)
            .Returns(call => call.Arg<Func<Task<(Guid, string, string, int)>>>()());
        var hash = r.Invite.OtpHash;
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestOtpAsync(Rig.Token, default));
        Assert.Equal("signing_email_already_in_use", error.Code); Assert.Equal(hash, r.Invite.OtpHash);
        Assert.Equal(0, r.Invite.OtpSendCount);
        await r.Security.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default!, default);
    }
    [Fact]
    public async Task HoldingTenantCanOpenInvitationAndVerifyOtpBeforeOwnerSigns()
    {
        var r = new Rig(); r.Contract.Kind = ContractKind.Holding;
        var info = await r.Service.InfoAsync(Rig.Token, default);
        Assert.False(info.Accepted);
        var access = await r.Service.VerifyOtpAsync(new(Rig.Token, "123456"), default);
        Assert.Equal(r.Invite.DocumentHash, access.DocumentHash);
        Assert.Null(r.Invite.AcceptedAt);
        Assert.False(AnonymousContractSigningService.Complete(r.Contract));
    }

    [Fact]
    public async Task HoldingTenantRejectsOwnerSignatureForDifferentReviewDocument()
    {
        var r = new Rig(); r.Contract.Kind = ContractKind.Holding;
        r.Contract.Signatures.Add(new ContractSignature { SignerUserId = r.Contract.OwnerSignerId,
            Status = SignatureStatus.Signed, SnapshotHash = r.Contract.SnapshotHash, SignedAt = r.Time.Now,
            SourceHash = "DIFFERENT", SignedHash = "OTHER", SignedObjectKey = "test", ProviderReference = "test" });
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.AcceptAsync(
            new(Rig.Token, Rig.Session, r.Invite.DocumentHash, ContractSigningModes.InternalConsent, true,
                [[new(.1, .1), new(.8, .8)]]), default));
        Assert.Equal("signing_evidence_integrity_failed", error.Code);
        Assert.Null(r.Invite.AcceptedAt);
        Assert.Equal("{}", r.Contract.InternalAcceptance);
    }

    [Fact]
    public void HoldingCannotTreatPendingOrWrongSnapshotAsOwnerSignature()
    {
        var r = new Rig(); r.Contract.Kind = ContractKind.Holding;
        var s = new ContractSignature { SignerUserId = r.Contract.OwnerSignerId, Status = SignatureStatus.Pending,
            SnapshotHash = r.Contract.SnapshotHash, SignedAt = r.Time.Now, SignedObjectKey = "test", SignedHash = "test", ProviderReference = "test" };
        r.Contract.Signatures.Add(s);
        Assert.False(AnonymousContractSigningService.HoldingOwnerHasSigned(r.Contract));
        s.Status = SignatureStatus.Signed; s.SnapshotHash = "different";
        Assert.False(AnonymousContractSigningService.HoldingOwnerHasSigned(r.Contract));
        s.SnapshotHash = r.Contract.SnapshotHash;
        Assert.True(AnonymousContractSigningService.HoldingOwnerHasSigned(r.Contract));
    }

    private sealed class Clock : TimeProvider { public DateTimeOffset Now { get; set; } = new(2026, 11, 11, 1, 0, 0, TimeSpan.Zero); public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class Rig
    {
        public readonly Clock Time = new();
        public readonly IContractRepository Contracts = Substitute.For<IContractRepository>();
        public readonly IAnonymousSigningRepository Invites = Substitute.For<IAnonymousSigningRepository>();
        public readonly IAnonymousSigningSecurity Security = Substitute.For<IAnonymousSigningSecurity>();
        public readonly IObjectStorage Storage = Substitute.For<IObjectStorage>();
        public readonly ICurrentUser User = Substitute.For<ICurrentUser>();
        public readonly Contract Contract = new() { SigningMode = ContractSigningModes.Internal, Status = ContractStatus.PendingSigning, OwnerSignerId = Guid.NewGuid(), RepresentativeResidentId = Guid.NewGuid(), StartDate = new(2026, 11, 11), EndDate = new(2027, 1, 1), Terms = "Synthetic" };
        public readonly ContractSigningInvitation Invite;
        public const string Token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        public const string Session = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
        public AnonymousContractSigningService Service { get; }
        public Rig()
        {
            Contract.Residents.Add(new ContractResident { ContractId = Contract.Id, ResidentId = Contract.RepresentativeResidentId });
            Contract.SnapshotHash = ContractDocumentSnapshot.Hash(new(Contract.Id, Contract.RoomId, Contract.OwnerSignerId, Guid.Empty,
                Contract.RepresentativeResidentId, [Contract.RepresentativeResidentId], Contract.StartDate, Contract.EndDate,
                Contract.MonthlyRent, Contract.RequiredDeposit, null, 0, Contract.Terms, ""));
            Invite = new()
            {
                ContractId = Contract.Id,
                ResidentId = Contract.RepresentativeResidentId,
                SnapshotHash = Contract.SnapshotHash,
                TokenHash = Hash(Token),
                SessionHash = Hash(Session),
                SessionExpiresAt = Time.Now.AddMinutes(10),
                OtpHash = "protected:123456",
                OtpExpiresAt = Time.Now.AddMinutes(5),
                ExpiresAt = Time.Now.AddHours(1),
                RecipientEmail = "synthetic@example.invalid"
            };
            Invites.FindByTokenHashAsync(Arg.Any<string>(), default).Returns(c => c.Arg<string>() == Invite.TokenHash ? Invite : null);
            Invites.FindAsync(Invite.Id, default).Returns(Invite);
            Contracts.FindAsync(Contract.Id, default).Returns(Contract);
            Contracts.InTransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<byte[]>>>(), default).Returns(c => c.Arg<Func<Task<byte[]>>>()());
            Contracts.InTransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<bool>>>(), default).Returns(c => c.Arg<Func<Task<bool>>>()());
            Contracts.InTransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<AnonymousSigningInfo>>>(), default).Returns(c => c.Arg<Func<Task<AnonymousSigningInfo>>>()());
            Contracts.InTransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<AnonymousSigningAccess?>>>(), default).Returns(c => c.Arg<Func<Task<AnonymousSigningAccess?>>>()());
            Security.OtpHash(Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<string>()).Returns(c => "protected:" + c.ArgAt<string>(2));
            User.UserId.Returns(Contract.OwnerSignerId); User.IsInRole("Owner").Returns(true);
            Service = new(Contracts, Invites, Security, Substitute.For<IInternalAcceptanceRenderer>(), User,
                Substitute.For<IContractDocumentRenderer>(), Substitute.For<IContractSigningDocumentSource>(), Substitute.For<IContractFileStore>(), Storage, Time, Substitute.For<IContractSigningPages>());
        }
        private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExpiredOrRevokedInvitationCannotReadMetadata(bool revoked)
    {
        var r = new Rig(); if (revoked) r.Invite.RevokedAt = r.Time.Now; else r.Invite.ExpiresAt = r.Time.Now;
        Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.InfoAsync(Rig.Token, default))).Status);
    }
    [Fact]
    public async Task WrongTokenIsNotInterchangeableWithInvitation()
    {
        var r = new Rig();
        Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.InfoAsync(new string('C', 64), default))).Status);
    }
    [Fact]
    public async Task ExpiredOtpCannotMintSession()
    {
        var r = new Rig(); r.Invite.OtpExpiresAt = r.Time.Now; r.Invite.SessionHash = null;
        await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyOtpAsync(new(Rig.Token, "123456"), default));
        Assert.Null(r.Invite.SessionHash);
    }
    [Fact]
    public async Task WrongAttemptsLockEvenCorrectOtpAndSuccessfulOtpIsOneTime()
    {
        var r = new Rig();
        for (var n = 0; n < 5; n++) await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyOtpAsync(new(Rig.Token, "654321"), default));
        Assert.Equal(5, r.Invite.OtpAttempts);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyOtpAsync(new(Rig.Token, "123456"), default));
        r = new Rig(); var access = await r.Service.VerifyOtpAsync(new(Rig.Token, "123456"), default);
        Assert.Equal(64, access.Session.Length); Assert.Null(r.Invite.OtpHash);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyOtpAsync(new(Rig.Token, "123456"), default));
    }
    [Fact]
    public async Task ExpiredOrWrongSessionCannotDownloadPrivatePdf()
    {
        var r = new Rig(); r.Invite.SessionExpiresAt = r.Time.Now;
        Assert.Equal(401, (await Assert.ThrowsAsync<ContractException>(() => r.Service.DocumentAsync(new(Rig.Token, Rig.Session), default))).Status);
        r.Invite.SessionExpiresAt = r.Time.Now.AddMinutes(5);
        Assert.Equal(401, (await Assert.ThrowsAsync<ContractException>(() => r.Service.DocumentAsync(new(Rig.Token, new string('C', 64)), default))).Status);
        await r.Storage.DidNotReceiveWithAnyArgs().CopyToAsync(default!, default!, default);
    }
    [Fact]
    public async Task ChangedTermsInvalidatePreviouslyIssuedSession()
    {
        var r = new Rig(); r.Contract.Terms = "Altered";
        Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => r.Service.DocumentAsync(new(Rig.Token, Rig.Session), default))).Status);
        await r.Storage.DidNotReceiveWithAnyArgs().CopyToAsync(default!, default!, default);
    }
    [Theory]
    [InlineData(false, "internal-acceptance-v1", "")]
    [InlineData(true, "changed-consent", "")]
    [InlineData(true, "internal-acceptance-v1", "changed-document")]
    public async Task AcceptanceRequiresExactDocumentAndExplicitVersionedConsent(bool consent, string version, string hash)
    {
        var r = new Rig();
        var x = new AnonymousAcceptanceInput(Rig.Token, Rig.Session, hash, version, consent, [[new(.1, .2), new(.3, .4)]]);
        Assert.Equal(400, (await Assert.ThrowsAsync<ContractException>(() => r.Service.AcceptAsync(x, default))).Status);
        Assert.Equal("{}", r.Contract.InternalAcceptance);
    }
    [Fact]
    public async Task OwnerCannotConfirmBeforeTenantAcceptance()
    {
        var r = new Rig();
        Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => r.Service.ConfirmOwnerAsync(r.Contract.Id, new("hash", ContractSigningModes.InternalConsent, true), default))).Status);
        Assert.False(AnonymousContractSigningService.Complete(r.Contract));
    }
}
