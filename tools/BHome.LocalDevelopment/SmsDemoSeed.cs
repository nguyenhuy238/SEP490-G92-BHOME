using System.Net;
using System.Text.RegularExpressions;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.LocalDevelopment;

// Explicit fixtures on a separate loopback database. No real account is marked phone-verified.
internal static class SmsDemoSeed
{
    internal static async Task RunAsync(IServiceProvider services)
    {
        var config = services.GetRequiredService<IConfiguration>();
        var connection = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Database"));
        if (Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") != "Development" ||
            !(connection.Host == "localhost" || IPAddress.TryParse(connection.Host, out var ip) && IPAddress.IsLoopback(ip)) ||
            !Regex.IsMatch(connection.Database ?? "", "^bhome_compact24_dev_[a-f0-9]{32}$") ||
            config["Sms:Mode"] != "Mock" || !config.GetValue<bool>("Sms:DemoIsolated"))
            throw new LocalTestAccountException("SMS demo requires a dedicated loopback Development database and isolated Mock mode.");
        await Compact24DevelopmentDatabase.PrepareAsync("Development", connection.ConnectionString);
        await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var password = Environment.GetEnvironmentVariable("BHOME_SMS_DEMO_PASSWORD");
        if (string.IsNullOrWhiteSpace(password)) throw new LocalTestAccountException("Configure BHOME_SMS_DEMO_PASSWORD privately.");
        if (await db.Users.AnyAsync(u => u.Email == null || !u.Email.EndsWith("@sms-demo.example.invalid")))
            throw new LocalTestAccountException("Database contains non-SMS-demo accounts; no seed writes performed.");
        var fixtures = new[]
        {
            (Guid.Parse("11111111-1111-4111-8111-111111111111"), "owner.sms-demo", Roles.Owner, "0900000001"),
            (Guid.Parse("22222222-2222-4222-8222-222222222222"), "staff.sms-demo", Roles.Staff, "0900000002"),
            (Guid.Parse("33333333-3333-4333-8333-333333333333"), "tenant.sms-demo", Roles.Tenant, "0900000003")
        };
        await using var transaction = await db.Database.BeginTransactionAsync();
        foreach (var (id, name, role, phone) in fixtures)
        {
            if (await users.FindByIdAsync(id.ToString()) is not null) continue;
            var user = new ApplicationUser
            {
                Id = id,
                UserName = name,
                Email = name + "@sms-demo.example.invalid",
                EmailConfirmed = true,
                PhoneNumber = phone,
                PhoneNumberConfirmed = true,
                IsActive = true,
                LockoutEnabled = true
            };
            db.PrepareUserRole(user, role); var result = await users.CreateAsync(user, password);
            if (!result.Succeeded) throw new LocalTestAccountException("Synthetic account creation failed: " + string.Join(',', result.Errors.Select(e => e.Code)));
        }
        await transaction.CommitAsync();
        Console.WriteLine("Isolated SMS demo accounts ready. Existing passwords and business data were preserved. No SMS was sent.");
    }
}
