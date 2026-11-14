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
using Microsoft.Extensions.Hosting;
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
        services.AddScoped(provider => Compact24Compatibility.Resolve(
            provider.GetService<IHostEnvironment>()?.EnvironmentName,
            provider.GetRequiredService<IConfiguration>().GetValue<bool>("DevelopmentDatabase:AllowPreviousPropertySchema"),
            provider.GetRequiredService<IOptions<DatabaseOptions>>().Value.Database));
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
        services.AddOptions<SmsRecoveryOptions>().BindConfiguration("SmsRecovery")
            .Validate(o => o.Valid(), "Invalid SMS recovery limits or missing base64 secret key (at least 32 random bytes).").ValidateOnStart();
        services.AddScoped<SmsPasswordRecovery>();
        services.AddScoped<ISmsPasswordRecovery>(p => p.GetRequiredService<SmsPasswordRecovery>());
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<SmsPasswordRecovery>());
        services.AddScoped<ISecurityAudit, IdentitySecurityAudit>();
        services.AddOptions<AuthenticationEmailOptions>().BindConfiguration("AuthenticationEmail")
            .Validate(o => o.ResendCooldownSeconds is >= 30 and <= 3600, "Authentication email cooldown must be 30-3600 seconds.").ValidateOnStart();
        services.AddScoped<AuthenticationEmailDelivery>();
        services.AddScoped<IEmailVerification, EmailVerificationService>();
        services.AddScoped<IPasswordResetDelivery>(p => p.GetRequiredService<AuthenticationEmailDelivery>());
        services.AddScoped<IAccountInvitations, AccountInvitations>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.CompactNotificationWriter>();
        services.AddOptions<BHome.Application.Notifications.SmsOptions>().BindConfiguration("Sms")
            .Validate(o => o.Valid(), "Invalid SMS configuration; check mode, provider, endpoint, templates and credentials in secrets.").ValidateOnStart();
        services.AddSingleton<BHome.Infrastructure.Modules.Notifications.DemoSmsInbox>();
        services.AddScoped<BHome.Application.Notifications.IDemoSmsInbox, BHome.Infrastructure.Modules.Notifications.DemoSmsAccess>();
        services.AddHostedService<BHome.Infrastructure.Modules.Notifications.DemoSmsCleanup>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.MockSmsSender>();
        services.AddHttpClient<BHome.Infrastructure.Modules.Notifications.EsmsSmsSender>()
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddScoped<BHome.Application.Notifications.ISmsSender, BHome.Infrastructure.Modules.Notifications.SmsGateway>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.SmsNotificationContent>();
        services.AddScoped(p => new BHome.Infrastructure.Modules.Notifications.EsmsDeliveryCallback(
            p.GetRequiredService<BHome.Infrastructure.Modules.Notifications.CompactNotificationWriter>(), p.GetRequiredService<IOptions<BHome.Application.Notifications.SmsOptions>>()));
        services.AddScoped<BHome.Application.Notifications.INotificationWorkspace, BHome.Infrastructure.Modules.Notifications.CompactNotificationWorkspace>();
        services.AddScoped<BHome.Application.Notifications.NotificationWorkspaceService>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.CompactNotificationEvents>();
        services.AddOptions<BHome.Application.Notifications.NotificationChannelOptions>().BindConfiguration("NotificationChannels")
            .Validate(o => o.Mode is "Unconfigured" or "Sandbox" or "Smtp" && o.MaxAttempts is >= 1 and <= 10 && o.RetrySeconds is >= 1 and <= 3600 && o.TimeoutSeconds is >= 1 and <= 45, "Invalid notification channel options.").ValidateOnStart();
        services.AddOptions<BHome.Application.Notifications.EmailOptions>().BindConfiguration("Email")
            .PostConfigure(o =>
            {
                // Compatibility for deployments using the previous SMTP configuration keys.
                if (!o.Enabled && configuration["NotificationChannels:Mode"] == "Smtp")
                {
                    var legacy = configuration.GetSection("NotificationChannels").Get<BHome.Application.Notifications.NotificationChannelOptions>()!;
                    o.Enabled = true; o.Host = legacy.SmtpHost ?? ""; o.Port = legacy.SmtpPort;
                    o.Username = legacy.SmtpUser ?? ""; o.AppPassword = legacy.SmtpPassword ?? "";
                    o.FromEmail = legacy.FromAddress ?? ""; o.UseStartTls = legacy.SmtpUseTls;
                }
            })
            .Validate(o => o.Valid(), "Email configuration invalid: check Email host, port, username, sender, STARTTLS, timeout and Email:AppPassword in secrets.").ValidateOnStart();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.MailKitEmailSender>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.NotificationEmailContent>();
        services.AddScoped<BHome.Application.Notifications.IDevelopmentEmailTest, BHome.Infrastructure.Modules.Notifications.DevelopmentEmailTest>();
        services.AddScoped<BHome.Application.Notifications.INotificationChannelProvider, BHome.Infrastructure.Modules.Notifications.NotificationChannelProvider>();
        services.AddScoped<BHome.Infrastructure.Modules.Notifications.NotificationChannelWorker>();
        services.AddHostedService<BHome.Infrastructure.Modules.Notifications.NotificationAutomationWorker>();
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Notifications.NotificationChannelWorker>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Notifications.NotificationChannelWorker>());
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
        services.AddScoped<BHome.Application.Operations.IResidentAdministrationRepository, BHome.Infrastructure.Modules.Operations.ResidentAdministrationRepository>();
        services.AddOptions<BHome.Application.Operations.IdentityRetentionOptions>().BindConfiguration("IdentityRetention");
        services.AddScoped(sp => sp.GetRequiredService<IOptions<BHome.Application.Operations.IdentityRetentionOptions>>().Value);
        services.AddScoped<BHome.Application.Operations.IIdentityRetentionRepository, BHome.Infrastructure.Modules.Operations.IdentityRetentionRepository>();
        services.AddScoped<BHome.Application.Operations.IdentityRetentionService>();
        services.AddScoped<BHome.Application.Operations.ResidentAdministrationService>();
        services.AddScoped<BHome.Infrastructure.Modules.Operations.RecurringOperationsJob>();
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Operations.RecurringOperationsJob>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Infrastructure.Modules.Operations.RecurringOperationsJob>());
        services.AddScoped<BHome.Application.PropertyManagement.IPropertyRepository,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.PostgresPropertyRepository>();
        services.AddScoped<BHome.Application.PropertyManagement.IRoomInsightsRepository,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.PostgresRoomInsightsRepository>();
        services.AddScoped<BHome.Application.PropertyManagement.PropertyService>();
        services.AddScoped<BHome.Application.PropertyManagement.ISetupWorkspaceStore,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.SetupWorkspaceStore>();
        services.AddScoped<BHome.Application.PropertyManagement.ISharedConfigurationStore,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.SharedConfigurationStore>();
        services.AddScoped<BHome.Application.PropertyManagement.ISharedDataValidator, BHome.Application.PropertyManagement.SharedDataValidator>();
        services.AddScoped<BHome.Application.PropertyManagement.SharedConfigurationService>();
        services.AddScoped<BHome.Application.PropertyManagement.SharedConfigurationApplicationService>();
        services.AddScoped<BHome.Application.PropertyManagement.LocationConfigurationCopyService>();
        services.AddScoped<BHome.Application.PropertyManagement.LocationSetupService>();
        services.AddScoped<BHome.Application.PropertyManagement.AssetInventoryService>();
        services.AddScoped<BHome.Application.PropertyManagement.SetupEvidenceService>();
        services.AddScoped<BHome.Infrastructure.Modules.PropertyManagement.AssetTemplateSyncJob>();
        services.AddHostedService<BHome.Infrastructure.Modules.PropertyManagement.AssetTemplateAutomationWorker>();
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Modules.PropertyManagement.AssetTemplateSyncJob>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Infrastructure.Modules.PropertyManagement.AssetTemplateSyncJob>());
        services.AddScoped<BHome.Application.PropertyManagement.UtilityWorkspaceService>();
        services.AddScoped<BHome.Application.PropertyManagement.IUtilityBilling>(p => p.GetRequiredService<BHome.Application.PropertyManagement.UtilityWorkspaceService>());
        services.AddScoped<BHome.Application.PropertyManagement.OperatingPolicyService>();
        services.AddScoped<BHome.Application.PropertyManagement.IOperatingPolicyWorkflow>(p => p.GetRequiredService<BHome.Application.PropertyManagement.OperatingPolicyService>());
        services.AddScoped<BHome.Application.PropertyManagement.IPropertyLifecycleChecks,
            BHome.Infrastructure.Modules.PropertyManagement.Persistence.PropertyLifecycleChecks>();
        services.AddScoped<BHome.Application.IncidentMaintenance.IIncidentRepository, BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentRepository>();
        services.AddScoped<BHome.Application.IncidentMaintenance.IIncidentFiles, BHome.Infrastructure.Modules.IncidentMaintenance.IncidentFiles>();
        services.AddScoped<BHome.Application.IncidentMaintenance.IncidentService>();
        services.AddScoped<IBackgroundJobHandler, BHome.Infrastructure.Modules.IncidentMaintenance.IncidentNotificationDelivery>();
        services.AddHostedService<BHome.Infrastructure.Modules.IncidentMaintenance.IncidentFileCleanup>();
        services.AddScoped<UnconfiguredBankProvider>();
        services.AddScoped<IBankTransactionProvider>(p => p.GetRequiredService<BHome.Application.PaymentsDebt.SePay.SePayOptions>().Enabled
            ? p.GetRequiredService<BHome.Infrastructure.PaymentsDebt.SePayApiClient>() : p.GetRequiredService<UnconfiguredBankProvider>());
        services.AddOptions<BHome.Application.PaymentsDebt.SePay.SePayOptions>()
            .Configure<IConfiguration>((options, config) => config.GetSection("SePay").Bind(options))
            .Validate<IHostEnvironment>((options, host) => options.Valid(host.EnvironmentName),
                "SePay requires isolated Test/Live configuration, a strong webhook secret and receiving accounts.")
            .ValidateOnStart();
        services.AddSingleton(p => p.GetRequiredService<IOptions<BHome.Application.PaymentsDebt.SePay.SePayOptions>>().Value);
        services.AddSingleton<BHome.Application.PaymentsDebt.SePay.SePayWebhookSecurity>();
        services.AddScoped<BHome.Application.PaymentsDebt.SePay.ISePayRepository, BHome.Infrastructure.PaymentsDebt.SePayRepository>();
        services.AddScoped<BHome.Application.PaymentsDebt.SePay.IPaymentCodeRegistry, BHome.Infrastructure.PaymentsDebt.PaymentCodeRegistry>();
        services.AddScoped<BHome.Application.PaymentsDebt.SePay.SePayService>();
        services.AddHttpClient<BHome.Infrastructure.PaymentsDebt.SePayApiClient>((p, client) =>
        {
            var settings = p.GetRequiredService<BHome.Application.PaymentsDebt.SePay.SePayOptions>();
            if (!settings.Enabled) return;
            client.BaseAddress = new Uri(settings.ApiBaseUrl.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromSeconds(settings.RequestTimeoutSeconds);
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddScoped<BHome.Application.PaymentsDebt.SePay.ISePayTransactionClient>(p => p.GetRequiredService<BHome.Infrastructure.PaymentsDebt.SePayApiClient>());
        services.AddScoped<IBackgroundJobHandler, BHome.Infrastructure.PaymentsDebt.SePayReconciliationJob>();
        services.AddScoped<IBackgroundJobHandler, BHome.Infrastructure.PaymentsDebt.SePayPollingJob>();
        services.AddScoped<BHome.Infrastructure.PaymentsDebt.SePayScheduling>();
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<BHome.Infrastructure.PaymentsDebt.SePayScheduling>());
        services.AddHostedService<BHome.Infrastructure.PaymentsDebt.SePayAutomationWorker>();
        services.AddScoped<INotificationProvider, UnconfiguredNotificationProvider>();
        services.AddScoped<IElectronicContractProvider, UnconfiguredElectronicContractProvider>();
        services.AddScoped<BHome.Application.Contracts.IContractRepository, BHome.Infrastructure.Contracts.ContractRepository>();
        services.AddScoped<BHome.Application.Contracts.ContractService>();
        services.AddScoped<BHome.Application.Billing.ITenantMeterReadings, BHome.Infrastructure.Billing.TenantMeterReadingsRepository>();
        services.AddScoped<BHome.Application.Billing.TenantMeterReadingService>();
        services.AddScoped<BHome.Application.Contracts.AnonymousContractSigningService>();
        services.AddScoped<BHome.Application.Contracts.IPostActivationTenantProvisioning, BHome.Infrastructure.IdentityAccess.PostActivationTenantProvisioning>();
        services.AddScoped<BHome.Infrastructure.IdentityAccess.AccountInvitations>();
        services.AddScoped<IBackgroundJobHandler, BHome.Infrastructure.IdentityAccess.AccountInvitationJob>();
        services.AddScoped<BHome.Application.Contracts.IAnonymousSigningRepository, BHome.Infrastructure.Contracts.AnonymousSigningRepository>();
        services.AddOptions<BHome.Infrastructure.Contracts.AnonymousSigningOptions>().Bind(configuration.GetSection("AnonymousSigning"));
        services.AddScoped<BHome.Application.Contracts.IAnonymousSigningSecurity, BHome.Infrastructure.Contracts.AnonymousSigningSecurity>();
        services.AddScoped<BHome.Application.Contracts.IInternalAcceptanceRenderer, BHome.Infrastructure.Contracts.InternalAcceptanceRenderer>();
        services.AddScoped<BHome.Application.Contracts.IAdministrativeContractReadiness>(provider =>
            provider.GetRequiredService<BHome.Application.Contracts.ContractService>());
        services.AddScoped<BHome.Application.Contracts.MainDraftService>();
        services.AddScoped<BHome.Application.Contracts.IHoldingSettingsData, BHome.Infrastructure.Contracts.HoldingSettingsData>();
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
        services.AddScoped<BHome.Application.Contracts.IMainDraftPreviewRenderer, BHome.Infrastructure.Contracts.MainDraftPreviewRenderer>();
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
        services.AddScoped<BHome.Application.Contracts.IContractDepositPosition, BHome.Infrastructure.Contracts.ContractDepositPosition>();
        services.AddScoped<BHome.Application.Contracts.IDepositDeductionRepository, BHome.Infrastructure.Contracts.DepositDeductionRepository>();
        services.AddScoped<BHome.Application.Contracts.IDepositDeductionEvidence, BHome.Infrastructure.Contracts.DepositDeductionEvidence>();
        services.AddScoped<BHome.Application.Contracts.ISettlementChargeEvidence, BHome.Infrastructure.Contracts.SettlementChargeEvidence>();
        services.AddScoped<BHome.Application.Contracts.DepositDeductionService>();
        services.AddScoped<BHome.Application.Contracts.ISettlementReceivablesRepository, BHome.Infrastructure.Contracts.SettlementReceivablesRepository>();
        services.AddScoped<BHome.Application.Contracts.SettlementReceivablesService>();
        services.AddScoped<BHome.Application.Contracts.IContractHoldingLedger, BHome.Infrastructure.Contracts.CompactContractHoldingLedger>();
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
        services.AddSingleton(provider => new ExperimentalVisualMeterClassifier(provider.GetRequiredService<OcrOptions>(), provider.GetRequiredService<IHostEnvironment>().IsDevelopment()));
        services.AddSingleton(provider => new ExperimentalMeterRecognizer(provider.GetRequiredService<OcrOptions>(), provider.GetRequiredService<ExperimentalVisualMeterClassifier>(), provider.GetRequiredService<IHostEnvironment>().IsDevelopment()));
        services.AddSingleton<IImageCategoryClassifier>(provider => new YoloMeterCategoryClassifier(
            provider.GetRequiredService<OcrOptions>(), provider.GetRequiredService<IHostEnvironment>().IsDevelopment()));
        services.AddSingleton<IOcrEngine, OnnxOcrEngine>();
        services.AddSingleton(provider => new Lazy<IOcrEngine>(provider.GetRequiredService<IOcrEngine>));
        services.AddSingleton<LocalOcrService>();
        services.AddSingleton<IOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
        services.AddSingleton<IAutomaticOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
        services.AddSingleton<IExperimentalMeterOcrService>(provider => provider.GetRequiredService<LocalOcrService>());
        services.AddHostedService<OcrWarmup>();
        services.AddScoped<IOcrWorkflowResources, CaptureWorkflowResources>();
        services.AddScoped<OcrWorkflowService>();
        services.AddScoped<ICaptureRepository, CaptureRepository>();
        services.AddScoped<CaptureService>();
        services.AddScoped<BHome.Application.Billing.IInvoiceRepository, BHome.Infrastructure.Billing.InvoiceRepository>();
        services.AddScoped<BHome.Application.Billing.IFixedChargeCoverage, BHome.Infrastructure.Billing.FixedChargeCoverageRepository>();
        services.AddScoped<BHome.Application.PaymentsDebt.IReceiptExcessRepository, BHome.Infrastructure.PaymentsDebt.ReceiptExcessRepository>();
        services.AddScoped<BHome.Application.PaymentsDebt.IExternalPaymentPayerRepository, BHome.Infrastructure.PaymentsDebt.ExternalPaymentPayerRepository>();
        services.AddScoped<BHome.Application.PaymentsDebt.ExternalPaymentPayerService>();
        services.AddScoped<BHome.Application.PaymentsDebt.ReceiptExcessService>();
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
        services.AddScoped<BHome.Application.PaymentsDebt.IMainInitialPaymentLedger, BHome.Infrastructure.PaymentsDebt.MainInitialPaymentLedger>();
        services.AddScoped<BHome.Application.PaymentsDebt.IMainInitialPayments, BHome.Infrastructure.PaymentsDebt.MainInitialPayments>();
        services.AddSingleton<BHome.Application.Contracts.IHoldingTestScope, BHome.Infrastructure.Contracts.HoldingTestScope>();
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
        services.AddSingleton<PostgresJobWorker>();
        services.AddHostedService(p => p.GetRequiredService<PostgresJobWorker>());
        return services;
    }
}
