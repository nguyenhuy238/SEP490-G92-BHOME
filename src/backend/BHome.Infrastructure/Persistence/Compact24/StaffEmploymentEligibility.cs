using Microsoft.EntityFrameworkCore;
using BHome.Infrastructure.Persistence;

namespace BHome.Infrastructure.Persistence.Compact24;

/// <summary>
/// Authoritative effective Staff eligibility for Compact24. Seeded / upgraded Staff with no
/// employment records keep their legacy account-and-Location access. Once an employment
/// record exists, exactly one period must cover the business date and it must be Active.
/// Gaps, ended periods and overlapping/corrupt periods fail closed.
/// </summary>
internal static class StaffEmploymentEligibility
{
    // These access queries already apply role checks at their own boundary.
    // Preserve their legacy fallback (active users), not the stricter assignment query.
    internal static IQueryable<Guid> EligibleStaffIds(this BHomePersistenceContext db, DateOnly date) =>
        db is Compact24DbContext compact ? EligibleIds(compact, date) : db.Users.Where(user => user.IsActive).Select(user => user.Id);

    internal static IQueryable<Guid> EligibleIds(Compact24DbContext db, DateOnly date) =>
        db.Database.SqlQuery<Guid>($"""
            SELECT u.id AS "Value" FROM users u
            WHERE u.is_active AND 'Staff'=ANY(u.roles)
              AND (NOT EXISTS(SELECT 1 FROM staff_employments e WHERE e.staff_user_id=u.id)
                OR ((SELECT count(*) FROM staff_employments e WHERE e.staff_user_id=u.id
                       AND e.start_date<={date} AND (e.end_date IS NULL OR e.end_date>={date}))=1
                  AND EXISTS(SELECT 1 FROM staff_employments e WHERE e.staff_user_id=u.id
                       AND e.start_date<={date} AND (e.end_date IS NULL OR e.end_date>={date})
                       AND lower(btrim(e.status))='active')))
            """);

    internal static Task<bool> IsEligibleAsync(Compact24DbContext db, Guid staffId, DateOnly date,
        CancellationToken token) => EligibleIds(db, date).AnyAsync(id => id == staffId, token);
}
