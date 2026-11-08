using System.Security.Cryptography;
using System.Text;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.LocalDevelopment;

// Explicit, additive UI fixtures. Does not create/activate/pay any business record.
internal static class NotificationInboxSeed
{
    public static async Task RunAsync(IServiceProvider services, bool preview)
    {
        var config = services.GetRequiredService<IConfiguration>();
        LocalTestAccounts.ValidateTarget(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"),
            config.GetConnectionString("Database") ?? "");
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync()) throw new LocalTestAccountException("Local Compact24 schema is not ready; no writes performed.");
        var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var names = new[] { "owner.dev", "staff.dev", "tenant.dev", "owner.mobile.test", "staff.mobile.test", "tenant.mobile.test", "owner.sample", "staff.sample", "tenant.sample", "tenant.other.sample" };
        var emails = names.Select(n => n + "@example.invalid").ToArray();
        var accounts = await db.Users.Where(u => u.IsActive && emails.Contains(u.Email!)).OrderBy(u => u.Email).ToListAsync();
        if (accounts.Count == 0) throw new LocalTestAccountException("No known synthetic test accounts found; no writes performed.");
        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"notification-inbox-demo-v1"},0))");
        foreach (var account in accounts)
        {
            var roles = await manager.GetRolesAsync(account);
            if (roles.Count != 1 || !new[] { Roles.Owner, Roles.Staff, Roles.Tenant }.Contains(roles[0])) continue;
            var role = roles[0];
            Guid? location = null; Guid taskId = Guid.Empty;
            if (role == Roles.Staff)
            {
                var assignment = await (from a in db.StaffLocationAssignments join l in db.Locations on a.LocationId equals l.Id
                    where a.StaffUserId == account.Id && a.StartDate <= today && a.EndDate >= today && l.IsActive &&
                        (l.Name.Contains("TEST") || l.Name.Contains("test") || l.Name.Contains("demo") || l.Name.Contains("Demo"))
                    select new { l.Id }).FirstOrDefaultAsync();
                if (assignment is null) { Console.WriteLine($"SKIP {account.Email}: no current synthetic location assignment."); continue; }
                location = assignment.Id;
                taskId = await db.Set<OperationalTask>().Where(t => t.Kind == OperationalTaskKind.AdHoc && t.LocationId == location && t.AssignedStaffUserId == account.Id)
                    .Select(t => t.Id).FirstOrDefaultAsync();
            }
            var contract = await db.Set<Contract>().Where(c => c.IsDevelopmentDemo &&
                (role == Roles.Tenant ? c.TenantUserId == account.Id : c.OwnerSignerId == account.Id))
                .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync();
            var invoiceId = contract is null ? Guid.Empty : await db.Set<Invoice>().Where(i => i.RepresentativeContractId == contract.Id).Select(i => i.Id).FirstOrDefaultAsync();
            var prefix = $"notification-inbox-demo-v1:{account.Id:N}:";
            var existing = await db.Set<UserNotification>().Where(n => n.RecipientUserId == account.Id && n.EventKey.StartsWith(prefix)).ToListAsync();
            var added = 0;
            for (var index = 0; index < 30; index++)
            {
                var key = prefix + index;
                if (existing.Any(n => n.EventKey == key)) continue; // Preserve read states already tested.
                var categories = new[] { "Contract", "Invoice", "Payment", "Adjustment", "Task" };
                var category = role == Roles.Staff ? "Task" : categories[index % categories.Length];
                var label = category switch { "Contract" => "Hợp đồng", "Invoice" => "Hóa đơn", "Payment" => "Thanh toán", "Adjustment" => "Điều chỉnh", _ => "Công việc" };
                var targetType = ""; var targetId = Guid.Empty;
                if (category == "Contract" && contract is not null) { targetType = "Contract"; targetId = contract.Id; }
                if (category is "Invoice" or "Payment" && invoiceId != Guid.Empty) { targetType = "Invoice"; targetId = invoiceId; }
                if (category == "Task" && taskId != Guid.Empty) { targetType = "OperationalTask"; targetId = taskId; }
                // Two explicit edge cases, without deleting or mutating real target records.
                if (index == 1) { targetType = ""; targetId = Guid.Empty; }
                if (index == 2) { targetType = role == Roles.Staff ? "OperationalTask" : "Contract"; targetId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(key + ":missing"))[..16]); }
                var id = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(key))[..16]);
                if (await db.Set<UserNotification>().AnyAsync(n => n.Id == id)) throw new LocalTestAccountException("Fixture ID collision; transaction rolled back.");
                if (!preview) db.Add(new UserNotification {
                    Id = id, RecipientUserId = account.Id, AudienceRole = role, LocationId = location,
                    Category = category, EventKey = key,
                    Title = $"[TEST] {label} — cập nhật {index + 1:00}",
                    Summary = index == 1 ? "Thông báo thử không có hồ sơ liên quan; dùng để kiểm tra thao tác đọc."
                        : index == 2 ? "Hồ sơ giả lập không còn khả dụng; dùng để kiểm tra thông báo khi mở đích."
                        : "Dữ liệu tổng hợp để kiểm tra giao diện, bộ lọc và phân trang. Không phát sinh hóa đơn, thanh toán hoặc công việc mới.",
                    RelatedObjectType = targetType, RelatedObjectId = targetId,
                    CreatedAt = now.AddHours(-index * 3), ReadAt = index % 4 == 0 ? now.AddMinutes(-index) : null,
                    DeliveryState = "Unconfigured"
                });
                added++;
            }
            Console.WriteLine($"{(preview ? "PREVIEW" : "SEEDED")} {role} {account.Email}: add={added}, preserved={existing.Count}, target={(role == Roles.Staff ? taskId != Guid.Empty : contract is not null)}");
        }
        if (!preview) { await db.SaveChangesAsync(); await tx.CommitAsync(); }
        else await tx.RollbackAsync();
    }
}
