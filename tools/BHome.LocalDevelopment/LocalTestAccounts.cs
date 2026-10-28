using System.Net;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.LocalDevelopment;

public sealed class LocalTestAccountException(string message) : Exception(message);

// Explicit local test fixtures only. This is not a provisioning API or a tenancy/Staff workflow.
public static class LocalTestAccounts
{
    public static void ValidateTarget(string? environment, string connectionString)
    {
        if (!string.Equals(environment, "Development", StringComparison.Ordinal))
            throw new LocalTestAccountException("Chỉ được tạo tài khoản test trong Development.");
        var connection = new NpgsqlConnectionStringBuilder(connectionString);
        var local = string.Equals(connection.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            (IPAddress.TryParse(connection.Host, out var address) && IPAddress.IsLoopback(address));
        if (!local || !string.Equals(connection.Database, "bhome", StringComparison.Ordinal))
            throw new LocalTestAccountException("Công cụ chỉ hỗ trợ PostgreSQL loopback, database bhome.");
    }

    // false means at least one name already exists: no passwords/roles/accounts are changed.
    public static async Task<bool> CreateAsync(IServiceProvider services, string? environment, string password,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var config = services.GetRequiredService<IConfiguration>();
        ValidateTarget(environment, config.GetConnectionString("Database") ?? "");
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        if ((await db.Database.GetPendingMigrationsAsync(cancellationToken)).Any())
            throw new LocalTestAccountException("Database còn migration chưa áp dụng. Hãy cập nhật database trước.");
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var fixtures = new[] { ("owner.dev", Roles.Owner), ("staff.dev", Roles.Staff), ("tenant.dev", Roles.Tenant) };
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        foreach (var (name, role) in fixtures)
        {
            if (await users.FindByNameAsync(name) is not null) return false;
            if (!await roles.RoleExistsAsync(role))
                throw new LocalTestAccountException("Database thiếu role nền tảng. Không tự tạo role mới.");
        }
        foreach (var (name, role) in fixtures)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var user = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                UserName = name,
                Email = name + "@example.invalid",
                IsActive = true,
                LockoutEnabled = true
            };
            var created = await users.CreateAsync(user, password);
            if (!created.Succeeded) throw Failure(created);
            var assigned = await users.AddToRoleAsync(user, role);
            if (!assigned.Succeeded) throw Failure(assigned);
        }
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    private static LocalTestAccountException Failure(IdentityResult result) =>
        new("Không thể tạo bộ tài khoản test: " + string.Join(", ", result.Errors.Select(x => x.Code)));
}
