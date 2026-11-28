using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

// Physical table mapping is part of the existing runtime context. Historical
// projections remain only for workflows that have not yet been converted.
internal static class Compact24NativeModel
{
    internal static bool IsNative(Type type) => type.Namespace == typeof(Native.Room).Namespace;

    internal static void Configure(ModelBuilder model)
    {
        model.Entity<Native.StaffEmployment>().ToTable("staff_employments", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Location>().ToTable("locations", "public", t => t.ExcludeFromMigrations())
            .Property(x => x.Version).IsConcurrencyToken();
        model.Entity<Native.Room>().ToTable("rooms", "public", t => t.ExcludeFromMigrations())
            .Property(x => x.Version).IsConcurrencyToken();
        model.Entity<Native.Asset>().ToTable("assets", "public", t => t.ExcludeFromMigrations())
            .Property(x => x.Version).IsConcurrencyToken();
        model.Entity<Native.Resident>().ToTable("residents", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Contract>().ToTable("contracts", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.ContractSigning>().ToTable("contract_signings", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.ContractResident>().ToTable("contract_residents", "public", t => t.ExcludeFromMigrations())
            .HasKey(x => new { x.ContractId, x.ResidentId });
        model.Entity<Native.IncidentReport>().ToTable("incident_reports", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.OperationalTask>().ToTable("operational_tasks", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Meter>().ToTable("meters", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.MeterReading>().ToTable("meter_readings", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.BillingPolicy>().ToTable("billing_policies", "public", t => t.ExcludeFromMigrations())
            .Property(x => x.Version).IsConcurrencyToken();
        model.Entity<Native.Invoice>().ToTable("invoices", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.InvoiceItem>().ToTable("invoice_items", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.InvoiceAdjustment>().ToTable("invoice_adjustments", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Payment>().ToTable("payments", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.PaymentAllocation>().ToTable("payment_allocations", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.RefundRequest>().ToTable("refund_requests", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Expense>().ToTable("expenses", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.FinancialScenario>().ToTable("financial_scenarios", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Notification>().ToTable("notifications", "public", t => t.ExcludeFromMigrations());
        ConfigureRelationships(model);
        foreach (var entity in model.Model.GetEntityTypes().Where(e => IsNative(e.ClrType)))
            foreach (var key in entity.FindPrimaryKey()!.Properties)
                key.ValueGenerated = Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.Never;
    }

    // Keep physical foreign keys visible; PostgreSQL remains the authority for
    // constraints, indexes and deferred checks. No cascade writes from this read model.
    private static void ConfigureRelationships(ModelBuilder model)
    {
        model.Entity<CompactRefreshRow>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<CompactRefreshRow>().HasOne<CompactRefreshRow>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<CompactRefreshRow>().HasOne<CompactRefreshRow>().WithMany().HasForeignKey(x => x.ReplacedByTokenId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.StaffEmployment>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.StaffUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Location>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Room>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Room>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Asset>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Asset>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<Native.Room>().WithMany().HasForeignKey(x => x.CurrentRoomId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.IdentityOwnerScopeId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.RepresentativeResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.OwnerSignerId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.PreviousContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ParentContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.SourceHoldingContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActivatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractSigning>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractSigning>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.SignerUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractResident>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractResident>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.ResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractResident>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.OwnerConfirmedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ReporterUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.IncidentReport>().WithMany().HasForeignKey(x => x.DuplicateOfReportId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.AssignedUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CostApprovedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Meter>().HasOne<Native.Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Meter>().HasOne<Native.Meter>().WithMany().HasForeignKey(x => x.PreviousMeterId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.MeterReading>().HasOne<Native.Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.MeterReading>().HasOne<Native.OperationalTask>().WithOne().HasForeignKey<Native.MeterReading>(x => x.OperationalTaskId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.MeterReading>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ConfirmedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.BillingPolicy>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.BillingPolicy>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RepresentativeTenantUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.FinalizedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceItem>().HasOne<Native.Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceItem>().HasOne<Native.BillingPolicy>().WithMany().HasForeignKey(x => x.BillingPolicyId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceItem>().HasOne<Native.MeterReading>().WithMany().HasForeignKey(x => x.MeterReadingId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceAdjustment>().HasOne<Native.Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceAdjustment>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceAdjustment>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Payment>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.BeneficiaryResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Payment>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Payment>().WithMany().HasForeignKey(x => x.SourcePaymentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Invoice>().WithMany().HasForeignKey(x => x.TargetInvoiceId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.TargetDepositContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.TargetInitialContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.TargetSettlementContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.PaymentAllocation>().WithOne().HasForeignKey<Native.PaymentAllocation>(x => x.ReversalOfAllocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.PaidByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.Payment>().WithMany().HasForeignKey(x => x.SourcePaymentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.BeneficiaryResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RecordedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.FinancialScenario>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.FinancialScenario>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RecipientUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.NoAction);
    }
}
