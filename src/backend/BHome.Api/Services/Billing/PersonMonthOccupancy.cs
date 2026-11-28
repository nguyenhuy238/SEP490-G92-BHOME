using BHome.Domain.TenantContracts;

namespace BHome.Application.Billing;

// Count actual contract members, including co-occupants, once per room/day.
// Neither Room.Capacity nor the billing notification audience is an occupancy source.
public sealed record PersonMonthOccupancy(int ResidentCount, int PersonDays, bool IsComplete, int? RoomCapacity = null)
{
    // Billing quantity is independent of the actual household roster (decision 26/11/2026).
    // Keep Read() for actual occupancy and never use this quantity for admission checks.
    public static PersonMonthOccupancy ForRoomCapacity(int capacity, int occupiedDays) =>
        new(capacity, checked(capacity * occupiedDays), capacity > 0 && occupiedDays > 0, capacity);

    public static PersonMonthOccupancy Read(DateOnly period, IEnumerable<Contract> contracts)
    {
        var members = contracts.ToArray();
        var end = period.AddMonths(1).AddDays(-1);
        var complete = members.Length > 0 && members.All(c =>
            c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId && r.ResidentId != Guid.Empty) &&
            c.Residents.All(r => r.ResidentId != Guid.Empty && r.ResidenceFrom != default &&
                (r.ResidenceTo == null || r.ResidenceTo >= r.ResidenceFrom)) &&
            c.Residents.Any(r => r.ResidenceFrom <= end && r.ResidenceFrom <= (c.ActualEndDate ?? c.EndDate) &&
                (r.ResidenceTo == null || (r.ResidenceTo >= period && r.ResidenceTo >= c.StartDate))));
        var residents = new HashSet<Guid>();
        var personDays = 0;
        for (var day = 0; day < DateTime.DaysInMonth(period.Year, period.Month); day++)
        {
            var date = period.AddDays(day);
            var daily = members.Where(c => c.StartDate <= date && (c.ActualEndDate ?? c.EndDate) >= date)
                .SelectMany(c => c.Residents)
                .Where(r => r.ResidentId != Guid.Empty && r.ResidenceFrom <= date &&
                    (r.ResidenceTo == null || r.ResidenceTo >= date))
                .Select(r => r.ResidentId).ToHashSet();
            personDays += daily.Count;
            residents.UnionWith(daily);
        }
        return new(residents.Count, personDays, complete && personDays > 0);
    }
}
