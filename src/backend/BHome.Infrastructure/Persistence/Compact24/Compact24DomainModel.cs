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
        model.Ignore<AuthenticationSession>();
        model.Ignore<RefreshTokenRecord>();
        model.Ignore<PasswordResetGrant>();
        model.Ignore<IdentityUserClaim<Guid>>();
        model.Ignore<IdentityRoleClaim<Guid>>();
        model.Ignore<IdentityUserLogin<Guid>>();
        model.Ignore<IdentityUserToken<Guid>>();
        model.Entity<IdentityUserRole<Guid>>().HasKey(x => new { x.UserId, x.RoleId });

        var contract = model.Entity<Contract>();
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
        allocation.HasOne<Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.Restrict);
        allocation.HasOne<Contract>().WithMany().HasForeignKey(x => x.TargetDepositContractId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<BHome.Domain.PaymentsDebt.PaymentReconciliation>().Property(x => x.DepositContractId);

        foreach (var entity in model.Model.GetEntityTypes().ToArray())
        {
            if (entity.ClrType == typeof(ApplicationUser) || entity.ClrType == typeof(CompactRefreshRow)) continue;
            var spec = Compact24Records.For(entity.ClrType);
            var builder = model.Entity(entity.ClrType);
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
