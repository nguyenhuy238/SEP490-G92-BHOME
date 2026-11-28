using System.Net;
using System.Net.Http.Headers;
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

// Retired upload requests cannot change the contract. The supported Owner-session and Tenant-OTP
// workflow must still preserve both PDF signatures, invitation delivery, and idempotent consent.
public sealed partial class ContractLifecycleApiTests
{
    [Theory, InlineData(false), InlineData(true)]
    public async Task OwnerUploadsAMySignSignedPdfThenTenantSignsWithOtpAndBothSignaturesStayValid(bool holding = false)
    {
        if (await RunHoldingSigningOnNativeSchemaAsync(holding, tests => tests.OwnerUploadsAMySignSignedPdfThenTenantSignsWithOtpAndBothSignaturesStayValid(true))) return;
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

        var ownerMethods = (await owner.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!;
        Assert.Equal(SigningMethods.OwnerSession, ownerMethods.Default);
        Assert.DoesNotContain(SigningMethods.UploadProof, ownerMethods.Methods);
        var tenantMethods = (await tenant.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!;
        Assert.DoesNotContain(SigningMethods.UploadProof, tenantMethods.Methods);
        Assert.Equal(SigningMethods.Otp, tenantMethods.Default);
        foreach (var actor in new[] { owner, tenant })
        {
            var retired = await Post(actor, Path(id, "signing"),
                new SigningInput(Guid.Empty, Method: SigningMethods.UploadProof), Guid.NewGuid());
            Assert.Equal(HttpStatusCode.BadRequest, retired.StatusCode);
            Assert.Contains("signing_method_invalid", await retired.Content.ReadAsStringAsync());
        }
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(Path(id, "signing/upload-source"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Upload(owner, id, "%PDF-"u8.ToArray())).StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Signatures);

        var sessionInput = new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true);
        var sessionKey = Guid.NewGuid();
        var started = await Success<SignatureView>(await Post(owner, Path(id, "signing"), sessionInput, sessionKey));
        Assert.Equal("Signed", started.Status);
        Assert.Equal(started.Id, (await Success<SignatureView>(await Post(owner, Path(id, "signing"), sessionInput, sessionKey))).Id);
        var afterOwner = (await owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!;
        Assert.Equal("Signed", Assert.Single(afterOwner.Signatures, s => s.SignerUserId == w.Owner.Id).Status);
        Assert.Contains(email.Sent, m => m.EventType == "CONTRACT_SIGNING_INVITATION" && m.Destination == w.Tenant.Id.ToString("N") + "@example.invalid");

        // 4. Tenant signs on top of the Owner's signed file with an emailed OTP.
        await Success<SignatureView>(await Post(tenant, Path(id, "signing"), new SigningInput(Guid.Empty, Method: SigningMethods.Otp), Guid.NewGuid()));
        var otpMail = Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP");
        var code = otpMail.Title[(otpMail.Title.LastIndexOf(' ') + 1)..];
        var done = await Success<ContractView>(await Post(tenant, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code), Guid.NewGuid()));
        Assert.Equal("PendingActivation", done.Status);

        if (!holding)
        {
            await Deposit(w, id);
            await Success<ContractView>(await Post(w.Owner, Path(id, "activate")));
        }
        using var final = new PdfDocument(new PdfReader(new MemoryStream(await tenant.Client.GetByteArrayAsync(Path(id, "document")))));
        var signatures = new SignatureUtil(final);
        var names = signatures.GetSignatureNames();
        Assert.Equal(2, names.Count);
        Assert.All(names, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(names[^1]));
    }

    private static async Task<HttpResponseMessage> Upload(Actor actor, Guid id, byte[] pdf, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, Path(id, "signing/upload")) { Content = new ByteArrayContent(pdf) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return await actor.Client.SendAsync(request);
    }
}
