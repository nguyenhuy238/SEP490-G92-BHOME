using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Application.Ocr;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;

namespace BHome.IntegrationTests.Contracts;

// OTP email signing end to end through the API. Expected behaviour: BHOME_OTP_Signing_Plan.md §7 (SRS v1.3 UC-15
// "Owner and Tenant electronically sign", DBR-03 signing status and evidence; decisions D1/D2/D6).
public sealed partial class ContractLifecycleApiTests
{
    private async Task<bool> RunHoldingSigningOnNativeSchemaAsync(bool holding, Func<ContractLifecycleApiTests, Task> scenario)
    {
        if (!holding || fixture.Factory.Services.GetService<BHome.Infrastructure.Persistence.Compact24.Compact24DbContext>() is not null) return false;
        // The source-schema adapter does not persist Holding approval/expiry metadata. Keep both
        // theory cases, but exercise Holding evidence on the production Compact24 schema.
        var native = new BHome.IntegrationTests.Compact24.PropertyContractDockerFixture();
        try
        {
            await native.InitializeAsync();
            await scenario(new ContractLifecycleApiTests(native.Contracts));
        }
        finally { await native.DisposeAsync(); }
        return true;
    }
    private async Task PrepareHoldingSigningData(Workspace workspace)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        db.Add(new BillingPolicy
        {
            LocationId = workspace.Location,
            RoomId = workspace.Room,
            Category = ChargeCategory.Rent,
            ChargeCode = "RENT",
            Name = "Synthetic signing test rate",
            Method = ChargingMethod.FixedPerRoomPerMonth,
            Rate = 3000000,
            EffectiveFrom = Today
        });
        // The canonical Holding PDF uses the effective lessor profile and confirmed
        // representative identity, just like a real reviewed signing document.
        var resident = await db.Set<BHome.Domain.TenantContracts.Resident>().FindAsync(workspace.Resident);
        var identity = new IdentityConfirmation(true, "000000000123", "SYNTHETIC TENANT", new(2000, 1, 2),
            "Synthetic tenant address", null, null, null, new(2021, 6, 15), null);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(identity);
        try
        {
            resident!.IdentityData = JsonSerializer.Serialize(scope.ServiceProvider.GetRequiredService<IIdentityProtection>()
                .Encrypt(bytes, new(workspace.Owner.Id, workspace.Resident)));
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
        await db.SaveChangesAsync();
        await BHome.IntegrationTests.Fixtures.MainDraftTestSettings.ResetOwnerPolicyAsync(db, workspace.Owner.Id);
        await scope.ServiceProvider.GetRequiredService<IMainDraftData>().SetSettingsAsync(workspace.Location,
            new(workspace.Owner.Id, Today.AddDays(-1), null, "Synthetic bank transfer terms", "",
                new("SYNTHETIC OWNER", new(1980, 1, 1), "000000000456", new(2020, 1, 1),
                    "Synthetic issuing authority", "Synthetic owner address", "0900000000"), 0), workspace.Owner.Id, default);
    }
    private sealed class CapturedEmail : INotificationChannelProvider
    {
        public ConcurrentQueue<ChannelMessage> Sent { get; } = new();
        public bool IsConfigured(string channel) => channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => false;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken t)
        {
            Sent.Enqueue(message);
            return Task.FromResult("smtp-accepted:" + Guid.NewGuid().ToString("N"));
        }
    }

    [Theory, InlineData(false), InlineData(true)]
    public async Task OwnerThenTenantSignWithEmailedOtpAndTheSealedPdfKeepsBothSignatures(bool holding = false)
        => await SignOwnerThenTenant(holding, false);

    [Theory, InlineData(false), InlineData(true)]
    public async Task OwnerSessionThenTenantOtpKeepsBothSignatures(bool holding = false)
        => await SignOwnerThenTenant(holding, true);

    private async Task SignOwnerThenTenant(bool holding, bool ownerSession)
    {
        if (await RunHoldingSigningOnNativeSchemaAsync(holding, tests => tests.SignOwnerThenTenant(true, ownerSession))) return;
        var w = await Setup();
        if (holding) await PrepareHoldingSigningData(w);
        var holdingQuote = holding ? await ConfigureHoldingPolicyAsync(w, "Synthetic Holding signing terms") : null;
        var id = holding
            ? (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts/holdings", new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, w.Resident, [w.Resident], holdingQuote!.StartDate, holdingQuote.EndDate, holdingQuote.ExpiresAt, holdingQuote.HoldingDeposit, holdingQuote.Terms, 1, holdingQuote.SettingsVersion)))).Id
            : (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts", Input(w)))).Id;
        if (holding) await Success<ContractView>(await Post(w.Owner, Path(id, "holding-approval"), new HoldingDecisionInput("Owner reviewed")));
        var email = new CapturedEmail();
        await using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ContractPdf:TemplateId"] = ContractPdfRendererTests.TemplateId,
                ["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local",
                ["ContractSigning:Methods:Otp"] = "true",
                ["ContractSigning:InvitationLink:PublicOpenUrl"] = "https://bhome.example/open/sign-contract"
            }));
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IContractSigningProvider>();
                s.AddScoped<IContractSigningProvider, ContractSigningRouter>();
                s.RemoveAll<INotificationChannelProvider>();
                s.AddSingleton<INotificationChannelProvider>(email);
            });
        });
        Actor As(Actor signer)
        {
            var actor = new Actor(host.CreateClient(), signer.Id);
            actor.Client.DefaultRequestHeaders.Authorization = signer.Client.DefaultRequestHeaders.Authorization;
            return actor;
        }
        var owner = As(w.Owner);
        var tenant = As(w.Tenant);

        // OTP is offered to both parties; it is the Tenant's default (the Owner's default is their certificate method).
        var methods = (await owner.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!;
        Assert.Contains(SigningMethods.OwnerSession, methods.Methods);
        Assert.DoesNotContain(SigningMethods.Otp, methods.Methods);
        Assert.Equal(SigningMethods.OwnerSession, methods.Default);
        Assert.Equal(SigningMethods.Otp, (await tenant.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!.Default);
        Assert.DoesNotContain(SigningMethods.OwnerSession, (await tenant.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!.Methods);
        if (ownerSession)
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, Path(id, "signing"), new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, Path(id, "signing"), new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession))).StatusCode);
        }

        static string EmailOf(Actor actor) => actor.Id.ToString("N") + "@example.invalid";
        foreach (var (signer, account) in new[] { (owner, EmailOf(owner)), (tenant, EmailOf(tenant)) })
        {
            if (ownerSession && signer.Id == owner.Id)
            {
                var input = new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true);
                var sessionKey = Guid.NewGuid();
                var immediate = await Success<SignatureView>(await Post(signer, Path(id, "signing"), input, sessionKey));
                Assert.Equal("Signed", immediate.Status); Assert.Equal(SigningMethods.OwnerSession, immediate.Method);
                var sessionReplay = await Success<SignatureView>(await Post(signer, Path(id, "signing"), input, sessionKey));
                Assert.Equal(immediate.Id, sessionReplay.Id);
                Assert.DoesNotContain(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP");
                Assert.Equal("PendingSigning", (await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
                await using (var scope = host.Services.CreateAsyncScope())
                    Assert.False(await scope.ServiceProvider.GetRequiredService<ContractService>().AutomaticActivationReadyAsync(id, default));
                var pendingContract = (await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!;
                await Deposit(w, id, pendingContract.RequiredDeposit);
                await using (var scope = host.Services.CreateAsyncScope())
                {
                    var service = scope.ServiceProvider.GetRequiredService<ContractService>();
                    Assert.False(await service.AutomaticActivationReadyAsync(id, default));
                    await Assert.ThrowsAsync<ContractException>(() => service.AutoActivatePaidMainAsync(id, default));
                }
                continue;
            }
            // Bấm Ký: the PDF is prepared and a one-time code goes to the signer's email only.
            var requested = await Success<SignatureView>(await Post(signer, Path(id, "signing"),
                new SigningInput(Guid.Empty, Method: SigningMethods.Otp), Guid.NewGuid()));
            Assert.Equal("Pending", requested.Status);
            var otpMail = Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP" && m.Destination == account);
            var code = otpMail.Title[(otpMail.Title.LastIndexOf(' ') + 1)..];
            Assert.Matches("^[0-9]{6}$", code);
            Assert.DoesNotContain("3000000", otpMail.Body);
            var challenge = (await signer.Client.GetFromJsonAsync<SigningOtpView>(Path(id, "signing/otp")))!;
            Assert.Equal(requested.Id, challenge.SignatureId);
            Assert.DoesNotContain(code, challenge.MaskedEmail);

            // A wrong code changes nothing.
            var wrong = await Post(signer, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code == "000000" ? "111111" : "000000"), Guid.NewGuid());
            Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
            Assert.Contains("otp_incorrect", await wrong.Content.ReadAsStringAsync());

            // The right code signs once; the same request replayed returns the same result.
            var key = Guid.NewGuid();
            var signed = await Success<ContractView>(await Post(signer, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code), key));
            Assert.Equal("Signed", Assert.Single(signed.Signatures, s => s.SignerUserId == signer.Id).Status);
            var replay = await Success<ContractView>(await Post(signer, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code), key));
            Assert.Equal(signed.Signatures.Count, replay.Signatures.Count);
            // The code cannot be used a second time.
            Assert.Equal(HttpStatusCode.Conflict, (await Post(signer, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code), Guid.NewGuid())).StatusCode);
        }

        // After the Owner signed, the Tenant was invited by email; after both signed, both were told.
        var invitation = Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_INVITATION" && m.Destination == EmailOf(tenant));
        // The invitation button opens the app on this contract's signing page (through the public forwarding page).
        Assert.Equal($"https://bhome.example/open/sign-contract?contractId={id:D}", invitation.ActionUrl);
        var open = await host.CreateClient().GetAsync($"/open/sign-contract?contractId={id:D}");
        Assert.Equal(HttpStatusCode.OK, open.StatusCode);
        Assert.Contains($"bhome://sign-contract?contractId={id:D}", await open.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await host.CreateClient().GetAsync("/open/sign-contract?contractId=" + Guid.Empty)).StatusCode);
        Assert.Equal(2, email.Sent.Count(m => m.EventType == "CONTRACT_FULLY_SIGNED"));
        var contract = (await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!;
        Assert.Equal("PendingActivation", contract.Status);

        if (!ownerSession)
        {
            await using (var scope = host.Services.CreateAsyncScope())
                Assert.False(await scope.ServiceProvider.GetRequiredService<ContractService>().AutomaticActivationReadyAsync(id, default));
            await Deposit(w, id, contract.RequiredDeposit);
        }
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<ContractService>();
            var readiness = await owner.Client.GetFromJsonAsync<ActivationReadiness>(Path(id, "activation-readiness"));
            Assert.True(await service.AutomaticActivationReadyAsync(id, default),
                $"Automatic activation blockers: {string.Join(",", readiness?.Blockers ?? [])}");
            await service.AutoActivatePaidMainAsync(id, default);
            await service.AutoActivatePaidMainAsync(id, default);
        }
        Assert.Equal("Active", (await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        var document = await tenant.Client.GetAsync(Path(id, "document"));
        document.EnsureSuccessStatusCode();
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(await document.Content.ReadAsByteArrayAsync())));
        var signatures = new SignatureUtil(pdf);
        var names = signatures.GetSignatureNames();
        Assert.Equal(2, names.Count);
        Assert.All(names, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(names[^1]));
    }
}
