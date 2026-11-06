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
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Storage;
using BHome.Infrastructure.Ocr;
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
        services.AddDbContext<Compact24DbContext>((provider, options) =>
            options.UseNpgsql(provider.GetRequiredService<IOptions<DatabaseOptions>>().Value.Database));
        services.AddScoped<BHomePersistenceContext>(p => p.GetRequiredService<Compact24DbContext>());
        services.AddIdentityCore<ApplicationUser>(options =>
        {
            options.Password.RequiredLength = 12;
            options.User.RequireUniqueEmail = true;
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddRoles<IdentityRole<Guid>>().AddUserStore<CompactUserStore>().AddRoleStore<CompactRoleStore>().AddSignInManager().AddDefaultTokenProviders();
        services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, CompactClaimsPrincipalFactory>();
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
        services.AddScoped<IIdentityPersistence, CompactIdentityPersistence>();
        services.AddScoped<IAuthenticationSessions, IdentitySessionService>();
        services.AddScoped<IPasswordService, IdentityPasswordService>();
        services.AddScoped<ISecurityAudit, IdentitySecurityAudit>();
        services.AddScoped<IPasswordResetDelivery, UnconfiguredPasswordResetDelivery>();
        services.AddScoped<CompactLocationAssignments>();
        services.AddScoped<ILocationAssignments>(provider => provider.GetRequiredService<CompactLocationAssignments>());
        services.AddScoped<IStaffLocationAccess>(provider => provider.GetRequiredService<CompactLocationAssignments>());
        services.AddScoped<CaptureScope>();
        services.AddScoped<ResourceAccess>();
        services.AddScoped<PermissionAccess>();
        services.AddOptions<BHome.Application.StaffOperations.TaskEvidenceLimits>().Bind(configuration.GetSection("OperationalTasks:Evidence"))
            .Validate(o => o.MaximumFilesPerTask is >= 1 and <= 50 && o.MaximumFileBytes is >= 1024 and <= 20 * 1024 * 1024,
                "Task evidence limits must be 1-50 files and 1 KiB-20 MiB per file.").ValidateOnStart();
        services.AddSingleton(p => p.GetRequiredService<IOptions<BHome.Application.StaffOperations.TaskEvidenceLimits>>().Value);
        services.AddScoped<BHome.Application.StaffOperations.IOperationalTaskRepository,
            BHome.Infrastructure.Modules.StaffOperations.Persistence.PostgresOperationalTaskRepository>();
        services.AddScoped<BHome.Application.StaffOperations.ITaskEvidenceFiles, BHome.Infrastructure.Modules.StaffOperations.TaskEvidenceFiles>();
        services.AddScoped<BHome.Application.StaffOperations.OperationalTaskService>();
        services.AddHostedService<BHome.Infrastructure.Modules.StaffOperations.TaskEvidenceCleanup>();
        services.AddScoped<BHome.Application.Operations.IOperationsRepository,
            BHome.Infrastructure.Modules.Operations.CompactOperationsRepository>();
        services.AddScoped<BHome.Application.Operations.IOperationsFiles,
            BHome.Infrastructure.Modules.Operations.OperationsFiles>();
        services.AddScoped<BHome.Application.Operations.OperationsService>();
        services.AddScoped<BHome.Infrastructure.Modules.Operations.RecurringOperationsJob>();
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Operations.RecurringOperationsJob>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Operations.RecurringOperationsJob>());
        services.AddScoped<BHome.Application.PropertyManagement.IPropertyRepository,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.PostgresPropertyRepository>();
        services.AddScoped<BHome.Application.PropertyManagement.IRoomInsightsRepository,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.PostgresRoomInsightsRepository>();
        services.AddScoped<BHome.Application.PropertyManagement.PropertyService>();
        services.AddScoped<BHome.Application.IncidentMaintenance.IIncidentRepository, BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentRepository>();
        services.AddScoped<BHome.Application.IncidentMaintenance.IIncidentFiles, BHome.Infrastructure.Modules.IncidentMaintenance.IncidentFiles>();
        services.AddScoped<BHome.Application.IncidentMaintenance.IncidentService>();
        services.AddScoped<IBackgroundJobHandler, BHome.Infrastructure.Modules.IncidentMaintenance.IncidentNotificationDelivery>();
        services.AddHostedService<BHome.Infrastructure.Modules.IncidentMaintenance.IncidentFileCleanup>();
        services.AddScoped<IBankTransactionProvider, UnconfiguredBankProvider>();
        services.AddScoped<INotificationProvider, UnconfiguredNotificationProvider>();
        services.AddScoped<IElectronicContractProvider, UnconfiguredElectronicContractProvider>();
        services.AddScoped<BHome.Application.Contracts.IContractRepository, BHome.Infrastructure.Contracts.ContractRepository>();
        services.AddScoped<BHome.Application.Contracts.ContractService>();
        services.AddScoped<BHome.Application.Contracts.IAdministrativeContractReadiness>(provider =>
            provider.GetRequiredService<BHome.Application.Contracts.ContractService>());
        services.AddScoped<BHome.Application.Contracts.MainDraftService>();
        services.AddScoped<BHome.Application.Finance.IExpenseRepository, BHome.Infrastructure.Finance.ExpenseRepository>();
        services.AddScoped<BHome.Application.Finance.ExpenseService>();
        services.AddScoped<BHome.Application.Finance.IExpenseEvidenceRepository, BHome.Infrastructure.Finance.ExpenseEvidenceRepository>();
        services.AddScoped<BHome.Application.Finance.ExpenseEvidenceService>();
        services.AddScoped<BHome.Application.Finance.IFinancialReportRepository, BHome.Infrastructure.Finance.FinancialReportRepository>();
        services.AddScoped<BHome.Application.Finance.IRefundRepository, BHome.Infrastructure.Finance.RefundRepository>();
        services.AddScoped<BHome.Application.Finance.RefundService>();
        services.AddScoped<BHome.Application.Finance.FinancialReportService>();
        services.AddScoped<BHome.Application.Finance.IFinancialScenarioRepository, BHome.Infrastructure.Finance.FinancialScenarioRepository>();
        services.AddScoped<BHome.Application.Finance.FinancialScenarioService>();
        services.AddScoped<BHome.Application.Contracts.IMainDraftData, BHome.Infrastructure.Contracts.MainDraftData>();
        services.AddScoped<BHome.Application.Contracts.IMainDraftRenderer, BHome.Infrastructure.Contracts.MainDraftRenderer>();
        services.AddOptions<BHome.Infrastructure.Contracts.ContractWorkflowOptions>().Bind(configuration.GetSection("ContractWorkflow")).ValidateOnStart();
        services.AddSingleton<IValidateOptions<BHome.Infrastructure.Contracts.ContractWorkflowOptions>, BHome.Infrastructure.Contracts.ContractWorkflowOptionsValidator>();
        services.AddSingleton<BHome.Application.Contracts.IContractWorkflowMode, BHome.Infrastructure.Contracts.ContractWorkflowMode>();
        services.AddScoped<BHome.Infrastructure.Contracts.ViettelMySignContractAdapter>();
        services.AddScoped<BHome.Application.Contracts.IContractSigningDocumentSource, BHome.Infrastructure.Contracts.ContractSigningDocumentSource>();
        services.AddScoped<BHome.Infrastructure.Contracts.DevelopmentContractSigningAdapter>();
        services.AddScoped<BHome.Application.Contracts.IContractSigningProvider>(p => p.GetRequiredService<BHome.Application.Contracts.IContractWorkflowMode>().SimulatedSigningEnabled
            ? p.GetRequiredService<BHome.Infrastructure.Contracts.DevelopmentContractSigningAdapter>()
            : p.GetRequiredService<BHome.Infrastructure.Contracts.ViettelMySignContractAdapter>());
        services.AddScoped<BHome.Application.Contracts.IContractWorkflowRepository, BHome.Infrastructure.Contracts.ContractWorkflowRepository>();
        services.AddScoped<BHome.Application.Contracts.IContractHandoverRepository, BHome.Infrastructure.Contracts.ContractHandoverRepository>();
        services.AddOptions<BHome.Infrastructure.Contracts.ContractPdfOptions>().Bind(configuration.GetSection(BHome.Infrastructure.Contracts.ContractPdfOptions.Section))
            .Validate(o => o.IsValid(), "ContractPdf:TemplateId must be an embedded template identifier of at most 80 ASCII letters, digits or hyphens.").ValidateOnStart();
        services.AddScoped<BHome.Application.Contracts.IContractDocumentRenderer, BHome.Infrastructure.Contracts.ContractPdfRenderer>();
        services.AddScoped<BHome.Application.Contracts.IContractSettlementLedger, BHome.Infrastructure.Contracts.ContractSettlementLedger>();
        services.AddScoped<BHome.Application.Contracts.IContractHoldingLedger, BHome.Infrastructure.Contracts.UnconfiguredContractHoldingLedger>();
        services.AddScoped<BHome.Application.Contracts.IContractFileStore, BHome.Infrastructure.Contracts.ContractFileStore>();
        services.AddSingleton<BHome.Application.Contracts.IContractImageValidator, BHome.Infrastructure.Contracts.ContractImageValidator>();
        services.AddHostedService<BHome.Infrastructure.Contracts.ContractFileCleanup>();
        BHome.DigitalSigning.Infrastructure.DependencyInjection.AddContractPdfSigning(services);
        // Viettel account: configuration (DigitalSigning:Viettel), overridden by what the Owner saved on the settings screen.
        services.AddScoped<BHome.DigitalSigning.Application.ISigningSettingsStore, BHome.Infrastructure.Contracts.CompactSigningSettingsStore>();
        services.AddScoped<BHome.DigitalSigning.Application.ISignatureImageStore, BHome.Infrastructure.Contracts.CompactSignatureImageStore>();
        BHome.DigitalSigning.Infrastructure.DependencyInjection.AddContractSigningAccounts(services, configuration);
        services.AddSingleton<BHome.Infrastructure.Contracts.SignaturePictureGenerator>();
        services.AddSingleton<BHome.Application.Contracts.IContractSigningPages, BHome.Infrastructure.Contracts.ContractSigningPages>();
        BHome.DigitalSigning.MySign.MySignRegistration.AddMySignClient(services);
        services.AddScoped<BHome.DigitalSigning.Application.ISigningCertificateStore, BHome.Infrastructure.Contracts.ContractSigningCertificateStore>();
        services.AddScoped<BHome.DigitalSigning.Application.Services.SigningCertificateService>();
        services.AddOptions<OcrOptions>().Bind(configuration.GetSection("Ocr"))
            .Validate(o => o.IsValid(), "OCR limits or profiles are outside supported bounds.").ValidateOnStart();
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<OcrOptions>>().Value);
        services.AddSingleton<IImagePreprocessor, ImagePreprocessor>();
        services.AddSingleton<IMeterSceneDetector, YoloMeterSceneDetector>();
        services.AddSingleton<YoloWaterDigitRecognizer>();
        services.AddSingleton<IOcrEngine, OnnxOcrEngine>();
        services.AddSingleton(provider => new Lazy<IOcrEngine>(provider.GetRequiredService<IOcrEngine>));
        services.AddSingleton<LocalOcrService>();
        services.AddSingleton<IOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
        services.AddSingleton<IAutomaticOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
        services.AddHostedService<OcrWarmup>();
        services.AddScoped<IOcrWorkflowResources, CaptureWorkflowResources>();
        services.AddScoped<OcrWorkflowService>();
        services.AddScoped<ICaptureRepository, CaptureRepository>();
        services.AddScoped<CaptureService>();
        services.AddScoped<BHome.Application.Billing.IInvoiceRepository, BHome.Infrastructure.Billing.InvoiceRepository>();
        services.AddScoped<BHome.Application.Billing.IAdjustmentRepository, BHome.Infrastructure.Billing.AdjustmentRepository>();
        services.AddScoped<BHome.Application.Billing.IAdjustmentEvidenceFiles, BHome.Infrastructure.Billing.AdjustmentEvidenceFiles>();
        services.AddScoped<BHome.Application.Billing.AdjustmentService>();
        services.AddHostedService<BHome.Infrastructure.Billing.AdjustmentEvidenceCleanup>();
        services.AddScoped<BHome.Application.Billing.InvoiceService>();
        services.AddScoped<BHome.Application.Billing.IBillingAutomationSchedules, BHome.Infrastructure.Modules.Billing.Persistence.BillingAutomationSchedules>();
        services.AddScoped<BHome.Application.Billing.BillingAutomationService>();
        services.AddScoped<BHome.Application.Billing.IBillingAutomationEngine, BHome.Infrastructure.Modules.Billing.BillingAutomationEngine>();
        services.AddScoped<BHome.Application.Billing.BillingAutomationOperations>();
        services.AddSingleton(p => new BHome.Application.Billing.BillingAutomationRuntime(p.GetRequiredService<Microsoft.Extensions.Hosting.IHostEnvironment>().EnvironmentName is "Development" or "Testing", configuration.GetValue<bool>("Jobs:Enabled")));
        services.AddScoped<IBackgroundJobHandler>(p => new BHome.Application.Billing.BillingAutomationJobHandler("billing-meter", "Meter", p.GetRequiredService<BHome.Application.Billing.IBillingAutomationEngine>()));
        services.AddScoped<IBackgroundJobHandler>(p => new BHome.Application.Billing.BillingAutomationJobHandler("billing-draft", "Draft", p.GetRequiredService<BHome.Application.Billing.IBillingAutomationEngine>()));
        services.AddScoped<IBackgroundJobHandler>(p => new BHome.Application.Billing.BillingAutomationJobHandler("billing-final", "Final", p.GetRequiredService<BHome.Application.Billing.IBillingAutomationEngine>()));
        services.AddScoped<IJobScheduleContributor, BHome.Infrastructure.Modules.Billing.BillingAutomationScheduling>();
        services.AddScoped<BHome.Application.Notifications.INotificationRepository, CompactNotificationRepository>();
        services.AddScoped<BHome.Application.Notifications.NotificationService>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.NotificationEventPublisher>();
        services.AddScoped<BHome.Application.Notifications.INotificationEventPublisher>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Notifications.NotificationEventPublisher>());
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Notifications.NotificationEventPublisher>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Notifications.NotificationEventPublisher>());
        services.AddScoped<BHome.Application.Notifications.NotificationAutomationService>();
        services.AddOptions<BHome.Application.Notifications.NotificationDeliveryOptions>().Bind(configuration.GetSection("NotificationDelivery")).Validate(o => o.Valid(), "Invalid notification delivery retry policy.").ValidateOnStart();
        services.AddSingleton(p => p.GetRequiredService<IOptions<BHome.Application.Notifications.NotificationDeliveryOptions>>().Value);
        services.AddScoped<BHome.Application.Notifications.INotificationDeliveryStore, BHome.Infrastructure.Modules.Notifications.NotificationDeliveryStore>();
        services.AddScoped<BHome.Application.Notifications.NotificationDeliveryService>();
        services.AddScoped<BHome.Application.Notifications.NotificationDeliveryAdministration>();
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Application.Notifications.NotificationDeliveryService>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Application.Notifications.NotificationDeliveryService>());
        services.AddScoped<BHome.Application.PaymentsDebt.IPaymentRepository, BHome.Infrastructure.PaymentsDebt.PaymentRepository>();
        services.AddScoped<BHome.Application.PaymentsDebt.PaymentService>();
        services.AddSingleton(provider => new BHome.Application.PaymentsDebt.PaymentRuntimeMode(
            provider.GetRequiredService<Microsoft.Extensions.Hosting.IHostEnvironment>().EnvironmentName is "Development" or "Testing"));
        services.AddSingleton<BHome.Application.PaymentsDebt.ITransferQrGenerator, BHome.Infrastructure.PaymentsDebt.VietQrGenerator>();
        services.AddScoped<BHome.Application.PaymentsDebt.TransferInstructionsService>();
        services.AddHostedService<MeterEvidenceCleanup>();
        services.AddOptions<IdentityProtectionOptions>().Bind(configuration.GetSection("IdentityProtection"));
        services.AddSingleton<IIdentityProtection, IdentityProtection>();
        services.AddOptions<ObjectStorageOptions>().Bind(configuration.GetSection(ObjectStorageOptions.Section));
        services.AddScoped<IObjectStorage, MinioObjectStorage>();
        services.AddOptions<JobWorkerOptions>().Bind(configuration.GetSection("Jobs"))
            .Validate(o => o.PollSeconds is >= 1 and <= 300, "Job polling must be 1-300 seconds.").ValidateOnStart();
        services.AddScoped<CompactJobPersistence>();
        services.AddScoped<IBackgroundJobQueue>(p => p.GetRequiredService<CompactJobPersistence>());
        services.AddScoped<IJobPersistence>(p => p.GetRequiredService<CompactJobPersistence>());
        services.AddScoped<BHome.Infrastructure.Contracts.ContractExpiryProcessor>();
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Contracts.ContractExpiryProcessor>());
        services.AddScoped<BHome.Application.Contracts.IContractExpiryRepository>(p => p.GetRequiredService<BHome.Infrastructure.Contracts.ContractExpiryProcessor>());
        services.AddScoped<BHome.Application.Contracts.ContractExpiryService>();
        services.AddHostedService<BHome.Infrastructure.Contracts.ContractExpiryScheduler>();
        services.AddHostedService<PostgresJobWorker>();
        return services;
    }
}
