using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Contracts;

// OTP email signing end to end through the API. Expected behaviour: BHOME_OTP_Signing_Plan.md §7 (SRS v1.3 UC-15
// "Owner and Tenant electronically sign", DBR-03 signing status and evidence; decisions D1/D2/D6).
public sealed partial class ContractLifecycleApiTests
{
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

    [Fact]
    public async Task OwnerThenTenantSignWithEmailedOtpAndTheSealedPdfKeepsBothSignatures()
    {
        var w = await Setup();
        var id = (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts", Input(w)))).Id;
        var email = new CapturedEmail();
        await using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ContractPdf:TemplateId"] = ContractPdfRendererTests.TemplateId,
                ["ContractSigning:Methods:Otp"] = "true"
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
        Assert.Contains(SigningMethods.Otp, methods.Methods);
        Assert.Equal(SigningMethods.Otp, (await tenant.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!.Default);

        static string EmailOf(Actor actor) => actor.Id.ToString("N") + "@example.invalid";
        foreach (var (signer, account) in new[] { (owner, EmailOf(owner)), (tenant, EmailOf(tenant)) })
        {
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
        Assert.Contains(email.Sent, m => m.EventType == "CONTRACT_SIGNING_INVITATION" && m.Destination == EmailOf(tenant));
        Assert.Equal(2, email.Sent.Count(m => m.EventType == "CONTRACT_FULLY_SIGNED"));
        var contract = (await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!;
        Assert.Equal("PendingActivation", contract.Status);

        await Deposit(w, id);
        await Success<ContractView>(await Post(w.Owner, Path(id, "activate")));
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
