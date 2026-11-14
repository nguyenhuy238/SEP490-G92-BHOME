using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Application.Locations;
using BHome.Application.Notifications;
using BHome.Application.Operations;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Locations;
using BHome.Infrastructure.Modules.Operations;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;

namespace BHome.IntegrationTests.Fixtures;

// Explicit source-schema regression composition, confined to the test assembly.
// Production has no setting, detection or fallback that can select this path.
internal static class LegacyPersistenceRegistration
{
    internal static IServiceCollection UseLegacyPersistenceForTesting(this IServiceCollection services)
    {
        services.PostConfigure<Microsoft.AspNetCore.Mvc.JsonOptions>(options =>
        {
            for (var i = options.JsonSerializerOptions.Converters.Count - 1; i >= 0; i--)
                if (options.JsonSerializerOptions.Converters[i] is BHome.Api.Configuration.RetiredRoomTypeJsonConverterFactory)
                    options.JsonSerializerOptions.Converters.RemoveAt(i);
        });
        services.RemoveAll<Compact24DbContext>(); services.RemoveAll<DbContextOptions<Compact24DbContext>>();
        services.RemoveAll<CompactJobPersistence>(); services.RemoveAll<CompactLocationAssignments>();
        services.RemoveAll<AssignmentReconciliationJob>();
        // Compose the source-schema handlers explicitly. Registration order is not a schema boundary:
        // new Compact24 handlers can be inserted before the recurring handler at any time.
        services.RemoveAll<IBackgroundJobHandler>();
        services.RemoveAll<IJobScheduleContributor>();
        // Owner setup P0-P2 persists versioned workspaces in Compact24 native JSON containers.
        // The explicit legacy regression host must not resolve those adapters through ordinary
        // controllers such as InvoiceService; their constructor ports are optional there.
        services.RemoveAll<ISetupWorkspaceStore>();
        services.RemoveAll<ISharedConfigurationStore>();
        services.RemoveAll<ISharedDataValidator>();
        services.RemoveAll<SharedConfigurationService>();
        services.RemoveAll<SharedConfigurationApplicationService>();
        services.RemoveAll<LocationConfigurationCopyService>();
        services.RemoveAll<LocationSetupService>();
        services.RemoveAll<AssetInventoryService>();
        services.RemoveAll<SetupEvidenceService>();
        services.RemoveAll<BHome.Infrastructure.Modules.PropertyManagement.AssetTemplateSyncJob>();
        services.RemoveAll<UtilityWorkspaceService>();
        services.RemoveAll<IUtilityBilling>();
        services.RemoveAll<OperatingPolicyService>();
        services.RemoveAll<IOperatingPolicyWorkflow>();
        services.RemoveAll<IPropertyLifecycleChecks>();
        foreach (var worker in services.Where(s => s.ServiceType == typeof(IHostedService) &&
            s.ImplementationType == typeof(BHome.Infrastructure.Modules.PropertyManagement.AssetTemplateAutomationWorker)).ToArray()) services.Remove(worker);
        services.AddScoped<IBackgroundJobHandler, BHome.Infrastructure.Modules.IncidentMaintenance.IncidentNotificationDelivery>();
        services.AddScoped<IBackgroundJobHandler>(p => new BHome.Application.Billing.BillingAutomationJobHandler("billing-meter", "Meter", p.GetRequiredService<BHome.Application.Billing.IBillingAutomationEngine>()));
        services.AddScoped<IBackgroundJobHandler>(p => new BHome.Application.Billing.BillingAutomationJobHandler("billing-draft", "Draft", p.GetRequiredService<BHome.Application.Billing.IBillingAutomationEngine>()));
        services.AddScoped<IBackgroundJobHandler>(p => new BHome.Application.Billing.BillingAutomationJobHandler("billing-final", "Final", p.GetRequiredService<BHome.Application.Billing.IBillingAutomationEngine>()));
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<NotificationEventPublisher>());
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<NotificationDeliveryService>());
        services.AddScoped<IBackgroundJobHandler>(p => p.GetRequiredService<BHome.Infrastructure.Contracts.ContractExpiryProcessor>());
        services.AddScoped<IJobScheduleContributor, BHome.Infrastructure.Modules.Billing.BillingAutomationScheduling>();
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<NotificationEventPublisher>());
        services.AddScoped<IJobScheduleContributor>(p => p.GetRequiredService<NotificationDeliveryService>());
        services.RemoveAll<IAccountInvitations>();
        services.RemoveAll<AccountInvitations>();
        services.RemoveAll<AuthenticationEmailDelivery>();
        services.RemoveAll<IEmailVerification>();
        services.RemoveAll<NotificationEmailContent>();
        services.Replace(ServiceDescriptor.Scoped<IPasswordResetDelivery, UnconfiguredPasswordResetDelivery>());
        services.RemoveAll<IIdentityRetentionRepository>();
        services.RemoveAll<IdentityRetentionService>();
        services.RemoveAll<CompactNotificationWriter>();
        // SMS recovery/inbox are Compact24 features. The source-schema regression host
        // explicitly fails them closed instead of retaining adapters to a removed context.
        services.RemoveAll<SmsPasswordRecovery>();
        services.RemoveAll<MockSmsSender>();
        services.RemoveAll<SmsNotificationContent>();
        services.Replace(ServiceDescriptor.Singleton<ISmsSender>(new LegacyUnavailableSms()));
        services.Replace(ServiceDescriptor.Singleton<ISmsPasswordRecovery>(new LegacyUnavailableSmsRecovery()));
        services.Replace(ServiceDescriptor.Singleton<IDemoSmsInbox>(new LegacyUnavailableSmsInbox()));
        services.RemoveAll<INotificationWorkspace>();
        services.RemoveAll<NotificationWorkspaceService>();
        services.RemoveAll<CompactNotificationEvents>();
        services.RemoveAll<NotificationChannelWorker>();
        foreach (var worker in services.Where(s => s.ServiceType == typeof(IHostedService) &&
            s.ImplementationType == typeof(NotificationAutomationWorker)).ToArray()) services.Remove(worker);
        services.RemoveAll<IOperationsRepository>(); services.RemoveAll<OperationsService>();
        services.RemoveAll<IResidentAdministrationRepository>(); services.RemoveAll<ResidentAdministrationService>();
        services.RemoveAll<RecurringOperationsJob>();
        services.AddDbContext<BHomeDbContext>((p, o) => o.UseNpgsql(p.GetRequiredService<IOptions<DatabaseOptions>>().Value.Database));
        services.Replace(ServiceDescriptor.Scoped<BHomePersistenceContext>(p => p.GetRequiredService<BHomeDbContext>()));
        services.RemoveAll<IUserStore<ApplicationUser>>(); services.RemoveAll<IRoleStore<IdentityRole<Guid>>>();
        services.AddIdentityCore<ApplicationUser>().AddRoles<IdentityRole<Guid>>().AddEntityFrameworkStores<BHomeDbContext>();
        services.RemoveAll<IUserClaimsPrincipalFactory<ApplicationUser>>();
        services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, UserClaimsPrincipalFactory<ApplicationUser, IdentityRole<Guid>>>();
        services.Replace(ServiceDescriptor.Scoped<IIdentityPersistence, LegacyIdentityPersistence>());
        services.Replace(ServiceDescriptor.Scoped<IBackgroundJobQueue, PostgresJobQueue>());
        services.Replace(ServiceDescriptor.Scoped<IJobPersistence, LegacyJobPersistence>());
        services.AddScoped<PostgresLocationAssignments>();
        services.Replace(ServiceDescriptor.Scoped<ILocationAssignments>(p => p.GetRequiredService<PostgresLocationAssignments>()));
        services.Replace(ServiceDescriptor.Scoped<IStaffLocationAccess>(p => p.GetRequiredService<PostgresLocationAssignments>()));
        services.Replace(ServiceDescriptor.Scoped<INotificationRepository, BHome.Infrastructure.Modules.Notifications.NotificationRepository>());
        return services;
    }

    private sealed class LegacyUnavailableSms : ISmsSender
    {
        public bool IsConfigured => false;
        public Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken token) => throw new ChannelDeliveryException("sms_unconfigured");
    }
    private sealed class LegacyUnavailableSmsRecovery : ISmsPasswordRecovery
    {
        public Task<SmsRecoveryRequested> RequestAsync(string identifier, string requesterIp, CancellationToken t) => throw Unavailable();
        public Task<SmsRecoveryVerified?> VerifyAsync(string identifier, Guid challengeId, string otp, CancellationToken t) => throw Unavailable();
        public Task<bool> ResetAsync(string identifier, Guid challengeId, string authorization, string newPassword, CancellationToken t) => throw Unavailable();
        private static BHome.Application.Common.IntegrationUnavailableException Unavailable() => new("SMS recovery requires Compact24 persistence.");
    }
    private sealed class LegacyUnavailableSmsInbox : IDemoSmsInbox
    {
        public Task<IReadOnlyList<DemoSmsView>> ListAsync(Guid? recipient, string? template, CancellationToken token) => throw new NotificationException(404, "sms_demo_unavailable");
    }

}
