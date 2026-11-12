using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;
using BHome.Application.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.Contracts;

// Edit paragraph slots in the supplied OOXML package. All untouched clauses, styles and relationships survive.
internal sealed class MainDraftRenderer(IConfiguration configuration, TimeProvider clock, IHostEnvironment? environment = null) : IMainDraftRenderer
{
    public bool SigningReviewAvailable => environment is not null && (environment.IsDevelopment() || environment.IsEnvironment("Testing"));
    public string TemplateHash
    {
        get { using var stream = typeof(MainDraftRenderer).Assembly.GetManifestResourceStream("BHome.Contracts.main-tenancy-original.docx") ?? throw new ContractException(503, "contract_template_not_found"); return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream)); }
    }
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static string Date(DateOnly d) => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
    private static string Money(decimal value) => value.ToString("#,0.####", CultureInfo.GetCultureInfo("vi-VN"));
    private static void Text(XElement p, string value)
    {
        var properties = p.Element(W + "pPr"); var runProperties = p.Elements(W + "r").Select(r => r.Element(W + "rPr")).FirstOrDefault(r => r is not null);
        p.Elements().Where(e => e != properties).Remove();
        var run = new XElement(W + "r", runProperties is null ? null : new XElement(runProperties));
        var lines = value.Replace("\r\n", "\n").Split('\n');
        for (var i = 0; i < lines.Length; i++) { if (i > 0) run.Add(new XElement(W + "br")); run.Add(new XElement(W + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), lines[i])); }
        p.Add(run);
    }
    public Task<byte[]> DocxAsync(MainDraftRenderData data, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        var owner = data.Settings.Owner; var tenant = data.Tenant;
        if (tenant.DateOfIssue is null || string.IsNullOrWhiteSpace(tenant.ResidentialAddress)) throw ContractException.Conflict("tenant_issue_date_and_address_required");
        using var source = typeof(MainDraftRenderer).Assembly.GetManifestResourceStream("BHome.Contracts.main-tenancy-original.docx") ?? throw new ContractException(503, "contract_template_not_found");
        using var output = new MemoryStream(); source.CopyTo(output);
        using (var package = new ZipArchive(output, ZipArchiveMode.Update, true))
        {
            var entry = package.GetEntry("word/document.xml") ?? throw new ContractException(503, "contract_template_invalid");
            XDocument xml; using (var input = entry.Open()) xml = XDocument.Load(input, LoadOptions.PreserveWhitespace);
            var side = 0; var mapped = 0;
            var charges = data.State.Charges;
            decimal Rate(string code) => charges.Single(c => c.ChargeCode == code).Rate;
            foreach (var p in xml.Descendants(W + "p").ToArray())
            {
                t.ThrowIfCancellationRequested();
                var original = string.Concat(p.Descendants(W + "t").Select(n => n.Value)).Trim();
                string? replacement = null;
                if (original.StartsWith("1.Đại diện")) side = 1;
                if (original.StartsWith("2. Bên thuê")) side = 2;
                if (original.StartsWith("Hôm nay ngày")) replacement = $"Hôm nay ngày {clock.GetUtcNow().ToOffset(TimeSpan.FromHours(7)):dd/MM/yyyy}; tại địa chỉ: {data.Address}";
                else if (original.StartsWith("Ông/bà:")) replacement = side == 1 ? $"Ông/bà: {owner.FullName}. Sinh ngày: {Date(owner.DateOfBirth)}" : $"Ông/bà: {tenant.FullName}. Sinh ngày: {Date(tenant.DateOfBirth)}";
                else if (original.StartsWith("Nơi đăng ký")) replacement = $"Nơi đăng ký HK thường trú: {(side == 1 ? owner.Address : tenant.ResidentialAddress)}";
                else if (original.StartsWith("CMND số:") || original.StartsWith("Số CMND:")) replacement = side == 1 ? $"CCCD số: {owner.CitizenNumber}; cấp ngày {Date(owner.DateOfIssue)} tại: {owner.PlaceOfIssue}" : $"CCCD số: {tenant.CitizenIdentityNumber}; cấp ngày {Date(tenant.DateOfIssue.Value)}" + (string.IsNullOrWhiteSpace(data.State.Input.TenantPlaceOfIssue) ? "" : $" tại: {data.State.Input.TenantPlaceOfIssue}");
                else if (original.StartsWith("Số điện thoại:")) replacement = $"Số điện thoại: {(side == 1 ? owner.Phone : data.State.Input.TenantPhone)}";
                else if (original.StartsWith("Bên A đồng ý")) replacement = $"Bên A đồng ý cho bên B thuê 01 phòng {data.RoomNumber}, cơ sở {data.LocationName}, tại địa chỉ: {data.Address}";
                else if (original.StartsWith("Giá thuê:")) replacement = $"Giá thuê: {Money(data.Contract.MonthlyRent)} đ/tháng";
                else if (original.StartsWith("Hình thức thanh toán:")) replacement = $"Hình thức thanh toán: {data.Settings.PaymentTerms}";
                else if (original.StartsWith("Tiền điện")) replacement = $"Tiền điện: {Money(Rate("ELECTRICITY"))} đ/kWh tính theo chỉ số công tơ, thanh toán vào cuối các tháng.";
                else if (original.StartsWith("Tiền nước:")) replacement = $"Tiền nước: {Money(Rate("WATER"))} đ/m³ theo chỉ số đồng hồ, thanh toán vào đầu các tháng.";
                else if (original.StartsWith("Tiền đặt cọc:")) replacement = $"Tiền đặt cọc: {Money(data.Contract.RequiredDeposit)} đ.";
                else if (original.StartsWith("Hợp đồng có giá trị")) replacement = $"Hợp đồng có giá trị kể từ ngày {Date(data.Contract.StartDate)} đến ngày {Date(data.Contract.EndDate)}.";
                else if (original.Length > 0 && original.All(c => char.IsWhiteSpace(c) || c is '.' or '…')) replacement = "";
                if (replacement is not null) { Text(p, replacement); if (replacement.Length > 0) mapped++; }
                else if (original.Contains('…') || original.Contains("....") || original.Contains("{{")) throw new ContractException(503, "contract_template_slots_changed");
                if (original == "TRÁCH NHIỆM CỦA CÁC BÊN")
                {
                    var extra = charges.Where(c => c.ChargeCode is not ("RENT" or "ELECTRICITY" or "WATER")).Select(c => $"{c.Name}: {Money(c.Rate)} đ/phòng/tháng.");
                    var occupants = data.Occupants is { Length: > 0 } ? "Thành viên cùng ở: " + string.Join(", ", data.Occupants) : "";
                    var text = string.Join("\n", extra.Append(occupants).Append(data.Contract.Terms).Where(x => !string.IsNullOrWhiteSpace(x)));
                    if (text.Length > 0)
                    {
                        var body = xml.Descendants(W + "p").First(q => string.Concat(q.Descendants(W + "t").Select(n => n.Value)).StartsWith("Giá thuê:"));
                        var extraParagraph = new XElement(body); Text(extraParagraph, text);
                        var paragraphProperties = extraParagraph.Element(W + "pPr");
                        if (paragraphProperties is null) { paragraphProperties = new XElement(W + "pPr"); extraParagraph.AddFirst(paragraphProperties); }
                        paragraphProperties.Elements(W + "jc").Remove(); paragraphProperties.Add(new XElement(W + "jc", new XAttribute(W + "val", "left")));
                        p.AddBeforeSelf(extraParagraph);
                    }
                }
                if (original == "HỢP ĐỒNG THUÊ PHÒNG TRỌ")
                {
                    var notice = new XElement(p);
                    Text(notice, data.SigningReview ? "TÀI LIỆU KIỂM THỬ – MẪU CHƯA ĐƯỢC DUYỆT CHO PRODUCTION" : $"BẢN NHÁP – {data.Contract.Id}");
                    p.AddAfterSelf(notice);
                }
            }
            if (mapped != 16) throw new ContractException(503, "contract_template_slots_changed");
            using var stream = entry.Open(); stream.SetLength(0); xml.Save(stream, SaveOptions.DisableFormatting);
        }
        return Task.FromResult(output.ToArray());
    }
    public async Task<byte[]> PdfAsync(byte[] docx, CancellationToken t)
    {
        var bytes = await PrivateContractConversion.RunAsync(configuration, docx, "draft.docx", "draft.pdf",
            configuration["MainDraft:LibreOfficePath"], null,
            ["-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf", "--outdir", "{work}", "{work}/draft.docx"], t);
        if (!bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) throw new ContractException(503, "contract_pdf_conversion_failed");
        return bytes;
    }
}
