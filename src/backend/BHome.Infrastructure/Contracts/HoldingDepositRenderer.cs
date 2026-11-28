using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;
using Microsoft.Extensions.Configuration;

namespace BHome.Infrastructure.Contracts;

internal sealed class HoldingDepositRenderer(IConfiguration configuration)
{
    internal const string TemplateId = "holding-deposit-v1";
    internal const int DocumentVersion = 2;
    private const string OwnerHeading = "BÊN NHẬN TIỀN ĐẶT CỌC (BÊN A)";
    private const string TenantHeading = "BÊN GIAO TIỀN ĐẶT CỌC (BÊN B)";
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly CultureInfo Vietnamese = CultureInfo.GetCultureInfo("vi-VN");
    private static string Date(DateOnly? value) => value?.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) ?? "Chưa cung cấp";
    private static string Money(decimal value) => value.ToString("#,0", Vietnamese) + " đồng";
    private static string Provided(string? value) => string.IsNullOrWhiteSpace(value) ? "Chưa cung cấp" : value;

    internal async Task<byte[]> PdfAsync(Contract contract, LessorProfile owner, IdentityConfirmation tenant, string? tenantPhone, CancellationToken token)
    {
        var bytes = await MainDraftRenderer.ConvertPdfAsync(configuration, Docx(contract, owner, tenant, tenantPhone), token);
        return MainTemplateSignatureSlots.Add(bytes, TemplateId, ownerOnLeft: true, OwnerHeading, TenantHeading);
    }

    internal static byte[] Docx(Contract contract, LessorProfile owner, IdentityConfirmation tenant, string? tenantPhone)
    {
        if (!tenant.HumanConfirmed || string.IsNullOrWhiteSpace(tenant.FullName) || tenant.DateOfBirth == default ||
            string.IsNullOrWhiteSpace(tenant.CitizenIdentityNumber))
            throw ContractException.Conflict("confirmed_identity_required");
        if (contract.HoldingExpiryAt is not { } expiry) throw ContractException.Conflict("invalid_holding_terms");
        var address = contract.Room.Location.Address;
        var created = DateOnly.FromDateTime(contract.CreatedAt.ToOffset(TimeSpan.FromHours(7)).DateTime);
        var deadline = expiry.ToOffset(TimeSpan.FromHours(7)).ToString("HH:mm dd/MM/yyyy", CultureInfo.InvariantCulture);
        using var source = typeof(HoldingDepositRenderer).Assembly.GetManifestResourceStream($"BHome.Contracts.{TemplateId}.docx")
            ?? throw new ContractException(503, "contract_template_not_found");
        using var output = new MemoryStream();
        source.CopyTo(output);
        using (var package = new ZipArchive(output, ZipArchiveMode.Update, leaveOpen: true))
        {
            var entry = package.GetEntry("word/document.xml") ?? throw new ContractException(503, "contract_template_invalid");
            XDocument xml;
            using (var stream = entry.Open()) xml = XDocument.Load(stream);
            var paragraphs = xml.Descendants(W + "p").ToArray();
            if (paragraphs.Length != 59 || !ParagraphText(paragraphs[38]).StartsWith("2.1", StringComparison.Ordinal) ||
                !ParagraphText(paragraphs[57]).Contains(OwnerHeading, StringComparison.Ordinal))
                throw new ContractException(503, "contract_template_slots_changed");
            var fields = new Dictionary<int, string>
            {
                [7] = "",
                [8] = $"Hợp đồng lập ngày {Date(created)} tại địa chỉ: {Provided(address)}.",
                [12] = $"Ông/bà: {owner.FullName}. Năm sinh: {owner.DateOfBirth.Year}.",
                [13] = $"CCCD số: {owner.CitizenNumber}. Ngày cấp: {Date(owner.DateOfIssue)}. Nơi cấp: {Provided(owner.PlaceOfIssue)}.",
                [14] = $"Địa chỉ thường trú: {Provided(owner.Address)}.",
                [15] = "",
                [16] = $"Điện thoại: {Provided(owner.Phone)}.",
                [21] = $"Ông/bà: {tenant.FullName}. Năm sinh: {tenant.DateOfBirth.Year}.",
                [22] = $"CCCD số: {tenant.CitizenIdentityNumber}. Ngày cấp: {Date(tenant.DateOfIssue)}.",
                [23] = $"Địa chỉ thường trú: {Provided(tenant.ResidentialAddress)}.",
                [24] = "",
                [25] = $"Điện thoại: {Provided(tenantPhone)}.",
                [31] = $"Bên A đồng ý cho Bên B thuê phòng {contract.Room.RoomNumber}, cơ sở {contract.Room.Location.Name}, tại địa chỉ: {Provided(address)}.",
                [32] = "",
                [33] = contract.Room.RoomType?.AreaM2 is { } area ? $"- Diện tích cho thuê: {area.ToString("0.##", Vietnamese)} m²." : "",
                [34] = $"- Giá cho thuê / tháng: {Money(contract.MonthlyRent)}.",
                [35] = $"- Thời hạn thuê dự kiến từ ngày {Date(contract.StartDate)} đến ngày {Date(contract.EndDate)}.",
                [38] = $"2.1 Bên B có nghĩa vụ thanh toán tiền giữ chỗ là {Money(contract.RequiredDeposit)}. " +
                    "Khoản tiền giữ chỗ chỉ được ghi nhận đã thanh toán sau khi giao dịch được xác minh. " +
                    "Khi hai bên giao kết hợp đồng thuê chính thức, khoản tiền giữ chỗ đã được xác minh được cấn trừ vào tiền đặt cọc của hợp đồng thuê chính thức.",
                [39] = "2.2 Hai bên thực hiện việc giao kết hợp đồng thuê phòng trọ/nhà trọ trong thời hạn giữ chỗ.",
                [40] = $"Hạn giữ chỗ: {deadline} (giờ Việt Nam).",
                [55] = $"Ngày lập hợp đồng: {Date(created)}."
            };
            foreach (var (position, value) in fields)
                MainDraftRenderer.Text(paragraphs[position], value);
            if (!string.IsNullOrWhiteSpace(contract.Terms))
            {
                var additional = new XElement(paragraphs[51]);
                MainDraftRenderer.Text(additional, "Thỏa thuận bổ sung: " + contract.Terms);
                paragraphs[54].AddAfterSelf(additional);
            }
            paragraphs[57].ReplaceWith(ContractDocxLayout.SignatureTable(OwnerHeading, TenantHeading));
            ContractDocxLayout.Apply(xml);
            using var destination = entry.Open();
            destination.SetLength(0);
            xml.Save(destination);
        }
        return output.ToArray();
    }

    private static string ParagraphText(XElement paragraph) => string.Concat(paragraph.Descendants(W + "t").Select(t => t.Value));

}
