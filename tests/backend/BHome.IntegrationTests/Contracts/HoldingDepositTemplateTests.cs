using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests.Contracts;

public sealed class HoldingDepositTemplateTests
{
    private static readonly LessorProfile Owner = new("Chủ nhà kiểm thử", new(1980, 1, 1), "000000000001",
        new(2020, 1, 1), "Cơ quan kiểm thử", "Địa chỉ chủ nhà", "0900000000");
    private static readonly IdentityConfirmation Tenant = new(true, "000000000002", "Người thuê kiểm thử",
        new(2000, 1, 1), "Địa chỉ người thuê", null, null, null, new(2021, 6, 15), null);

    private static Contract Draft()
    {
        var contract = new Contract
        {
            Kind = ContractKind.Holding,
            StartDate = new(2026, 11, 22),
            EndDate = new(2027, 1, 22),
            HoldingExpiryAt = new DateTimeOffset(2026, 11, 24, 17, 0, 0, TimeSpan.Zero),
            RentAmount = 2300000,
            RequiredDeposit = 2300000,
            Terms = "Điều khoản bổ sung kiểm thử.",
            Room = new Room
            {
                RoomNumber = "P.102",
                Location = new Location("Cơ sở kiểm thử") { Address = "Địa chỉ phòng kiểm thử" },
                RoomType = new RoomType { AreaM2 = 23 }
            }
        };
        contract.Stamp(new DateTimeOffset(2026, 11, 22, 3, 0, 0, TimeSpan.Zero), isNew: true);
        return contract;
    }

    [Fact]
    public void UnconfirmedIdentityCannotAppearOnTheContract()
    {
        var error = Assert.Throws<ContractException>(() => HoldingDepositRenderer.Docx(Draft(), Owner, Tenant with { HumanConfirmed = false }, null));
        Assert.Equal("confirmed_identity_required", error.Code);
    }

    [Fact]
    public async Task SuppliedTemplateKeepsPenaltyClausesAndPlacesBothSignersOnTheSamePdf()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local"
        }).Build();
        var bytes = await new HoldingDepositRenderer(config).PdfAsync(Draft(), Owner, Tenant, "0911111111", default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var qa = Environment.GetEnvironmentVariable("BHOME_CONTRACT_QA_DIR");
        if (!string.IsNullOrWhiteSpace(qa))
        {
            Directory.CreateDirectory(qa);
            await File.WriteAllBytesAsync(Path.Combine(qa, "holding-template.docx"), HoldingDepositRenderer.Docx(Draft(), Owner, Tenant, "0911111111"));
            await File.WriteAllBytesAsync(Path.Combine(qa, "holding-template.pdf"), bytes);
            var pages = new ContractSigningPages();
            for (var page = 1; page <= pdf.GetNumberOfPages(); page++)
                await File.WriteAllBytesAsync(Path.Combine(qa, $"holding-template-{page}.png"), pages.RenderPage(bytes, page, 1100));
        }
        // Line wrapping in a formatted PDF may insert line breaks within a clause.
        var text = System.Text.RegularExpressions.Regex.Replace(ContractPdfRendererTests.Text(pdf), @"\s+", " ");
        Assert.Contains("HỢP ĐỒNG NHẬN TIỀN ĐẶT CỌC", text);
        Assert.Contains("000000000001", text);
        Assert.Contains("000000000002", text);
        Assert.Contains("P.102", text);
        Assert.Contains("2.300.000", text);
        Assert.Contains("cấn trừ vào tiền đặt cọc", text);
        Assert.Contains("Bên A vi phạm cam kết sẽ phải trả lại", text);
        Assert.Contains("Bên B vi phạm cam kết sẽ bị mất toàn bộ số tiền", text);
        Assert.DoesNotContain("Bên A đã nhận đủ", text);
        Assert.DoesNotContain("Tp. Hồ Chí Minh", text);
        var owner = Assert.IsType<SignaturePlacementInput>(ContractSignatureSlots.Read(bytes, true));
        var tenant = Assert.IsType<SignaturePlacementInput>(ContractSignatureSlots.Read(bytes, false));
        Assert.Equal(owner.Page, tenant.Page);
        Assert.True(owner.X + owner.Width < tenant.X);
        Assert.True(owner.Y < .85);
    }
}
