using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Integrations;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Storage;
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
        }).AddRoles<IdentityRole<Guid>>().AddEntityFrameworkStores<BHomeDbContext>().AddSignInManager();

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
            });
        services.AddScoped<IAccessTokenIssuer, JwtTokenIssuer>();
        services.AddScoped<ICredentialVerifier, IdentityCredentialVerifier>();
        services.AddScoped<LoginService>();
        services.AddScoped<IStaffLocationAccess, UnconfiguredStaffLocationAccess>();
        services.AddScoped<ResourceAccess>();
        services.AddScoped<IBankTransactionProvider, UnconfiguredBankProvider>();
        services.AddScoped<INotificationProvider, UnconfiguredNotificationProvider>();
        services.AddScoped<IElectronicContractProvider, UnconfiguredElectronicContractProvider>();
        services.AddScoped<IOcrService, UnconfiguredOcrService>();
        services.AddOptions<ObjectStorageOptions>().Bind(configuration.GetSection(ObjectStorageOptions.Section));
        services.AddScoped<IObjectStorage, MinioObjectStorage>();
        services.AddOptions<JobWorkerOptions>().Bind(configuration.GetSection("Jobs"))
            .Validate(o => o.PollSeconds is >= 1 and <= 300, "Job polling must be 1-300 seconds.").ValidateOnStart();
        services.AddScoped<IBackgroundJobQueue, PostgresJobQueue>();
        services.AddHostedService<PostgresJobWorker>();
        return services;
    }
}
