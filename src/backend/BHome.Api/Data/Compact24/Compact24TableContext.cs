using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

// Physical table model for incremental repository migration. It shares the existing
// connection and transaction. Only explicitly migrated repository workflows can write;
// the transitional model never owns schema migrations.
internal sealed class Compact24TableContext(DbContextOptions<Compact24TableContext> options) : DbContext(options)
{
    internal static async Task<Compact24TableContext> OpenAsync(Compact24DbContext db, CancellationToken token)
    {
        var options = new DbContextOptionsBuilder<Compact24TableContext>()
            .UseNpgsql(db.Database.GetDbConnection(), contextOwnsConnection: false)
            .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking).Options;
        var tables = new Compact24TableContext(options);
        try
        {
            if (db.Database.CurrentTransaction is { } transaction)
                await tables.Database.UseTransactionAsync(transaction.GetDbTransaction(), token);
            return tables;
        }
        catch
        {
            await tables.DisposeAsync();
            throw;
        }
    }

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Native.User>().ToTable("users", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.RefreshToken>().ToTable("refresh_tokens", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.StaffEmployment>().ToTable("staff_employments", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Location>().ToTable("locations", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Room>().ToTable("rooms", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Asset>().ToTable("assets", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Resident>().ToTable("residents", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Contract>().ToTable("contracts", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.ContractSigning>().ToTable("contract_signings", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.ContractResident>().ToTable("contract_residents", "public", t => t.ExcludeFromMigrations())
            .HasKey(x => new { x.ContractId, x.ResidentId });
        model.Entity<Native.IncidentReport>().ToTable("incident_reports", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.OperationalTask>().ToTable("operational_tasks", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Meter>().ToTable("meters", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.MeterReading>().ToTable("meter_readings", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.BillingPolicy>().ToTable("billing_policies", "public", t => t.ExcludeFromMigrations());
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
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var key in entity.FindPrimaryKey()!.Properties)
                key.ValueGenerated = Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.Never;
    }

    // Keep physical foreign keys visible; PostgreSQL remains the authority for
    // constraints, indexes and deferred checks. No cascade writes from this read model.
    private static void ConfigureRelationships(ModelBuilder model)
    {
        model.Entity<Native.RefreshToken>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefreshToken>().HasOne<Native.RefreshToken>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefreshToken>().HasOne<Native.RefreshToken>().WithMany().HasForeignKey(x => x.ReplacedByTokenId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.StaffEmployment>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.StaffUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Location>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Room>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Room>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Asset>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Asset>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<Native.Room>().WithMany().HasForeignKey(x => x.CurrentRoomId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.IdentityOwnerScopeId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Resident>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.RepresentativeResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.OwnerSignerId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.PreviousContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ParentContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.SourceHoldingContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Contract>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.ActivatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractSigning>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractSigning>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.SignerUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractResident>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractResident>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.ResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.ContractResident>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.OwnerConfirmedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.ReporterUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.IncidentReport>().WithMany().HasForeignKey(x => x.DuplicateOfReportId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.IncidentReport>().HasOne<Native.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.AssignedUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.CostApprovedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Meter>().HasOne<Native.Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Meter>().HasOne<Native.Meter>().WithMany().HasForeignKey(x => x.PreviousMeterId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.MeterReading>().HasOne<Native.Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.MeterReading>().HasOne<Native.OperationalTask>().WithOne().HasForeignKey<Native.MeterReading>(x => x.OperationalTaskId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.MeterReading>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.ConfirmedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.BillingPolicy>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.BillingPolicy>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.RepresentativeTenantUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.FinalizedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Invoice>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceItem>().HasOne<Native.Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceItem>().HasOne<Native.BillingPolicy>().WithMany().HasForeignKey(x => x.BillingPolicyId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceItem>().HasOne<Native.MeterReading>().WithMany().HasForeignKey(x => x.MeterReadingId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceAdjustment>().HasOne<Native.Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceAdjustment>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.InvoiceAdjustment>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Payment>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.BeneficiaryResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Payment>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Payment>().WithMany().HasForeignKey(x => x.SourcePaymentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Invoice>().WithMany().HasForeignKey(x => x.TargetInvoiceId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.TargetDepositContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.TargetInitialContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.TargetSettlementContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.PaymentAllocation>().WithOne().HasForeignKey<Native.PaymentAllocation>(x => x.ReversalOfAllocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.PaidByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.PaymentAllocation>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.Payment>().WithMany().HasForeignKey(x => x.SourcePaymentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.Resident>().WithMany().HasForeignKey(x => x.BeneficiaryResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.RecordedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<Native.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.FinancialScenario>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.FinancialScenario>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.RecipientUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<Native.User>().WithMany().HasForeignKey(x => x.ActorUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<Native.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.OperationalTask>().HasOne<Native.Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.NoAction);
    }

    // Repositories call this only after their existing lock, authorization, history and
    // idempotency checks. Reject all unconverted tables and every physical deletion.
    internal Task<int> SaveNativeAsync(CancellationToken token)
    {
        if (Database.CurrentTransaction is null)
            throw new InvalidOperationException("Native writes require the existing repository transaction.");
        ChangeTracker.DetectChanges();
        foreach (var entry in ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            var allowed = entry.Entity switch
            {
                Native.FinancialScenario => entry.State == EntityState.Added,
                Native.StaffEmployment => entry.State is EntityState.Added or EntityState.Modified,
                Native.Expense => entry.State is EntityState.Added or EntityState.Modified,
                _ => false
            };
            if (!allowed)
                throw new InvalidOperationException("Use the guarded Compact24 writer for unmigrated records or deletions.");
        }
        return base.SaveChangesAsync(true, token);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        throw new InvalidOperationException("Use the guarded Compact24 writer for business mutations.");

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Use the guarded Compact24 writer for business mutations.");
}
