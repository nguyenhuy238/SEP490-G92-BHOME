using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.EntityFrameworkCore.Metadata;

namespace BHome.Infrastructure.Persistence.Compact24;

internal static class Compact24DomainModel
{
    internal static void Configure(ModelBuilder model)
    {
        // Reuse domain relationship configuration; SQL projections replace every source table.
        model.ConfigureCapture();
        model.ConfigureContracts();
        model.ApplyConfigurationsFromAssembly(typeof(Compact24DomainModel).Assembly);
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentReportConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.IncidentReport>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.WorkOrderConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentActivityConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.IncidentActivity>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentEvidenceConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.IncidentEvidence>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.EmergencyActionConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.EmergencyAction>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.MaintenanceExpenseConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.MaintenanceExpense>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.MaintenanceHistoryConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.MaintenanceHistory>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentCommandConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.IncidentCommand>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentNotificationConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.IncidentNotification>());
        new BHome.Infrastructure.Modules.IncidentMaintenance.Persistence.IncidentFileUploadConfiguration().Configure(model.Entity<BHome.Domain.IncidentMaintenance.IncidentFileUpload>());
        model.Ignore<AuthenticationSession>();
        model.Ignore<RefreshTokenRecord>();
        model.Ignore<PasswordResetGrant>();
        model.Ignore<IdentityUserClaim<Guid>>();
        model.Ignore<IdentityRoleClaim<Guid>>();
        model.Ignore<IdentityUserLogin<Guid>>();
        model.Ignore<IdentityUserToken<Guid>>();
        model.Entity<IdentityUserRole<Guid>>().HasKey(x => new { x.UserId, x.RoleId });

        var contract = model.Entity<Contract>();
        model.Entity<Resident>().Property(x => x.ContactEmail).HasMaxLength(256);
        contract.Property(x => x.SigningMode);
        contract.Property(x => x.InternalAcceptance);
        model.Entity<ContractSigningInvitation>().HasKey(x => x.Id);
        model.Entity<BHome.Domain.Billing.InvoiceLine>().Property(x => x.UtilityCalculationSnapshot);
        contract.Property(x => x.ParentContractId); contract.Property(x => x.OperatingPolicySnapshot);
        contract.Property(x => x.HoldingExpiryAt); contract.Property(x => x.ReservedCapacity);
        contract.Property(x => x.ApprovedByUserId); contract.Property(x => x.ApprovedAt); contract.Property(x => x.ApprovalReason);
        contract.Property(x => x.AgreedPriceSnapshot); contract.Property(x => x.PriceLockTrigger); contract.Property(x => x.PriceLockedAt);
        contract.Property(x => x.ConvertedMainContractId);
        contract.Property(x => x.LifecycleActorId); contract.Property(x => x.LifecycleAt); contract.Property(x => x.LifecycleReason);
        var transfer = model.Entity<BHome.Domain.PaymentsDebt.PaymentTransfer>();
        transfer.Property(x => x.ProposedDepositContractId);
        var allocation = model.Entity<BHome.Domain.PaymentsDebt.PaymentAllocation>();
        allocation.Property(x => x.TransferId).IsRequired(false); allocation.Property(x => x.InvoiceId).IsRequired(false);
        allocation.Property(x => x.SourceDepositContractId); allocation.Property(x => x.TargetDepositContractId);
        allocation.Property(x => x.TargetSettlementContractId); allocation.Property(x => x.SettlementReceivableId); allocation.Property(x => x.DepositOffsetApprovalId);
        allocation.HasOne<Contract>().WithMany().HasForeignKey(x => x.TargetSettlementContractId).OnDelete(DeleteBehavior.Restrict);
        allocation.HasOne<Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.Restrict);
        allocation.HasOne<Contract>().WithMany().HasForeignKey(x => x.TargetDepositContractId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<BHome.Domain.PaymentsDebt.PaymentReconciliation>().Property(x => x.DepositContractId);

        foreach (var entity in model.Model.GetEntityTypes().ToArray())
        {
            if (entity.ClrType == typeof(ApplicationUser) || entity.ClrType == typeof(CompactRefreshRow)) continue;
            var spec = Compact24Records.For(entity.ClrType);
            var builder = model.Entity(entity.ClrType);
            // These entities are SQL projections, not physical tables. Table-only
            // checks make EF 8 scaffold invalid ToTable(null, ...) snapshot calls.
            // Physical checks remain in the reviewed Compact24 SQL and migration.
            foreach (var constraint in entity.GetCheckConstraints().ToArray())
                entity.RemoveCheckConstraint(constraint.ModelName);
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(property.Name);
                property.ValueGenerated = ValueGenerated.Never;
            }
            // No views or compatibility tables are created. Queries execute against Compact24.
            builder.ToTable((string?)null);
            builder.ToSqlQuery(spec.Select(entity).Replace("{", "{{", StringComparison.Ordinal).Replace("}", "}}", StringComparison.Ordinal));
        }
    }
}
