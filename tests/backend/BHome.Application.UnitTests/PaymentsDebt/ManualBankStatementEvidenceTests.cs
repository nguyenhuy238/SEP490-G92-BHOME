using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.PaymentsDebt;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using NSubstitute;

namespace BHome.Application.UnitTests.PaymentsDebt;

public sealed class ManualBankStatementEvidenceTests
{
    private sealed class Storage : IObjectStorage
    {
        public readonly Dictionary<string, byte[]> Files = [];
        public bool FailWrite;
        public bool CorruptRead;
        public Func<bool>? InsideTransaction;
        public int Deleted;

        public async Task PutAsync(string key, Stream data, long length, string type, CancellationToken t)
        {
            Assert.False(InsideTransaction?.Invoke() ?? false);
            if (FailWrite) throw new IOException("Synthetic object store is unavailable");
            using var buffer = new MemoryStream();
            await data.CopyToAsync(buffer, t);
            Assert.Equal(length, buffer.Length);
            Files[key] = buffer.ToArray();
        }
        public Task CopyToAsync(string key, Stream output, CancellationToken t)
        {
            Assert.False(InsideTransaction?.Invoke() ?? false);
            var bytes = Files[key];
            return output.WriteAsync(CorruptRead ? new byte[] { 1, 2, 3 } : bytes, t).AsTask();
        }
        public Task DeleteAsync(string key, CancellationToken t)
        {
            Assert.False(InsideTransaction?.Invoke() ?? false);
            Files.Remove(key); Deleted++; return Task.CompletedTask;
        }
    }

    private sealed class Workspace
    {
        public readonly Guid Owner = Guid.NewGuid();
        public readonly IPaymentRepository Repository = Substitute.For<IPaymentRepository>();
        public readonly ICurrentUser User = Substitute.For<ICurrentUser>();
        public readonly IContractImageValidator Validator = Substitute.For<IContractImageValidator>();
        public readonly Storage Files = new();
        public readonly List<Payment> Transfers = [];
        public readonly List<PaymentCommand> Commands = [];
        public bool InsideTransaction;
        public bool FailTransaction;
        public PaymentService Service { get; }

        public Workspace()
        {
            User.UserId.Returns(Owner);
            User.IsInRole(Roles.Owner).Returns(true);
            Validator.Validate(Arg.Any<byte[]>()).Returns("image/png");
            Files.InsideTransaction = () => InsideTransaction;
            Repository.TransactionAsync<TransferView>(Arg.Any<Guid?>(), Arg.Any<Guid?>(), Arg.Any<Func<Task<TransferView>>>(), Arg.Any<CancellationToken>())
                .Returns(async call =>
                {
                    if (FailTransaction) throw new IOException("Synthetic database transaction failure");
                    InsideTransaction = true;
                    try { return await call.ArgAt<Func<Task<TransferView>>>(2)(); }
                    finally { InsideTransaction = false; }
                });
            Repository.CommandAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(call => Task.FromResult<PaymentCommand?>(Commands.FirstOrDefault(c =>
                    c.ActorId == call.ArgAt<Guid>(0) && c.Key == call.ArgAt<Guid>(1) && c.Operation == call.ArgAt<string>(2))));
            Repository.TransferReferenceAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(call => Task.FromResult<Payment?>(Transfers.FirstOrDefault(p =>
                    p.ProviderIdentity == call.ArgAt<string>(0) && p.NormalizedReference == call.ArgAt<string>(1))));
            Repository.TransferAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
                .Returns(call => Task.FromResult<Payment?>(Transfers.FirstOrDefault(p => p.Id == call.ArgAt<Guid>(0))));
            Repository.ProviderReferenceReceivedAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(Task.FromResult(false));
            Repository.AddAsync(Arg.Any<object>(), Arg.Any<CancellationToken>()).Returns(call =>
            {
                switch (call.ArgAt<object>(0))
                {
                    case Payment transfer: Transfers.Add(transfer); break;
                    case PaymentCommand command: Commands.Add(command); break;
                }
                return Task.CompletedTask;
            });
            Service = new PaymentService(Repository, User, TimeProvider.System, storage: Files, images: Validator);
        }
        public PaymentTransferInput Input(string? reference = null) =>
            new("SYNTHETIC-BANK", reference ?? "SYN-" + Guid.NewGuid().ToString("N"), 120000, "VND",
                DateTimeOffset.UtcNow.AddMinutes(-1), "SYNTHETIC-TRANSFER", "", "Owner verified synthetic statement", null, true);
        public static MemoryStream Image(byte part = 17) => new([137, 80, 78, 71, part, 2, 3, 4]);
    }

    [Fact]
    public async Task StoresPrivateImageBeforeLedgerTransactionAndReturnsVerifiedEvidence()
    {
        var w = new Workspace(); var input = w.Input(); var key = Guid.NewGuid();
        var result = await w.Service.RegisterWithStatementEvidenceAsync(input, key, Workspace.Image(), default);
        var bytes = Workspace.Image().ToArray(); var hash = Convert.ToHexString(SHA256.HashData(bytes));
        Assert.Equal("MANUAL_IMAGE/" + hash, result.StatementReference);
        Assert.Equal(new BankStatementEvidenceView("image/png", bytes.Length, hash), result.StatementEvidence);
        Assert.Single(w.Transfers);
        Assert.StartsWith("images/payment-statements/", w.Transfers[0].StatementEvidenceObjectKey);
        Assert.Single(w.Files.Files);
        using var destination = new MemoryStream();
        Assert.Equal("image/png", await w.Service.CopyStatementEvidenceAsync(result.Id, destination, default));
        Assert.Equal(bytes, destination.ToArray());
    }

    [Fact]
    public async Task ReplayNeverOverwritesTheOriginalScreenshotAndCompensatesItsUnusedUpload()
    {
        var w = new Workspace(); var input = w.Input(); var key = Guid.NewGuid();
        var first = await w.Service.RegisterWithStatementEvidenceAsync(input, key, Workspace.Image(), default);
        var originalKey = Assert.Single(w.Files.Files.Keys);
        var replay = await w.Service.RegisterWithStatementEvidenceAsync(input, key, Workspace.Image(), default);
        Assert.Equal(first.Id, replay.Id);
        Assert.Equal(originalKey, Assert.Single(w.Files.Files.Keys));
        Assert.Equal(1, w.Files.Deleted);
        Assert.Single(w.Transfers);
        var changed = await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.RegisterWithStatementEvidenceAsync(input, key, Workspace.Image(18), default));
        Assert.Equal(409, changed.Status);
        Assert.Equal(originalKey, Assert.Single(w.Files.Files.Keys));
    }

    [Fact]
    public async Task StorageFailureOrCorruptionCannotCreateVerifiedReceipt()
    {
        var w = new Workspace(); w.Files.FailWrite = true;
        await Assert.ThrowsAsync<IOException>(() => w.Service.RegisterWithStatementEvidenceAsync(w.Input(), Guid.NewGuid(), Workspace.Image(), default));
        Assert.Empty(w.Transfers); Assert.Empty(w.Commands); Assert.Empty(w.Files.Files);
        w.Files.FailWrite = false; w.Files.CorruptRead = true;
        var corrupted = await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.RegisterWithStatementEvidenceAsync(w.Input(), Guid.NewGuid(), Workspace.Image(), default));
        Assert.Equal("bank_statement_image_integrity_failed", corrupted.Code);
        Assert.Empty(w.Transfers); Assert.Empty(w.Files.Files);
    }

    [Fact]
    public async Task DatabaseFailureCompensatesPrivateStagingWithoutFinancialEffect()
    {
        var w = new Workspace { FailTransaction = true };
        await Assert.ThrowsAsync<IOException>(() => w.Service.RegisterWithStatementEvidenceAsync(w.Input(), Guid.NewGuid(), Workspace.Image(), default));
        Assert.Empty(w.Transfers); Assert.Empty(w.Files.Files); Assert.Equal(1, w.Files.Deleted);
    }

    [Fact]
    public async Task ExistingBankReferenceCannotBeRelinkedToDifferentImageOrOwner()
    {
        var w = new Workspace(); var input = w.Input();
        var saved = await w.Service.RegisterWithStatementEvidenceAsync(input, Guid.NewGuid(), Workspace.Image(), default);
        var error = await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.RegisterWithStatementEvidenceAsync(input, Guid.NewGuid(), Workspace.Image(33), default));
        Assert.Equal("bank_transaction_identity_conflict", error.Code);
        Assert.Equal(saved.Id, Assert.Single(w.Transfers).Id);
        Assert.Single(w.Files.Files);
    }

    [Fact]
    public async Task LegacyJsonCannotForgeImageMarkerAndDifferentOwnerCannotDownloadProof()
    {
        var w = new Workspace();
        var input = w.Input() with { StatementReference = "MANUAL_IMAGE/FAKE" };
        Assert.Equal("bank_statement_image_required", (await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.RegisterAsync(input, Guid.NewGuid(), default))).Code);
        var receipt = await w.Service.RegisterWithStatementEvidenceAsync(w.Input(), Guid.NewGuid(), Workspace.Image(), default);
        w.User.UserId.Returns(Guid.NewGuid());
        Assert.Equal(404, (await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.CopyStatementEvidenceAsync(receipt.Id, new MemoryStream(), default))).Status);
    }

    [Fact]
    public async Task RejectsMissingImageAndImageLargerThanFiveMegabytesBeforeStorage()
    {
        var w = new Workspace();
        var empty = await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.RegisterWithStatementEvidenceAsync(w.Input(), Guid.NewGuid(), new MemoryStream(), default));
        Assert.Equal(400, empty.Status);
        var tooLarge = await Assert.ThrowsAsync<PaymentException>(() =>
            w.Service.RegisterWithStatementEvidenceAsync(w.Input(), Guid.NewGuid(), new MemoryStream(new byte[5 * 1024 * 1024 + 1]), default));
        Assert.Equal(413, tooLarge.Status);
        Assert.Empty(w.Files.Files);
    }
}
