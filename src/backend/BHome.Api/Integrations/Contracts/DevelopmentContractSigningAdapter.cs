using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.TenantContracts;
using iText.Kernel.Pdf;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractWorkflowOptions
{
    public bool SimulatedSigningEnabled { get; set; }
}

internal sealed class ContractWorkflowOptionsValidator(IHostEnvironment? environment = null) : IValidateOptions<ContractWorkflowOptions>
{
    public ValidateOptionsResult Validate(string? name, ContractWorkflowOptions options) =>
        !options.SimulatedSigningEnabled || environment is not null && (environment.IsDevelopment() || environment.IsEnvironment("Testing"))
            ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail("Simulated signing is restricted to Development/Testing.");
}

internal sealed class ContractWorkflowMode(IOptions<ContractWorkflowOptions> options) : IContractWorkflowMode
{
    public bool SimulatedSigningEnabled => options.Value.SimulatedSigningEnabled;
}

// No CA, certificate or private signing key is created. This is an explicitly labelled simulation.
internal sealed class DevelopmentContractSigningAdapter(IContractDocumentRenderer renderer, IContractWorkflowMode mode,
    ICurrentUser user, IContractSigningDocumentSource documents) : IContractSigningProvider
{
    private void RequireDemo()
    {
        if (!mode.SimulatedSigningEnabled) throw new ContractException(503, "simulated_signing_disabled");
        if (user.UserId is null) throw new ContractException(401, "authentication_required");
    }

    public async Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
    {
        RequireDemo();
        var reviewed = await documents.ReadAsync(document, t);
        if (reviewed is null) await renderer.ValidateAsync(document, t);
        var source = previousPdf ?? reviewed ?? await renderer.RenderAsync(document, t);
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(source)), new PdfWriter(output)))
        {
            pdf.GetDocumentInfo().SetMoreInfo("BHomeSigningMode", "SIMULATED SIGNING - NO LEGAL SIGNATURE");
            pdf.GetDocumentInfo().SetMoreInfo("BHomeSimulationActor-" + user.UserId, "SIMULATED - NOT A DIGITAL SIGNATURE");
        }
        return new(source, output.ToArray(), "SIMULATED", "", "", "", user.UserId!.Value.ToString(), "SIMULATED-NO-CERTIFICATE");
    }

    public Task<string> RequestAsync(ContractSigning signature, CancellationToken t)
    {
        RequireDemo(); t.ThrowIfCancellationRequested();
        return Task.FromResult("SIMULATED-" + signature.Id.ToString("N"));
    }

    public Task<SigningOutcome> PollAsync(ContractSigning signature, byte[] preparedPdf, CancellationToken t)
    {
        RequireDemo(); t.ThrowIfCancellationRequested();
        if (signature.ProviderReference != "SIMULATED-" + signature.Id.ToString("N") || signature.SignerUserId != user.UserId)
            throw ContractException.Conflict("signing_mode_mismatch");
        return Task.FromResult(new SigningOutcome("Simulated", preparedPdf));
    }
}
