using Microsoft.AspNetCore.Identity;

namespace BHome.Infrastructure.Persistence;

public sealed class User : IdentityUser<Guid>
{
    public bool IsActive { get; set; } = true;
}
