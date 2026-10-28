using Microsoft.AspNetCore.Identity;

namespace BHome.Infrastructure.Persistence;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public bool IsActive { get; set; } = true;
    public Guid? ManagingOwnerId { get; set; }
}
