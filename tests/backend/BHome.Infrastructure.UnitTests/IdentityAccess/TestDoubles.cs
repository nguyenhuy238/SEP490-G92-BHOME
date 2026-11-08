using System.Collections;
using System.Linq.Expressions;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.Query;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Kho user trong bo nho cho UserManager that: giu trang thai khoa/so lan sai giua cac lan goi,
// de kiem tra dung co che lockout cua ASP.NET Core Identity ma khong can PostgreSQL.
internal sealed class InMemoryUserStore(params ApplicationUser[] seed) :
    IQueryableUserStore<ApplicationUser>, IUserPasswordStore<ApplicationUser>, IUserEmailStore<ApplicationUser>,
    IUserLockoutStore<ApplicationUser>, IUserTwoFactorStore<ApplicationUser>, IUserRoleStore<ApplicationUser>,
    IUserSecurityStampStore<ApplicationUser>
{
    private readonly List<ApplicationUser> users = [.. seed];
    public Dictionary<Guid, List<string>> Roles { get; } = [];

    public IQueryable<ApplicationUser> Users => new AsyncQueryable<ApplicationUser>(users);
    public void Dispose() { }

    public Task<string> GetUserIdAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.Id.ToString());
    public Task<string?> GetUserNameAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.UserName);
    public Task SetUserNameAsync(ApplicationUser user, string? name, CancellationToken t) { user.UserName = name; return Task.CompletedTask; }
    public Task<string?> GetNormalizedUserNameAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.NormalizedUserName);
    public Task SetNormalizedUserNameAsync(ApplicationUser user, string? name, CancellationToken t) { user.NormalizedUserName = name; return Task.CompletedTask; }
    public Task<IdentityResult> CreateAsync(ApplicationUser user, CancellationToken t) { users.Add(user); return Task.FromResult(IdentityResult.Success); }
    public Task<IdentityResult> UpdateAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(IdentityResult.Success);
    public Task<IdentityResult> DeleteAsync(ApplicationUser user, CancellationToken t) { users.Remove(user); return Task.FromResult(IdentityResult.Success); }
    public Task<ApplicationUser?> FindByIdAsync(string id, CancellationToken t) => Task.FromResult(users.FirstOrDefault(u => u.Id.ToString() == id));
    public Task<ApplicationUser?> FindByNameAsync(string name, CancellationToken t) => Task.FromResult(users.FirstOrDefault(u => u.NormalizedUserName == name));

    public Task SetPasswordHashAsync(ApplicationUser user, string? hash, CancellationToken t) { user.PasswordHash = hash; return Task.CompletedTask; }
    public Task<string?> GetPasswordHashAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.PasswordHash);
    public Task<bool> HasPasswordAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.PasswordHash is not null);

    public Task SetEmailAsync(ApplicationUser user, string? email, CancellationToken t) { user.Email = email; return Task.CompletedTask; }
    public Task<string?> GetEmailAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.Email);
    public Task<bool> GetEmailConfirmedAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.EmailConfirmed);
    public Task SetEmailConfirmedAsync(ApplicationUser user, bool confirmed, CancellationToken t) { user.EmailConfirmed = confirmed; return Task.CompletedTask; }
    public Task<ApplicationUser?> FindByEmailAsync(string email, CancellationToken t) => Task.FromResult(users.FirstOrDefault(u => u.NormalizedEmail == email));
    public Task<string?> GetNormalizedEmailAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.NormalizedEmail);
    public Task SetNormalizedEmailAsync(ApplicationUser user, string? email, CancellationToken t) { user.NormalizedEmail = email; return Task.CompletedTask; }

    public Task<DateTimeOffset?> GetLockoutEndDateAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.LockoutEnd);
    public Task SetLockoutEndDateAsync(ApplicationUser user, DateTimeOffset? end, CancellationToken t) { user.LockoutEnd = end; return Task.CompletedTask; }
    public Task<int> IncrementAccessFailedCountAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(++user.AccessFailedCount);
    public Task ResetAccessFailedCountAsync(ApplicationUser user, CancellationToken t) { user.AccessFailedCount = 0; return Task.CompletedTask; }
    public Task<int> GetAccessFailedCountAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.AccessFailedCount);
    public Task<bool> GetLockoutEnabledAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.LockoutEnabled);
    public Task SetLockoutEnabledAsync(ApplicationUser user, bool enabled, CancellationToken t) { user.LockoutEnabled = enabled; return Task.CompletedTask; }

    public Task SetTwoFactorEnabledAsync(ApplicationUser user, bool enabled, CancellationToken t) { user.TwoFactorEnabled = enabled; return Task.CompletedTask; }
    public Task<bool> GetTwoFactorEnabledAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.TwoFactorEnabled);

    public Task AddToRoleAsync(ApplicationUser user, string role, CancellationToken t) { RolesOf(user).Add(role); return Task.CompletedTask; }
    public Task RemoveFromRoleAsync(ApplicationUser user, string role, CancellationToken t) { RolesOf(user).Remove(role); return Task.CompletedTask; }
    public Task<IList<string>> GetRolesAsync(ApplicationUser user, CancellationToken t) => Task.FromResult<IList<string>>([.. RolesOf(user)]);
    public Task<bool> IsInRoleAsync(ApplicationUser user, string role, CancellationToken t) => Task.FromResult(RolesOf(user).Contains(role, StringComparer.OrdinalIgnoreCase));
    public Task<IList<ApplicationUser>> GetUsersInRoleAsync(string role, CancellationToken t) =>
        Task.FromResult<IList<ApplicationUser>>([.. users.Where(u => RolesOf(u).Contains(role, StringComparer.OrdinalIgnoreCase))]);
    private List<string> RolesOf(ApplicationUser user) => Roles.TryGetValue(user.Id, out var list) ? list : Roles[user.Id] = [];

    public Task SetSecurityStampAsync(ApplicationUser user, string stamp, CancellationToken t) { user.SecurityStamp = stamp; return Task.CompletedTask; }
    public Task<string?> GetSecurityStampAsync(ApplicationUser user, CancellationToken t) => Task.FromResult(user.SecurityStamp);
}

// IQueryable ho tro ToArrayAsync cua EF Core tren danh sach trong bo nho.
internal sealed class AsyncQueryable<T> : EnumerableQuery<T>, IAsyncEnumerable<T>, IQueryable<T>
{
    public AsyncQueryable(IEnumerable<T> items) : base(items) { }
    public AsyncQueryable(Expression expression) : base(expression) { }
    IQueryProvider IQueryable.Provider => new AsyncQueryProvider(this);
    public IAsyncEnumerator<T> GetAsyncEnumerator(CancellationToken cancellationToken = default) => new Enumerator(((IEnumerable<T>)this).GetEnumerator());

    private sealed class Enumerator(IEnumerator<T> inner) : IAsyncEnumerator<T>
    {
        public T Current => inner.Current;
        public ValueTask<bool> MoveNextAsync() => ValueTask.FromResult(inner.MoveNext());
        public ValueTask DisposeAsync() { inner.Dispose(); return ValueTask.CompletedTask; }
    }

    private sealed class AsyncQueryProvider(IQueryProvider inner) : IAsyncQueryProvider
    {
        public IQueryable CreateQuery(Expression expression) => new AsyncQueryable<T>(expression);
        public IQueryable<TElement> CreateQuery<TElement>(Expression expression) => new AsyncQueryable<TElement>(expression);
        public object? Execute(Expression expression) => inner.Execute(expression);
        public TResult Execute<TResult>(Expression expression) => inner.Execute<TResult>(expression);
        public TResult ExecuteAsync<TResult>(Expression expression, CancellationToken cancellationToken = default)
        {
            var resultType = typeof(TResult).GetGenericArguments()[0];
            var value = typeof(IQueryProvider).GetMethods().First(m => m.Name == nameof(IQueryProvider.Execute) && m.IsGenericMethod)
                .MakeGenericMethod(resultType).Invoke(inner, [expression]);
            return (TResult)typeof(Task).GetMethod(nameof(Task.FromResult))!.MakeGenericMethod(resultType).Invoke(null, [value])!;
        }
    }
}
