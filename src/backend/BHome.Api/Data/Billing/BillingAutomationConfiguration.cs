using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Modules.Billing.Persistence;
internal sealed class BillingAutomationPlanConfiguration : IEntityTypeConfiguration<BillingAutomationPlan>
{
    public void Configure(EntityTypeBuilder<BillingAutomationPlan> e)
    {
        e.ToTable("BillingAutomationPlans", t => t.HasCheckConstraint("CK_BillingAutomationPlan_Calendar", "\"Version\">0 AND \"BillingScheduleVersion\">0 AND \"MeterDay\" BETWEEN 1 AND 31 AND \"MeterDueDay\" BETWEEN 1 AND 31 AND \"MeterDueMonthOffset\" BETWEEN 0 AND 2 AND \"TimeZone\"='Asia/Ho_Chi_Minh' AND (NOT \"AuthorizeAutomaticFinalization\" OR \"Enabled\") AND EXTRACT(DAY FROM \"EffectiveFrom\")=1"));
        e.HasKey(p => p.Id); e.HasIndex(p => new { p.LocationId, p.Version }).IsUnique(); e.HasIndex(p => new { p.LocationId, p.EffectiveFrom, p.Version });
        e.Property(p => p.BillingSnapshot).HasColumnType("jsonb"); e.Property(p => p.TimeZone).HasMaxLength(50);
        e.HasOne<Location>().WithMany().HasForeignKey(p => p.LocationId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(p => p.AuthorizedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
