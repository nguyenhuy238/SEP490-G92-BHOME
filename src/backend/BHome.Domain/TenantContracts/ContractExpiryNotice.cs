namespace BHome.Domain.TenantContracts;
// Persisted in-app reminder. Delivery integrations may retry independently; no automatic closure.
public sealed class ContractExpiryNotice
{
    public Guid Id {get;set;}=Guid.NewGuid();
    public Guid ContractId {get;set;}
    public Guid RecipientId {get;set;}
    public DateOnly EndDate {get;set;}
    public string Stage {get;set;}="";
    public DateTimeOffset CreatedAt {get;set;}
}
