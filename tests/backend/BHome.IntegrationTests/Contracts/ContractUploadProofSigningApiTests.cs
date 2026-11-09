using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.DigitalSigning.Application;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Contracts;

// Owner signs with their own certificate outside BHOME (Viettel MySign registered through VNeID; here a synthetic
// "Viettel-CA" test certificate) and uploads the file; the Tenant then signs in the app with an emailed OTP.
// Expected behaviour: agreed 09/11/2026 + BHOME_OTP_Signing_Plan.md §7 (SRS v1.3 UC-15, DBR-03).
public sealed partial class ContractLifecycleApiTests
{
    [Fact]
    public async Task OwnerUploadsAMySignSignedPdfThenTenantSignsWithOtpAndBothSignaturesStayValid()
    {
        var w = await Setup();
        var id = (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts", Input(w)))).Id;
        var email = new CapturedEmail();
        await using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ContractPdf:TemplateId"] = ContractPdfRendererTests.TemplateId,
                ["ContractSigning:Methods:Otp"] = "true",
                ["ContractSigning:Methods:UploadProof"] = "true"
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

        // Owner is offered UPLOAD_PROOF by default; the Tenant is not offered it at all.
        Assert.Equal(SigningMethods.UploadProof, (await owner.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!.Default);
        var tenantMethods = (await tenant.Client.GetFromJsonAsync<SigningMethodsView>("/api/v1/contracts/signing-methods"))!;
        Assert.DoesNotContain(SigningMethods.UploadProof, tenantMethods.Methods);
        Assert.Equal(SigningMethods.Otp, tenantMethods.Default);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, Path(id, "signing"),
            new SigningInput(Guid.Empty, Method: SigningMethods.UploadProof), Guid.NewGuid())).StatusCode);

        // 1. Owner starts: BHOME keeps the exact PDF to sign; nothing is sent anywhere.
        var started = await Success<SignatureView>(await Post(owner, Path(id, "signing"),
            new SigningInput(Guid.Empty, Method: SigningMethods.UploadProof), Guid.NewGuid()));
        Assert.Equal("Pending", started.Status);
        var issued = await owner.Client.GetByteArrayAsync(Path(id, "signing/upload-source"));
        Assert.Equal("%PDF-"u8.ToArray(), issued[..5]);

        // 2. Owner signs it outside BHOME with their own certificate.
        using var key = RSA.Create(2048);
        using var certificate = new CertificateRequest("CN=CHU TRO TONG HOP, O=Viettel-CA Synthetic Test", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        X509Certificate2[] chain = [certificate];
        var signer = host.Services.GetRequiredService<IPdfSigner>();
        var prepared = signer.Prepare(issued, chain, DateTimeOffset.UtcNow, new VisibleSignature(1, 0.1, 0.75, 0.35, "Ký bởi: CHỦ TRỌ"));
        var ownerSigned = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, chain,
            key.SignHash(prepared.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));

        // A file that is not the issued PDF plus a signature is refused and changes nothing.
        var unsigned = await Upload(owner, id, issued);
        Assert.Equal(HttpStatusCode.BadRequest, unsigned.StatusCode);
        Assert.Contains("signed_pdf_not_from_issued_contract", await unsigned.Content.ReadAsStringAsync());

        // 3. The signed file is accepted once; the Tenant is invited by email.
        var uploadKey = Guid.NewGuid();
        var accepted = await Upload(owner, id, ownerSigned, uploadKey);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var afterOwner = (await accepted.Content.ReadFromJsonAsync<ContractView>())!;
        Assert.Equal("Signed", Assert.Single(afterOwner.Signatures, s => s.SignerUserId == w.Owner.Id).Status);
        Assert.Equal(HttpStatusCode.OK, (await Upload(owner, id, ownerSigned, uploadKey)).StatusCode);
        Assert.Contains(email.Sent, m => m.EventType == "CONTRACT_SIGNING_INVITATION" && m.Destination == w.Tenant.Id.ToString("N") + "@example.invalid");

        // 4. Tenant signs on top of the Owner's signed file with an emailed OTP.
        await Success<SignatureView>(await Post(tenant, Path(id, "signing"), new SigningInput(Guid.Empty, Method: SigningMethods.Otp), Guid.NewGuid()));
        var otpMail = Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP");
        var code = otpMail.Title[(otpMail.Title.LastIndexOf(' ') + 1)..];
        var done = await Success<ContractView>(await Post(tenant, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code), Guid.NewGuid()));
        Assert.Equal("PendingActivation", done.Status);

        await Deposit(w, id);
        await Success<ContractView>(await Post(w.Owner, Path(id, "activate")));
        using var final = new PdfDocument(new PdfReader(new MemoryStream(await tenant.Client.GetByteArrayAsync(Path(id, "document")))));
        var signatures = new SignatureUtil(final);
        var names = signatures.GetSignatureNames();
        Assert.Equal(2, names.Count);
        Assert.All(names, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.Contains("Viettel-CA", signatures.ReadSignatureData(names[0]).GetSigningCertificate().GetIssuerDN().ToString());
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
