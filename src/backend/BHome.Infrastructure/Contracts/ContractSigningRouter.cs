using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Contracts;

// Which signing methods this deployment offers. SIMULATED replaces every real method while the labelled Development
// simulation is on, because simulated contracts only complete with simulated signatures.
internal sealed class ContractSigningMethods(IOptions<ContractSigningOptions> options, IContractWorkflowMode mode) : IContractSigningMethods
{
    public IReadOnlyList<string> Enabled
    {
        get
        {
            if (mode.SimulatedSigningEnabled) return [SigningMethods.Simulated];
            var methods = new List<string>();
            if (options.Value.Methods.Otp) methods.Add(SigningMethods.Otp);
            if (options.Value.Methods.ViettelMySign) methods.Add(SigningMethods.ViettelMySign);
            if (options.Value.Methods.UploadProof) methods.Add(SigningMethods.UploadProof);
            return methods;
        }
    }

    public bool IsEnabled(string method) => Enabled.Contains(method, StringComparer.OrdinalIgnoreCase);
}

// Chooses the provider per signature instead of one provider for the whole deployment: an OTP signature is marked by
// its credential, every other one goes to the simulation or Viettel MySign as before.
internal sealed class ContractSigningRouter(IContractSigningMethods methods, IContractWorkflowMode mode, IServiceProvider services)
    : IContractSigningProvider
{
    internal const string OtpCredential = "BHOME-OTP";
    internal const string UploadCredential = "BHOME-UPLOAD-PROOF";

    private IContractSigningProvider Otp() => methods.IsEnabled(SigningMethods.Otp)
        ? services.GetRequiredService<OtpContractSigningAdapter>()
        : throw new ContractException(503, "signing_method_disabled");

    private IContractSigningProvider Upload() => methods.IsEnabled(SigningMethods.UploadProof)
        ? services.GetRequiredService<UploadProofContractSigningAdapter>()
        : throw new ContractException(503, "signing_method_disabled");

    private IContractSigningProvider Certificate()
    {
        if (mode.SimulatedSigningEnabled) return services.GetRequiredService<DevelopmentContractSigningAdapter>();
        return methods.IsEnabled(SigningMethods.ViettelMySign)
            ? services.GetRequiredService<ViettelMySignContractAdapter>()
            : throw new ContractException(503, "signing_method_disabled");
    }

    private IContractSigningProvider For(ContractSignature signature) => signature.CredentialId switch
    {
        OtpCredential => Otp(),
        UploadCredential => Upload(),
        _ => Certificate()
    };
    private IContractSigningProvider For(SigningAppearance appearance) =>
        SigningMethods.IsOtp(appearance.Method) ? Otp() : SigningMethods.IsUploadProof(appearance.Method) ? Upload() : Certificate();

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
        => Certificate().PrepareAsync(document, certificateId, previousPdf, t);

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf,
        SigningAppearance appearance, CancellationToken t) => For(appearance).PrepareAsync(document, certificateId, previousPdf, appearance, t);

    // The layout screen shows the picture and name of the method the signer will use: OTP first when it is offered.
    public Task<(bool HasPicture, string SignerName)> SignerAsync(CancellationToken t)
    {
        if (methods.IsEnabled(SigningMethods.Otp)) return Otp().SignerAsync(t);
        if (methods.Enabled.Count == 0) return Task.FromResult((false, ""));
        return Certificate().SignerAsync(t);
    }

    public Task<string> RequestAsync(ContractSignature signature, CancellationToken t) => For(signature).RequestAsync(signature, t);
    public Task<SigningOutcome> PollAsync(ContractSignature signature, byte[] preparedPdf, CancellationToken t) => For(signature).PollAsync(signature, preparedPdf, t);
    public Task<SigningOutcome> ConfirmAsync(ContractSignature signature, byte[] preparedPdf, string code, CancellationToken t)
        => For(signature).ConfirmAsync(signature, preparedPdf, code, t);
    public Task<SigningOtpView> ResendAsync(ContractSignature signature, CancellationToken t) => For(signature).ResendAsync(signature, t);
    public Task<SigningOtpView?> ChallengeAsync(ContractSignature signature, CancellationToken t) => For(signature).ChallengeAsync(signature, t);
    public Task<SigningOutcome> CompleteUploadAsync(ContractSignature signature, byte[] issuedPdf, byte[] uploadedPdf, CancellationToken t)
        => For(signature).CompleteUploadAsync(signature, issuedPdf, uploadedPdf, t);
}
