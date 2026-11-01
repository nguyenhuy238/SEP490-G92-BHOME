using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.TenantContracts;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Unit")]
public sealed class ContractWorkflowGuardTests
{
    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData(null)]
    public void SimulationCannotBeEnabledOutsideExplicitDevelopmentOrTesting(string? environment)
    {
        using var backend = ContractPdfRendererTests.Backend(environment, simulation: true);
        Assert.Throws<OptionsValidationException>(() => backend.GetRequiredService<IContractWorkflowMode>().SimulatedSigningEnabled);
    }
    [Theory]
    [InlineData("Development")]
    [InlineData("Testing")]
    public async Task SimulatedAdapterMarksPdfVisiblyWithoutCreatingAnyDigitalSignature(string environment)
    {
        using var backend = ContractPdfRendererTests.Backend(environment, simulation: true);
        using var scope = backend.CreateScope();
        var type = typeof(BHome.Infrastructure.Contracts.ViettelMySignContractAdapter).Assembly.GetType("BHome.Infrastructure.Contracts.DevelopmentContractSigningAdapter", true)!;
        var adapter = (IContractSigningProvider)ActivatorUtilities.CreateInstance(scope.ServiceProvider, type, new Actor());
        var input = ContractPdfRendererTests.Snapshot();
        var result = await adapter.PrepareAsync(input, Guid.Empty, null, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(result.PreparedPdf)));
        Assert.Empty(new SignatureUtil(pdf).GetSignatureNames());
        Assert.Contains("SIMULATED SIGNING - NOT LEGALLY SIGNED", ContractPdfRendererTests.Text(pdf));
        Assert.Equal("SIMULATED SIGNING - NO LEGAL SIGNATURE", pdf.GetDocumentInfo().GetMoreInfo("BHomeSigningMode"));
        var signature = new ContractSignature { ContractId = input.ContractId, SignerUserId = Actor.Id };
        signature.ProviderReference = await adapter.RequestAsync(signature, default);
        Assert.Equal("Simulated", (await adapter.PollAsync(signature, result.PreparedPdf, default)).State);
    }
    private sealed class Actor : ICurrentUser
    { public static readonly Guid Id = Guid.NewGuid(); public Guid? UserId => Id; public bool IsInRole(string role) => role == "Owner"; }
}
