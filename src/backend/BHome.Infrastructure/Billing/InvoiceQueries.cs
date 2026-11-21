using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;

namespace BHome.Infrastructure.Billing;

internal static class InvoiceQueries
{
    // A separate damage invoice must neither satisfy nor block monthly billing coverage.
    internal static IQueryable<Invoice> PeriodicInvoices(this BHomePersistenceContext db) => db is Compact24DbContext
        ? db.Set<Invoice>().Where(i => i.Type == "PERIODIC") : db.Set<Invoice>();
}
