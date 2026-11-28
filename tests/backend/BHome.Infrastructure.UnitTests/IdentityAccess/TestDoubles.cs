using System.Collections;
using System.Linq.Expressions;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.Query;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Kho user trong bo nho cho UserManager that: giu trang thai khoa/so lan sai giua cac lan goi,
// de kiem tra dung co che lockout cua ASP.NET Core Identity ma khong can PostgreSQL.
internal sealed class InMemoryUserStore(params User[] seed) :
    IQueryableUserStore<User>, IUserPasswordStore<User>, IUserEmailStore<User>,
    IUserLockoutStore<User>, IUserTwoFactorStore<User>, IUserRoleStore<User>,
    IUserSecurityStampStore<User>
{
    private readonly List<User> users = [.. seed];
    public Dictionary<Guid, List<string>> Roles { get; } = [];

    public IQueryable<User> Users => new AsyncQueryable<User>(users);
    public void Dispose() { }

    public Task<string> GetUserIdAsync(User user, CancellationToken t) => Task.FromResult(user.Id.ToString());
    public Task<string?> GetUserNameAsync(User user, CancellationToken t) => Task.FromResult(user.UserName);
    public Task SetUserNameAsync(User user, string? name, CancellationToken t) { user.UserName = name; return Task.CompletedTask; }
    public Task<string?> GetNormalizedUserNameAsync(User user, CancellationToken t) => Task.FromResult(user.NormalizedUserName);
    public Task SetNormalizedUserNameAsync(User user, string? name, CancellationToken t) { user.NormalizedUserName = name; return Task.CompletedTask; }
    public Task<IdentityResult> CreateAsync(User user, CancellationToken t) { users.Add(user); return Task.FromResult(IdentityResult.Success); }
    public Task<IdentityResult> UpdateAsync(User user, CancellationToken t) => Task.FromResult(IdentityResult.Success);
    public Task<IdentityResult> DeleteAsync(User user, CancellationToken t) { users.Remove(user); return Task.FromResult(IdentityResult.Success); }
    public Task<User?> FindByIdAsync(string id, CancellationToken t) => Task.FromResult(users.FirstOrDefault(u => u.Id.ToString() == id));
    public Task<User?> FindByNameAsync(string name, CancellationToken t) => Task.FromResult(users.FirstOrDefault(u => u.NormalizedUserName == name));

    public Task SetPasswordHashAsync(User user, string? hash, CancellationToken t) { user.PasswordHash = hash; return Task.CompletedTask; }
    public Task<string?> GetPasswordHashAsync(User user, CancellationToken t) => Task.FromResult(user.PasswordHash);
    public Task<bool> HasPasswordAsync(User user, CancellationToken t) => Task.FromResult(user.PasswordHash is not null);

    public Task SetEmailAsync(User user, string? email, CancellationToken t) { user.Email = email; return Task.CompletedTask; }
    public Task<string?> GetEmailAsync(User user, CancellationToken t) => Task.FromResult(user.Email);
    public Task<bool> GetEmailConfirmedAsync(User user, CancellationToken t) => Task.FromResult(user.EmailConfirmed);
    public Task SetEmailConfirmedAsync(User user, bool confirmed, CancellationToken t) { user.EmailConfirmed = confirmed; return Task.CompletedTask; }
    public Task<User?> FindByEmailAsync(string email, CancellationToken t) => Task.FromResult(users.FirstOrDefault(u => u.NormalizedEmail == email));
    public Task<string?> GetNormalizedEmailAsync(User user, CancellationToken t) => Task.FromResult(user.NormalizedEmail);
    public Task SetNormalizedEmailAsync(User user, string? email, CancellationToken t) { user.NormalizedEmail = email; return Task.CompletedTask; }

    public Task<DateTimeOffset?> GetLockoutEndDateAsync(User user, CancellationToken t) => Task.FromResult(user.LockoutEnd);
    public Task SetLockoutEndDateAsync(User user, DateTimeOffset? end, CancellationToken t) { user.LockoutEnd = end; return Task.CompletedTask; }
    public Task<int> IncrementAccessFailedCountAsync(User user, CancellationToken t) => Task.FromResult(++user.AccessFailedCount);
    public Task ResetAccessFailedCountAsync(User user, CancellationToken t) { user.AccessFailedCount = 0; return Task.CompletedTask; }
    public Task<int> GetAccessFailedCountAsync(User user, CancellationToken t) => Task.FromResult(user.AccessFailedCount);
    public Task<bool> GetLockoutEnabledAsync(User user, CancellationToken t) => Task.FromResult(user.LockoutEnabled);
    public Task SetLockoutEnabledAsync(User user, bool enabled, CancellationToken t) { user.LockoutEnabled = enabled; return Task.CompletedTask; }

    public Task SetTwoFactorEnabledAsync(User user, bool enabled, CancellationToken t) { user.TwoFactorEnabled = enabled; return Task.CompletedTask; }
    public Task<bool> GetTwoFactorEnabledAsync(User user, CancellationToken t) => Task.FromResult(user.TwoFactorEnabled);

    public Task AddToRoleAsync(User user, string role, CancellationToken t) { RolesOf(user).Add(role); return Task.CompletedTask; }
    public Task RemoveFromRoleAsync(User user, string role, CancellationToken t) { RolesOf(user).Remove(role); return Task.CompletedTask; }
    public Task<IList<string>> GetRolesAsync(User user, CancellationToken t) => Task.FromResult<IList<string>>([.. RolesOf(user)]);
    public Task<bool> IsInRoleAsync(User user, string role, CancellationToken t) => Task.FromResult(RolesOf(user).Contains(role, StringComparer.OrdinalIgnoreCase));
    public Task<IList<User>> GetUsersInRoleAsync(string role, CancellationToken t) =>
        Task.FromResult<IList<User>>([.. users.Where(u => RolesOf(u).Contains(role, StringComparer.OrdinalIgnoreCase))]);
    private List<string> RolesOf(User user) => Roles.TryGetValue(user.Id, out var list) ? list : Roles[user.Id] = [];

    public Task SetSecurityStampAsync(User user, string stamp, CancellationToken t) { user.SecurityStamp = stamp; return Task.CompletedTask; }
    public Task<string?> GetSecurityStampAsync(User user, CancellationToken t) => Task.FromResult(user.SecurityStamp);
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
