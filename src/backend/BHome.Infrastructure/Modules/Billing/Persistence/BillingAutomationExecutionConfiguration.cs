using BHome.Domain.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Modules.Billing.Persistence;
internal sealed class BillingAutomationExecutionConfiguration:IEntityTypeConfiguration<BillingAutomationExecution>
{
    public void Configure(EntityTypeBuilder<BillingAutomationExecution> e)
    {
        e.ToTable("BillingAutomationExecutions");e.HasKey(r=>r.Id);e.HasIndex(r=>new{r.PlanId,r.BillingPeriod,r.Phase}).IsUnique();e.HasIndex(r=>new{r.LocationId,r.LastStartedAt});
        e.Property(r=>r.ExceptionsJson).HasColumnType("jsonb");e.Property(r=>r.Phase).HasMaxLength(30);e.Property(r=>r.Status).HasMaxLength(30);e.Property(r=>r.LastErrorCode).HasMaxLength(100);
        e.HasOne<BillingAutomationPlan>().WithMany().HasForeignKey(r=>r.PlanId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class BillingAutomationAttemptConfiguration:IEntityTypeConfiguration<BillingAutomationAttempt>
{
    public void Configure(EntityTypeBuilder<BillingAutomationAttempt> e)
    {
        e.ToTable("BillingAutomationAttempts");e.HasKey(r=>r.Id);e.HasIndex(r=>new{r.ExecutionId,r.Sequence}).IsUnique();e.Property(r=>r.Status).HasMaxLength(30);e.Property(r=>r.SummaryJson).HasColumnType("jsonb");e.HasOne<BillingAutomationExecution>().WithMany().HasForeignKey(r=>r.ExecutionId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class MeterPeriodUniquenessConfiguration:IEntityTypeConfiguration<OperationalTask>
{
    public void Configure(EntityTypeBuilder<OperationalTask> e)
    {
        e.ToTable("OperationalTasks",t=>t.HasCheckConstraint("CK_Task_RoomPeriod","(\"Kind\"<>0 OR \"Purpose\"<>1 OR (\"BillingRoomId\" IS NOT NULL AND \"BillingUtilityType\" IN (0,1))) AND (\"AutomationPlanId\" IS NULL OR (\"Kind\"=0 AND \"Purpose\"=1))"));
        e.HasIndex(r=>new{r.BillingRoomId,r.BillingUtilityType,r.BillingPeriod}).IsUnique().HasFilter("\"Kind\"=0 AND \"Purpose\"=1");
        e.HasOne<BillingAutomationPlan>().WithMany().HasForeignKey(r=>r.AutomationPlanId).OnDelete(DeleteBehavior.Restrict);
    }
}
