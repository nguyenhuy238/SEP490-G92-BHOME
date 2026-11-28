using BHome.Domain.TenantContracts;

namespace BHome.Application.Billing;

public static class BillingReferenceContract
{
    public static bool Eligible(Contract contract, DateOnly period) =>
        (contract.Kind is ContractKind.Main or ContractKind.Renewal) &&
        contract.ActivatedAt is not null &&
        (contract.Status is ContractStatus.Active or ContractStatus.Expired or ContractStatus.Terminated or ContractStatus.Superseded) &&
        contract.StartDate < period.AddMonths(1) &&
        (contract.ActualEndDate ?? contract.EndDate) >= period.AddMonths(1);

    public static BillingOccupancy? Select(IEnumerable<BillingOccupancy> occupants, DateOnly period) =>
        occupants.Where(o => Eligible(o.Contract, period))
            .OrderBy(o => o.Contract.CreatedAt).ThenBy(o => o.Contract.Id).FirstOrDefault();
}
