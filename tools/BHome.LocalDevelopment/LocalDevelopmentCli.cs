using BHome.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.LocalDevelopment;

internal static class LocalDevelopmentCli
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length is 1 or 2 && args[0] == "seed-development-data" &&
            (args.Length == 1 || args[1] == "--set-sample-passwords"))
        {
            var samplePassword = Environment.GetEnvironmentVariable("BHOME_DEV_TEST_PASSWORD");
            Environment.SetEnvironmentVariable("BHOME_DEV_TEST_PASSWORD", null);
            try
            {
                var configuration = new ConfigurationBuilder().AddEnvironmentVariables().Build();
                var registration = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(configuration);
                registration.AddInfrastructure(configuration);
                await using var sampleProvider = registration.BuildServiceProvider();
                var added = await Compact24SampleSeed.RunAsync(sampleProvider, Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), samplePassword, args.Length == 2);
                Console.WriteLine(added ? "SAMPLE_CREATED: 4 users, 2 Locations, 6 Rooms, 2 RoomTypes, 6 Assets, 12 Meters, 8 sample rates, 3 pending Residents, 4 Tasks."
                    : "SAMPLE_ALREADY_PRESENT: existing business data preserved.");
                Console.WriteLine(samplePassword is null ? "Sample accounts use random undisclosed passwords. Run Seed-LocalDevelopmentData.ps1 -SetSamplePasswords to choose a login password."
                    : "Passwords are not printed; existing passwords change only with --set-sample-passwords.");
                return 0;
            }
            catch (LocalTestAccountException error)
            {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"SAMPLE_FAILED ({error.GetType().Name}); no credentials or row data printed.");
                return 1;
            }
        }
        if (args.SequenceEqual(new[] { "seed-main-draft-settings" }))
        {
            try
            {
                var settings = new ConfigurationBuilder().AddEnvironmentVariables().Build();
                var setup = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(settings);
                setup.AddInfrastructure(settings);
                setup.AddSingleton<Microsoft.Extensions.Hosting.IHostEnvironment>(new DemoHostEnvironment(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? ""));
                setup.AddSingleton<LifecycleSeedActor>();
                setup.AddSingleton<BHome.Application.IdentityAccess.ICurrentUser>(p => p.GetRequiredService<LifecycleSeedActor>());
                await using var seedProvider = setup.BuildServiceProvider();
                await MainDraftSettingsSeed.RunAsync(seedProvider, settings);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"Không thể seed cấu hình Draft ({error.GetType().Name}). Không hiển thị credential hoặc dữ liệu định danh.");
                return 1;
            }
        }
        // Read only from the invoking process, never command-line args or checked-in files.
        var password = Environment.GetEnvironmentVariable("BHOME_DEV_TEST_PASSWORD");
        Environment.SetEnvironmentVariable("BHOME_DEV_TEST_PASSWORD", null);
        if (string.IsNullOrWhiteSpace(password))
        {
            Console.Error.WriteLine("Hãy chạy scripts/New-LocalTestUsers.ps1 để nhập mật khẩu test.");
            return 1;
        }
        try
        {
            var config = new ConfigurationBuilder().AddEnvironmentVariables().Build();
            var services = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(config);
            services.AddInfrastructure(config);
            if (args.Length == 1 && args[0] is "seed-contract-demo" or "seed-billing-automation-demo" or "demo-billing-retry")
            {
                services.AddSingleton<Microsoft.Extensions.Hosting.IHostEnvironment>(new DemoHostEnvironment(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? ""));
                services.AddSingleton<LifecycleSeedActor>();
                services.AddSingleton<BHome.Application.IdentityAccess.ICurrentUser>(p => p.GetRequiredService<LifecycleSeedActor>());
            }
            await using var provider = services.BuildServiceProvider();
            if (args.SequenceEqual(new[] { "seed-billing-automation-demo" })) { await BillingAutomationDemoSeed.PrepareAsync(provider); return 0; }
            if (args.SequenceEqual(new[] { "demo-billing-retry" })) { await BillingAutomationDemoSeed.RetryAsync(provider); return 0; }
            if (args.SequenceEqual(new[] { "seed-contract-demo" }))
            {
                await ContractDemoSeed.RunAsync(provider, Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), password);
                return 0;
            }
            if (args.Length != 0) throw new LocalTestAccountException("Lệnh không hợp lệ.");
            var created = await LocalTestAccounts.CreateAsync(provider,
                Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), password);
            Console.WriteLine(created
                ? "Đã tạo owner.dev (Owner), staff.dev (Staff), tenant.dev (Tenant) với mật khẩu bạn vừa nhập."
                : "Đã có ít nhất một tên tài khoản test. Không thay đổi tài khoản, mật khẩu hoặc role nào.");
            return created ? 0 : 2;
        }
        catch (LocalTestAccountException error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateException error) when (error.InnerException is Npgsql.PostgresException database)
        {
            Console.Error.WriteLine($"Seed bị database từ chối: SQLSTATE={database.SqlState}; constraint={database.ConstraintName}; table={database.TableName}. Không in dữ liệu hoặc credential.");
            return 1;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Tạo tài khoản test thất bại ({error.GetType().Name}). Không hiển thị credential hoặc lỗi provider.");
            return 1;
        }
    }
}
internal sealed class DemoHostEnvironment(string environment) : Microsoft.Extensions.Hosting.IHostEnvironment
{
    public string EnvironmentName { get; set; } = environment;
    public string ApplicationName { get; set; } = "BHome.LocalDevelopment";
    public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
}
