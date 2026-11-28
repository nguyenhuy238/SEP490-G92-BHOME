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
            methods.Add(SigningMethods.OwnerSession);
            if (options.Value.Methods.Otp) methods.Add(SigningMethods.Otp);
            return methods;
        }
    }

    public bool IsEnabled(string method) => Enabled.Contains(method, StringComparer.OrdinalIgnoreCase);
}

// Chooses the provider per signature instead of one provider for the whole deployment: an OTP signature is marked by
// its credential; only explicit demo credentials may reach simulation.
internal sealed class ContractSigningRouter(IContractSigningMethods methods, IContractWorkflowMode mode, IServiceProvider services)
    : IContractSigningProvider
{
    internal const string OtpCredential = "BHOME-OTP";
    internal const string OwnerSessionCredential = "BHOME-OWNER-SESSION";
    internal const string TenantSessionCredential = "BHOME-TENANT-SESSION";

    private IContractSigningProvider Otp() => methods.IsEnabled(SigningMethods.Otp)
        ? services.GetRequiredService<OtpContractSigningAdapter>()
        : throw new ContractException(503, "signing_method_disabled");

    private IContractSigningProvider Simulation() => mode.SimulatedSigningEnabled
        ? services.GetRequiredService<DevelopmentContractSigningAdapter>()
        : throw new ContractException(503, "signing_method_disabled");

    private IContractSigningProvider For(ContractSigning signature) => signature.CredentialId switch
    {
        OtpCredential => Otp(),
        OwnerSessionCredential => services.GetRequiredService<OtpContractSigningAdapter>(),
        TenantSessionCredential => services.GetRequiredService<OtpContractSigningAdapter>(),
        "SIMULATED-NO-CERTIFICATE" => Simulation(),
        _ => throw ContractException.Conflict("signing_method_retired")
    };
    private IContractSigningProvider For(SigningAppearance appearance) =>
        SigningMethods.IsOwnerSession(appearance.Method) || SigningMethods.IsTenantSession(appearance.Method)
            ? services.GetRequiredService<OtpContractSigningAdapter>() :
        SigningMethods.IsOtp(appearance.Method) ? Otp() :
        appearance.Method is null || string.Equals(appearance.Method, SigningMethods.Simulated, StringComparison.OrdinalIgnoreCase)
            ? Simulation() : throw ContractException.Conflict("signing_method_retired");

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
        => Simulation().PrepareAsync(document, certificateId, previousPdf, t);

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf,
        SigningAppearance appearance, CancellationToken t) => For(appearance).PrepareAsync(document, certificateId, previousPdf, appearance, t);

    // The layout screen shows the picture and name of the method the signer will use: OTP first when it is offered.
    public Task<(bool HasPicture, string SignerName)> SignerAsync(CancellationToken t)
    {
        if (methods.IsEnabled(SigningMethods.OwnerSession) || methods.IsEnabled(SigningMethods.Otp))
            return services.GetRequiredService<OtpContractSigningAdapter>().SignerAsync(t);
        if (methods.Enabled.Count == 0) return Task.FromResult((false, ""));
        return Simulation().SignerAsync(t);
    }

    public Task<string> RequestAsync(ContractSigning signature, CancellationToken t) => For(signature).RequestAsync(signature, t);
    public Task<SigningOutcome> PollAsync(ContractSigning signature, byte[] preparedPdf, CancellationToken t) => For(signature).PollAsync(signature, preparedPdf, t);
    public Task<SigningOutcome> ConfirmAsync(ContractSigning signature, byte[] preparedPdf, string code, CancellationToken t)
        => For(signature).ConfirmAsync(signature, preparedPdf, code, t);
    public Task<SigningOtpView> ResendAsync(ContractSigning signature, CancellationToken t) => For(signature).ResendAsync(signature, t);
    public Task<SigningOtpView?> ChallengeAsync(ContractSigning signature, CancellationToken t) => For(signature).ChallengeAsync(signature, t);
}
