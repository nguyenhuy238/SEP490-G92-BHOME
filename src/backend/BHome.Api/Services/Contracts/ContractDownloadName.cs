using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public static class ContractDownloadName
{
    public static string For(ContractKind kind, Guid id, bool docx = false)
    {
        var prefix = kind switch
        {
            ContractKind.Holding => "Hop-dong-dat-coc",
            ContractKind.Addendum or ContractKind.Renewal => "Phu-luc-hop-dong",
            _ => "Hop-dong-thue-phong"
        };
        // Tenancy contracts have no separate persisted contract-number field.
        return $"{prefix}-{id:N}.{(docx ? "docx" : "pdf")}";
    }
}
