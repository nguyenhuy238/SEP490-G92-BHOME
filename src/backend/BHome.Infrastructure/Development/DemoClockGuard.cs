using Microsoft.Extensions.Configuration;
using Npgsql;

namespace BHome.Infrastructure.Development;

public static class DemoClockGuard
{
    public static bool Enabled(IConfiguration config, string? environment)
    {
        var explicitlyEnabled = config.GetValue<bool?>("DemoClock:Enabled");
        if (explicitlyEnabled == false) return false;
        // The two reviewed VPS deployments are academic demonstration environments.
        // Discover the feature by default only when the existing deployment anchors are safe.
        if (environment is "Staging" or "Production")
        {
            if (ValidDeployment(config, environment)) return true;
            if (explicitlyEnabled == true)
                throw new InvalidOperationException("DemoClock deployment requires matching BHOME database/storage, disabled business workers and no live bank integration.");
            return false;
        }
        if (explicitlyEnabled != true) return false;
        if (environment != "Development") throw new InvalidOperationException("DemoClock requires Development, Staging or Production.");
        var database = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Database") ?? "");
        if (config.GetValue<bool>("DemoClock:AllowLocalDevelopment")) return ValidateLocalDevelopment(config, database);
        var storage = config["ObjectStorage:Endpoint"];
        if (database.Host is not ("localhost" or "127.0.0.1" or "::1") || database.Database != "bhome_contract_demo" ||
            !Uri.TryCreate("http://" + storage, UriKind.Absolute, out var endpoint) || !endpoint.IsLoopback ||
            config["ObjectStorage:Bucket"] != "contract-demo" || !config.GetValue<bool>("ContractWorkflow:SimulatedSigningEnabled") ||
            new[] { "Jobs:Enabled", "StaffAssignments:AutoReconcileEnabled", "OwnerSetup:AssetSyncEnabled", "BillingAutomation:AutomaticJobsEnabled", "SePay:Enabled", "BankIntegration:Enabled", "Email:Enabled", "Sms:Enabled", "ExpoPush:Enabled", "NotificationChannels:Enabled", "NotificationChannels:AutomationEnabled", "ElectronicContractIntegration:Enabled" }.Any(key => config.GetValue<bool>(key)) ||
            config["NotificationChannels:Mode"] is not (null or "Unconfigured" or "Sandbox"))
            throw new InvalidOperationException("DemoClock requires isolated local contract-demo database/storage, simulated signing and disabled external integrations/jobs.");
        return true;
    }

    // Allow the existing workstation's local snapshot, not a live Neon/shared database.
    private static bool ValidateLocalDevelopment(IConfiguration config, NpgsqlConnectionStringBuilder database)
    {
        var databaseName = config["DemoClock:DevelopmentDatabaseName"];
        if (database.Host is not ("localhost" or "127.0.0.1" or "::1") ||
            string.IsNullOrWhiteSpace(databaseName) || database.Database != databaseName ||
            !System.Text.RegularExpressions.Regex.IsMatch(databaseName, @"^bhome_neon_local_[0-9]{8}$") ||
            !Uri.TryCreate("http://" + config["ObjectStorage:Endpoint"], UriKind.Absolute, out var endpoint) || !endpoint.IsLoopback ||
            config["ObjectStorage:Bucket"] != "bhome-private" ||
            config["Deployment:Environment"] is not (null or "" or "Development") ||
            new[] { "DevelopmentDatabase:InitializeOnStartup", "Jobs:Enabled", "StaffAssignments:AutoReconcileEnabled",
                "OwnerSetup:AssetSyncEnabled", "BillingAutomation:AutomaticJobsEnabled", "BankIntegration:Enabled",
                "NotificationChannels:AutomationEnabled" }.Any(key => config.GetValue<bool>(key)) ||
            config.GetValue<bool>("SePay:Enabled") && config["SePay:Mode"] != "Test")
            throw new InvalidOperationException("DemoClock local Development requires an explicitly selected local snapshot and local storage, disabled automatic business jobs and no live bank integration.");
        return true;
    }

    private static bool ValidDeployment(IConfiguration config, string environment)
    {
        var staging = environment == "Staging";
        if (config["Deployment:Environment"] != environment ||
            config.GetValue<bool>("BankIntegration:Enabled") ||
            new[] { "DevelopmentDatabase:InitializeOnStartup", "Jobs:Enabled", "StaffAssignments:AutoReconcileEnabled",
                "OwnerSetup:AssetSyncEnabled", "BillingAutomation:AutomaticJobsEnabled", "ContractWorkflow:SimulatedSigningEnabled" }
                .Any(key => config.GetValue<bool>(key)))
            return false;
        var owner = config["DemoClock:OwnerUserId"];
        if (!string.IsNullOrWhiteSpace(owner) && (!Guid.TryParse(owner, out var id) || id == Guid.Empty)) return false;
        if (staging && (!config.GetValue<bool>("SePay:Enabled") || config["SePay:Mode"] != "Test")) return false;
        // Do not change the provider configuration to enable demo. Production's academic
        // deployment currently has live payments disabled; refuse an active live integration.
        if (!staging && (config.GetValue<bool>("SePay:Enabled") || config["SePay:Mode"] == "Test")) return false;
        try
        {
            var database = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Database") ?? "");
            return database.Host == "postgres" &&
                database.Database == (staging ? "bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989" : "bhome") &&
                config["ObjectStorage:Endpoint"] == (staging ? "stage-minio:9000" : "minio:9000") &&
                config["ObjectStorage:Bucket"] == (staging ? "bhome-staging-private" : "bhome-private");
        }
        catch (ArgumentException) { return false; }
    }
}
