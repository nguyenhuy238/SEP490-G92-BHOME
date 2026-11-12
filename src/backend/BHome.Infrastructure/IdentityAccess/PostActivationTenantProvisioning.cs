using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed record ApprovedTenantInvitation(Guid OwnerId, Guid ResidentId, Guid ContractId);
internal sealed class PostActivationTenantProvisioning(BHomePersistenceContext db, UserManager<ApplicationUser> users,
    IBackgroundJobQueue jobs, IdentitySecurityStore security) : IPostActivationTenantProvisioning
{
    public async Task ProvisionAsync(Contract contract, Guid ownerId, CancellationToken t)
    {
        if (db is not Compact24DbContext compact) return; // Offline legacy regression schema has no lifecycle extension.
        if (contract.Status != ContractStatus.Active || contract.Kind == ContractKind.Holding || contract.OwnerSignerId != ownerId ||
            db.Database.CurrentTransaction is null) throw ContractException.Conflict("active_main_contract_required_for_accounts");
        var ids = contract.Residents.Select(r => r.ResidentId).ToArray();
        var residents = await db.Set<Resident>().Where(r => ids.Contains(r.Id) && r.RoomId == contract.RoomId && r.OwnerUserId == ownerId).ToArrayAsync(t);
        if (residents.Length != ids.Length) throw ContractException.Conflict("contract_residents_changed");
        foreach (var resident in residents)
        {
            ApplicationUser account;
            var existingLink = resident.TenantUserId ?? (resident.Id == contract.RepresentativeResidentId ? contract.TenantUserId : null);
            if (existingLink is { } linked)
            {
                account = await db.Users.SingleOrDefaultAsync(u => u.Id == linked, t) ?? throw ContractException.Conflict("resident_account_link_invalid");
                if (!account.IsActive || !db.Entry(account).Property<string[]>("roles").CurrentValue!.Contains(Roles.Tenant) ||
                    resident.ContactEmail is { } contact && !string.Equals(account.Email, contact.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw ContractException.Conflict("resident_account_email_mismatch");
                resident.TenantUserId = linked;
                resident.ContactEmail ??= account.Email?.Trim().ToLowerInvariant();
            }
            else
            {
                var email = resident.ContactEmail?.Trim().ToLowerInvariant();
                if (email is null || email.Length > 256 || !new EmailAddressAttribute().IsValid(email)) throw ContractException.Conflict("resident_email_required");
                if (await users.FindByEmailAsync(email) is not null) throw ContractException.Conflict("email_requires_explicit_account_link");
                account = new ApplicationUser
                {
                    Id = Guid.NewGuid(),
                    Email = email,
                    UserName = email,
                    IsActive = true,
                    EmailConfirmed = false,
                    NormalizedEmail = users.NormalizeEmail(email),
                    NormalizedUserName = users.NormalizeName(email),
                    SecurityStamp = Guid.NewGuid().ToString("N"),
                    ConcurrencyStamp = Guid.NewGuid().ToString("N"),
                    LockoutEnabled = true
                };
                account.PasswordHash = users.PasswordHasher.HashPassword(account, Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)) + "!aA1");
                db.Users.Add(account); db.Entry(account).Property("roles").CurrentValue = new[] { Roles.Tenant };
                AccountInvitations.MarkPendingSetup(compact, account, DateTimeOffset.UtcNow);
                // Compact24 writes domain projections before native Identity rows. Persist this User
                // before assigning its foreign keys; the enclosing activation transaction is still uncommitted.
                await db.SaveChangesAsync(t);
                resident.TenantUserId = account.Id;
            }
            if (resident.Id == contract.RepresentativeResidentId) contract.TenantUserId = account.Id;
            if (!account.EmailConfirmed)
            {
                // Existing Owner-approved links also wait for setup before the asynchronous dispatch.
                if (db.Entry(account).Property<string>("reset_token_hash").CurrentValue is null ||
                    db.Entry(account).Property<DateTimeOffset?>("reset_consumed_at").CurrentValue is not null)
                {
                    AccountInvitations.MarkPendingSetup(compact, account, DateTimeOffset.UtcNow);
                    if (existingLink is not null)
                    {
                        if (!(await users.UpdateSecurityStampAsync(account)).Succeeded)
                            throw ContractException.Conflict("resident_account_changed");
                        await security.RevokeAllAsync(account.Id, "InvitationPending", t);
                    }
                }
                await jobs.EnqueueAsync(new(AccountInvitationJob.JobName, $"contract:{contract.Id:N}:resident:{resident.Id:N}",
                    JsonSerializer.Serialize(new ApprovedTenantInvitation(ownerId, resident.Id, contract.Id))), t);
            }
        }
        // One transaction persists occupancy, accounts, resident links and dispatch intents.
        await db.SaveChangesAsync(t);
    }
}
