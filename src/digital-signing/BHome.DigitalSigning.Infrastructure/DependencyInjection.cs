using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Application.Services;
using BHome.DigitalSigning.Infrastructure.Pdf;
using BHome.DigitalSigning.Infrastructure.Persistence;
using BHome.DigitalSigning.Infrastructure.Security;
using BHome.DigitalSigning.Infrastructure.Viettel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.DigitalSigning.Infrastructure;

public static class DependencyInjection
{
    // Expects ICurrentUser to be registered by the host (BHome.Api does) and ConnectionStrings:Database to be set.
    public static IServiceCollection AddDigitalSigning(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(DigitalSigningOptions.Section).Get<DigitalSigningOptions>() ?? new();
        if (options.TransactionTtlSeconds is < 60 or > 900)
            throw new InvalidOperationException("DigitalSigning:TransactionTtlSeconds must be 60-900.");
        if (options.Viettel.TimeoutSeconds is < 1 or > 120)
            throw new InvalidOperationException("DigitalSigning:Viettel:TimeoutSeconds must be 1-120.");
        if (options.SignatureFontSize is < 6 or > 36)
            throw new InvalidOperationException("DigitalSigning:SignatureFontSize must be 6-36.");

        var viettel = options.Viettel;
        services.AddSingleton(new DigitalSigningPolicy(
            TimeSpan.FromSeconds(options.TransactionTtlSeconds),
            options.MaxPdfMegabytes * 1024L * 1024L,
            new ViettelAccount(viettel.BaseUrl, viettel.ClientId, viettel.ClientSecret, viettel.ProfileId, viettel.LoginPath,
                viettel.CredentialsPath, viettel.SignHashPath, viettel.StatusPath, viettel.TimeoutSeconds)));
        services.AddSingleton(new PdfAppearanceOptions { FontSize = options.SignatureFontSize });
        services.AddSingleton<ISecretProtector>(new AesGcmSecretProtector(options.SecretKey));
        services.TryAddSingleton(TimeProvider.System);

        services.AddDbContext<DigitalSigningDbContext>(db => db.UseNpgsql(configuration.GetConnectionString("Database")));
        services.AddScoped<IDigitalSigningStore, EfDigitalSigningStore>();
        services.AddScoped<ISigningSettingsStore, EfSigningSettingsStore>();
        services.AddScoped<ISignatureImageStore, EfSignatureImageStore>();

        // The client's own timeout is off: each call is bounded by the account's TimeoutSeconds instead.
        services.AddHttpClient(ViettelMySignProvider.HttpClientName, client => client.Timeout = Timeout.InfiniteTimeSpan);
        services.AddSingleton<ViettelTokenCache>();
        services.AddScoped<ISigningProvider, ViettelMySignProvider>();
        services.AddSingleton<IPdfSigner, ITextPdfSigner>();

        services.AddSingleton<SigningAccountCache>();
        services.AddScoped<SigningAccountService>();
        services.AddScoped<IViettelAccountSource>(provider => provider.GetRequiredService<SigningAccountService>());
        services.AddScoped<SigningCertificateService>();
        services.AddScoped<RemoteSigningService>();
        services.AddScoped<SignatureImageService>();
        return services;
    }
}
