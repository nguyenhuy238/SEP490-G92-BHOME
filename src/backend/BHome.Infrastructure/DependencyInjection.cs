using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Integrations;
using BHome.Infrastructure.Jobs;
using BHome.Application.Locations;
using BHome.Infrastructure.Locations;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Storage;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Modules.IncidentMaintenance;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace BHome.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // Resolve configuration after host composition so test/deployment overrides are honored.
        services.AddOptions<DatabaseOptions>()
            .Configure<IConfiguration>((options, config) => config.GetSection("ConnectionStrings").Bind(options))
            .Validate(options => !string.IsNullOrWhiteSpace(options.Database),
                "Configure ConnectionStrings:Database using user-secrets or environment variables.")
            .ValidateOnStart();
        services.AddDbContext<BHomeDbContext>((provider, options) =>
            options.UseNpgsql(provider.GetRequiredService<IOptions<DatabaseOptions>>().Value.Database));
        services.AddIdentityCore<ApplicationUser>(options =>
        {
            options.Password.RequiredLength = 12;
            options.User.RequireUniqueEmail = true;
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddRoles<IdentityRole<Guid>>().AddEntityFrameworkStores<BHomeDbContext>().AddSignInManager().AddDefaultTokenProviders();
        services.AddSingleton(TimeProvider.System);
        services.AddOptions<SessionOptions>().Bind(configuration.GetSection("Sessions"))
            .Validate(o => o.RefreshTokenDays is >= 1 and <= SessionOptions.MaximumLifetimeDays &&
                o.AbsoluteLifetimeDays is >= 1 and <= SessionOptions.MaximumLifetimeDays &&
                o.PasswordResetMinutes is >= 1 and <= 60,
                "Refresh/session lifetimes must be 1-7 days; password reset lifetime must be 1-60 minutes.").ValidateOnStart();
        services.AddOptions<DataProtectionTokenProviderOptions>().Configure<IOptions<SessionOptions>>((o, s) =>
            o.TokenLifespan = TimeSpan.FromMinutes(s.Value.PasswordResetMinutes));

        services.AddOptions<JwtOptions>().Bind(configuration.GetSection(JwtOptions.Section))
            .Validate(o => Encoding.UTF8.GetByteCount(o.SigningKey) >= 32 &&
                !o.SigningKey.Contains("replace", StringComparison.OrdinalIgnoreCase), "Supply a random JWT signing key of at least 32 bytes.")
            .Validate(o => !string.IsNullOrWhiteSpace(o.Issuer) && !string.IsNullOrWhiteSpace(o.Audience) &&
                o.LifetimeMinutes is >= 1 and <= 60, "JWT issuer, audience and a 1-60 minute lifetime are required.")
            .ValidateOnStart();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<JwtOptions>>((options, jwt) =>
            {
                var settings = jwt.Value;
                options.MapInboundClaims = false;
                options.IncludeErrorDetails = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = settings.Issuer,
                    ValidateAudience = true,
                    ValidAudience = settings.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
                    ValidateLifetime = true,
                    RequireExpirationTime = true,
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = "sub",
                    RoleClaimType = "role"
                };
                options.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async context =>
                    {
                        var principal = context.Principal!;
                        var stamp = principal.FindFirst("sstamp")?.Value;
                        if (!Guid.TryParse(principal.FindFirst("sub")?.Value, out var userId) || userId == Guid.Empty ||
                            !Guid.TryParse(principal.FindFirst("sid")?.Value, out var sessionId) || sessionId == Guid.Empty ||
                            string.IsNullOrWhiteSpace(stamp) || string.IsNullOrWhiteSpace(principal.FindFirst("jti")?.Value) ||
                            !await context.HttpContext.RequestServices.GetRequiredService<IAuthenticationSessions>().ValidateAsync(
                                new SessionIdentity(userId, sessionId, principal.FindAll("role").Select(x => x.Value).ToArray()),
                                stamp, context.HttpContext.RequestAborted))
                            context.Fail("Session is unavailable.");
                    }
                };
            });
        services.AddScoped<IAccessTokenIssuer, JwtTokenIssuer>();
        services.AddScoped<ICredentialVerifier, IdentityCredentialVerifier>();
        services.AddScoped<LoginService>();
        services.AddScoped<IdentitySecurityStore>();
        services.AddScoped<IAuthenticationSessions, IdentitySessionService>();
        services.AddScoped<IPasswordService, IdentityPasswordService>();
        services.AddScoped<ISecurityAudit, IdentitySecurityAudit>();
        services.AddScoped<IPasswordResetDelivery, UnconfiguredPasswordResetDelivery>();
        services.AddScoped<PostgresLocationAssignments>();
        services.AddScoped<ILocationAssignments>(provider => provider.GetRequiredService<PostgresLocationAssignments>());
        services.AddScoped<IStaffLocationAccess>(provider => provider.GetRequiredService<PostgresLocationAssignments>());
        services.AddScoped<CaptureScope>();
        services.AddScoped<ResourceAccess>();
        services.AddScoped<PermissionAccess>();
        services.AddScoped<BHome.Application.PropertyManagement.IPropertyRepository,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.PostgresPropertyRepository>();
        services.AddScoped<BHome.Application.PropertyManagement.PropertyService>();
        services.AddScoped<IBankTransactionProvider, UnconfiguredBankProvider>();
        services.AddScoped<INotificationProvider, UnconfiguredNotificationProvider>();
        services.AddScoped<IElectronicContractProvider, UnconfiguredElectronicContractProvider>();
        services.AddScoped<BHome.Application.Contracts.IContractRepository, BHome.Infrastructure.Contracts.ContractRepository>();
        services.AddScoped<BHome.Application.Contracts.ContractService>();
        services.AddScoped<BHome.Application.Contracts.IContractSigningProvider, BHome.Infrastructure.Contracts.ViettelMySignContractAdapter>();
        services.AddScoped<BHome.Application.Contracts.IContractDocumentRenderer, BHome.Infrastructure.Contracts.UnconfiguredContractRenderer>();
        services.AddScoped<BHome.Application.Contracts.IContractSettlementLedger, BHome.Infrastructure.Contracts.PendingContractSettlementLedger>();
        services.AddScoped<BHome.Application.Contracts.IContractHoldingLedger, BHome.Infrastructure.Contracts.UnconfiguredContractHoldingLedger>();
        services.AddScoped<BHome.Application.Contracts.IContractFileStore, BHome.Infrastructure.Contracts.ContractFileStore>();
        services.AddSingleton<BHome.Application.Contracts.IContractImageValidator, BHome.Infrastructure.Contracts.ContractImageValidator>();
        services.AddHostedService<BHome.Infrastructure.Contracts.ContractFileCleanup>();
        services.AddSingleton<BHome.DigitalSigning.Application.IPdfSigner, BHome.Infrastructure.Contracts.UnconfiguredContractPdfSigner>();
        services.AddScoped<BHome.DigitalSigning.Application.IViettelAccountSource, BHome.Infrastructure.Contracts.ContractMySignAccount>();
        BHome.DigitalSigning.MySign.MySignRegistration.AddMySignClient(services);
        services.AddScoped<BHome.DigitalSigning.Application.ISigningCertificateStore, BHome.Infrastructure.Contracts.ContractSigningCertificateStore>();
        services.AddScoped<BHome.DigitalSigning.Application.Services.SigningCertificateService>();
        services.AddOptions<OcrOptions>().Bind(configuration.GetSection("Ocr"))
            .Validate(o => o.IsValid(), "OCR limits or profiles are outside supported bounds.").ValidateOnStart();
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<OcrOptions>>().Value);
        services.AddSingleton<IImagePreprocessor, ImagePreprocessor>();
        services.AddSingleton<IOcrEngine, OnnxOcrEngine>();
        services.AddSingleton(provider => new Lazy<IOcrEngine>(provider.GetRequiredService<IOcrEngine>));
        services.AddSingleton<IOcrService, LocalOcrService>();
        services.AddHostedService<OcrWarmup>();
        services.AddScoped<IOcrWorkflowResources, CaptureWorkflowResources>();
        services.AddScoped<OcrWorkflowService>();
        services.AddScoped<ICaptureRepository, CaptureRepository>();
        services.AddScoped<CaptureService>();
        services.AddHostedService<MeterEvidenceCleanup>();
        services.AddOptions<IdentityProtectionOptions>().Bind(configuration.GetSection("IdentityProtection"));
        services.AddSingleton<IIdentityProtection, IdentityProtection>();
        services.AddOptions<ObjectStorageOptions>().Bind(configuration.GetSection(ObjectStorageOptions.Section));
        services.AddScoped<IObjectStorage, MinioObjectStorage>();
        services.AddOptions<JobWorkerOptions>().Bind(configuration.GetSection("Jobs"))
            .Validate(o => o.PollSeconds is >= 1 and <= 300, "Job polling must be 1-300 seconds.").ValidateOnStart();
        services.AddScoped<IBackgroundJobQueue, PostgresJobQueue>();
        services.AddHostedService<PostgresJobWorker>();
        services.AddIncidentMaintenance(configuration);
        return services;
    }
}
