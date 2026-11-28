using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using BHome.Domain.IdentityAccess;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal sealed class AnonymousSigningRepository(BHomePersistenceContext db) : IAnonymousSigningRepository
{
    public Task<bool> MatchesAccountEmailAsync(Guid userId, string email, CancellationToken t)
    {
        var normalized = email.Trim().ToLowerInvariant();
        return db.Users.AnyAsync(u => u.Id == userId && u.Email != null && u.Email.Trim().ToLower() == normalized, t);
    }

    public async Task<ContractSigningInvitation?> FindByTokenHashAsync(string hash, CancellationToken t) =>
        db is Compact24DbContext native
        ? (await NativeInvitationPersistence.ListAsync(native, null, null, hash, t)).SingleOrDefault()
        : await db.Set<ContractSigningInvitation>().SingleOrDefaultAsync(i => i.TokenHash == hash, t);
    public async Task<ContractSigningInvitation?> FindAsync(Guid id, CancellationToken t) =>
        db is Compact24DbContext native
        ? (await NativeInvitationPersistence.ListAsync(native, null, id, null, t)).SingleOrDefault()
        : await db.Set<ContractSigningInvitation>().SingleOrDefaultAsync(i => i.Id == id, t);
    public async Task<IReadOnlyList<ContractSigningInvitation>> ListAsync(Guid contractId, CancellationToken t) =>
        db is Compact24DbContext native
        ? await NativeInvitationPersistence.ListAsync(native, contractId, null, null, t)
        : await db.Set<ContractSigningInvitation>().Where(i => i.ContractId == contractId).OrderByDescending(i => i.CreatedAt).ToArrayAsync(t);
    public async Task<bool> IsEmailInUseAsync(Guid contractId, Guid residentId, string email, CancellationToken t)
    {
        email = email.Trim().ToLowerInvariant();
        if (db.Database.IsNpgsql() && db.Database.CurrentTransaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"bhome-signing-email:" + email},0))", t);
        if (db is Compact24DbContext native)
        {
            if (await db.Set<Native.Resident>().AsNoTracking().AnyAsync(r => r.Id != residentId &&
                r.ContactEmail != null && r.ContactEmail.Trim().ToLower() == email, t)) return true;
            if (await db.Users.AsNoTracking().AnyAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Staff) &&
                u.Email != null && u.Email.Trim().ToLower() == email, t)) return true;
            if (await (from c in db.Set<Native.Contract>().AsNoTracking()
                       join cr in db.Set<Native.ContractResident>().AsNoTracking() on c.Id equals cr.ContractId
                       join r in db.Set<Native.Resident>().AsNoTracking() on cr.ResidentId equals r.Id
                       where c.ContractType == "MAIN" && (c.Id != contractId && c.Status == (short)ContractStatus.Active || r.Id != residentId) &&
                         (r.ContactEmail != null && r.ContactEmail.Trim().ToLower() == email ||
                          db.Users.Any(u => u.Email != null && u.Email.Trim().ToLower() == email &&
                              (u.Id == r.UserId || r.Id == c.RepresentativeResidentId && u.Id == c.TenantUserId)))
                       select c.Id).AnyAsync(t)) return true;
            return await NativeInvitationPersistence.AcceptedEmailInUseAsync(native, contractId, residentId, email, t);
        }
        // The resident email index also covers profiles without a main contract.
        if (await db.Set<Resident>().AnyAsync(r => r.Id != residentId &&
            r.ContactEmail != null && r.ContactEmail.Trim().ToLower() == email, t)) return true;
        if (await (from u in db.Users
                   join ur in db.UserRoles on u.Id equals ur.UserId
                   join role in db.Roles on ur.RoleId equals role.Id
                   where role.Name == Roles.Staff && u.Email != null && u.Email.Trim().ToLower() == email
                   select u.Id).AnyAsync(t)) return true;

        var mains = db.Set<Contract>().Where(c => c.Kind == ContractKind.Main);
        if (await (from c in mains
                   join cr in db.Set<ContractResident>() on c.Id equals cr.ContractId
                   join r in db.Set<Resident>() on cr.ResidentId equals r.Id
                   where (c.Id != contractId && c.Status == ContractStatus.Active || r.Id != residentId) &&
                       (r.ContactEmail != null && r.ContactEmail.Trim().ToLower() == email ||
                        db.Users.Any(u => u.Email != null && u.Email.Trim().ToLower() == email &&
                            (u.Id == r.TenantUserId || r.Id == c.RepresentativeResidentId && u.Id == c.TenantUserId)))
                   select c.Id).AnyAsync(t)) return true;

        // Accepted invitation contacts remain evidence even if the profile email is later edited.
        var accepted = await (from c in mains
                              join i in db.Set<ContractSigningInvitation>() on c.Id equals i.ContractId
                              where i.AcceptedAt != null && i.RevokedAt == null &&
                                  (i.RecipientEmail.Trim().ToLower() == email ||
                                   i.ContactEmails != null && i.ContactEmails.ToLower().Contains(email))
                              select new { Invitation = i, Active = c.Id != contractId && c.Status == ContractStatus.Active }).ToArrayAsync(t);
        return accepted.Any(row => SigningContacts.Read(row.Invitation).Any(contact =>
            string.Equals(contact.Value.Trim(), email, StringComparison.OrdinalIgnoreCase) &&
            (row.Active || contact.Key != residentId)));
    }
    public void Add(ContractSigningInvitation invitation)
    {
        if (db is not Compact24DbContext) db.Add(invitation);
        else if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Invitation requires the contract transaction.");
    }
    public Task SaveAsync(ContractSigningInvitation invitation, CancellationToken t) =>
        db is Compact24DbContext native ? NativeInvitationPersistence.SaveAsync(native, invitation, t) : Task.CompletedTask;
}
