using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using Microsoft.Extensions.Configuration;
using iText.Kernel.Pdf;
using System.IO.Compression;
using System.Xml.Linq;

namespace BHome.IntegrationTests.Contracts;

public sealed class MainDocxTemplateTests
{
    [Fact]
    public async Task SuppliedDocxKeepsClausesFillsDatabaseFieldsAndSeparatesOwnerTenantSignatureSlots()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local"
        }).Build();
        var renderer = new MainDraftRenderer(configuration, TimeProvider.System, new TestEnvironment());
        Assert.True(renderer.SigningReviewAvailable);
        var c = new Contract
        {
            RoomId = Guid.NewGuid(),
            OwnerSignerId = Guid.NewGuid(),
            RepresentativeResidentId = Guid.NewGuid(),
            StartDate = new(2026, 11, 18),
            EndDate = new(2027, 11, 18),
            MonthlyRent = 2300000,
            RequiredDeposit = 2300000,
            Terms = "Nội quy kiểm thử\nThanh toán đúng hạn."
        };
        var settings = new MainContractSettings(c.OwnerSignerId, c.StartDate, null, "Chuyển khoản hàng tháng", "",
            new("CHỦ NHÀ KIỂM THỬ", new(1980, 1, 1), "000000000001", new(2020, 1, 1), "Cơ quan kiểm thử", "Địa chỉ Owner kiểm thử", "0900000000"), 1);
        var tenant = new IdentityConfirmation(true, "000000000002", "NGƯỜI THUÊ KIỂM THỬ", new(2000, 1, 1), "Địa chỉ Tenant kiểm thử", null, null, null, new(2021, 6, 15), null);
        var charges = new[] {
            new PolicyDto(Guid.NewGuid(),Guid.NewGuid(),c.RoomId,ChargeCategory.Rent,"RENT","Giá thuê",ChargingMethod.FixedPerRoomPerMonth,2300000,c.StartDate,null,1),
            new PolicyDto(Guid.NewGuid(),Guid.NewGuid(),c.RoomId,ChargeCategory.Electricity,"ELECTRICITY","Điện",ChargingMethod.Metered,3500,c.StartDate,null,1),
            new PolicyDto(Guid.NewGuid(),Guid.NewGuid(),c.RoomId,ChargeCategory.Water,"WATER","Nước",ChargingMethod.Metered,18000,c.StartDate,null,1)
        };
        var input = new MainDraftInput(c.RoomId, c.RepresentativeResidentId, [c.RepresentativeResidentId], c.StartDate, c.EndDate, "", "0911111111", "Cơ quan Tenant kiểm thử");
        var data = new MainDraftRenderData(c, new(input, charges, 1, "", renderer.TemplateHash), settings, tenant, "Cơ sở kiểm thử", "P.102", "Địa chỉ cơ sở kiểm thử", SigningReview: true);
        var docx = await renderer.DocxAsync(data, default);
        using (var archive = new ZipArchive(new MemoryStream(docx)))
        {
            using var stream = archive.GetEntry("word/document.xml")!.Open(); var xml = XDocument.Load(stream);
            XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            var text = string.Concat(xml.Descendants(w + "t").Select(n => n.Value));
            Assert.Contains("CHỦ NHÀ KIỂM THỬ", text); Assert.Contains("NGƯỜI THUÊ KIỂM THỬ", text);
            Assert.Contains("TRÁCH NHIỆM CHUNG", text); Assert.Contains("2.300.000", text); Assert.DoesNotContain("9.900.000", text);
            Assert.Contains("ĐẠI DIỆN BÊN B", text); Assert.Contains("ĐẠI DIỆN BÊN A", text);
            Assert.DoesNotContain("TÀI LIỆU KIỂM THỬ", text);
        }
        var bytes = await renderer.PdfAsync(docx, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var all = ContractPdfRendererTests.Text(pdf);
        Assert.Contains("HỢP ĐỒNG THUÊ PHÒNG TRỌ", all); Assert.Contains("TRÁCH NHIỆM CHUNG", all);
        Assert.DoesNotContain("TÀI LIỆU KIỂM THỬ", all);
        Assert.Contains("000000000001", all); Assert.Contains("000000000002", all); Assert.Contains("15/06/2021", all);
        Assert.DoesNotContain("MẪU HỢP ĐỒNG", all);
        var owner = ContractSignatureSlots.Read(bytes, true)!; var renter = ContractSignatureSlots.Read(bytes, false)!;
        Assert.NotNull(owner); Assert.NotNull(renter); Assert.Equal(owner.Page, renter.Page);
        Assert.True(renter.X + renter.Width < owner.X); Assert.True(owner.Y < .88);
        var conflict = Assert.Throws<ContractException>(() => ContractSignatureSlots.RequireSeparatePartyBoxes(bytes, renter, true, null));
        Assert.Equal("signature_placement_overlaps_other_party", conflict.Code);
        ContractSignatureSlots.RequireSeparatePartyBoxes(bytes, owner, true, null);
        var accepted = new InternalAcceptanceRenderer().Accept(bytes, [[new(.1, .1), new(.8, .8)]], c.RepresentativeResidentId, DateTimeOffset.UtcNow, "synthetic", true);
        var qa = Environment.GetEnvironmentVariable("BHOME_CONTRACT_QA_DIR");
        if (!string.IsNullOrWhiteSpace(qa))
        {
            Directory.CreateDirectory(qa);
            await File.WriteAllBytesAsync(Path.Combine(qa, "main-template.docx"), docx);
            await File.WriteAllBytesAsync(Path.Combine(qa, "main-template.pdf"), bytes);
            var pages = new ContractSigningPages();
            for (var page = 1; page <= pdf.GetNumberOfPages(); page++)
                await File.WriteAllBytesAsync(Path.Combine(qa, $"main-template-page-{page}.png"), pages.RenderPage(bytes, page, 1100));
            await File.WriteAllBytesAsync(Path.Combine(qa, "main-template-signatures.png"), pages.RenderPage(accepted.Pdf, owner.Page, 1100));
        }
    }

    private sealed class TestEnvironment : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "BHome.IntegrationTests";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
