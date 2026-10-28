using BHome.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.LocalDevelopment;

internal static class LocalDevelopmentCli
{
    public static async Task<int> Main()
    {
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
            await using var provider = services.BuildServiceProvider();
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
        catch (Exception error)
        {
            Console.Error.WriteLine($"Tạo tài khoản test thất bại ({error.GetType().Name}). Không hiển thị credential hoặc lỗi provider.");
            return 1;
        }
    }
}
