namespace BHome.Infrastructure.Contracts;

internal sealed class ContractPdfOptions
{
    public const string Section = "ContractPdf";
    public string? TemplateId { get; set; }

    public bool IsValid() => string.IsNullOrEmpty(TemplateId) || TemplateId.Length <= 80 &&
        TemplateId.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');
}
