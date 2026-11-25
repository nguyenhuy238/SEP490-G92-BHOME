using System.Globalization;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.Extensions.DependencyInjection;
using SkiaSharp;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Unit")]
public sealed class HandoverPdfRendererTests
{
    [Fact]
    public async Task OwnersRealInkAppearsInCryptographicallySignedHandoverWithoutEmbeddingInspectionPhotos()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var source = new HandoverDraftView(4, "PendingOwnerReview", Guid.NewGuid(), "B101",
            "Cơ sở thử nghiệm", "Địa chỉ thử nghiệm", new(2026, 11, 20), new(2027, 11, 20),
            3500000, 3500000, "Điều khoản thử nghiệm", null, null, [],
            "Phòng được kiểm tra đạt", "2 chìa", "", [], null, true, null, null, [], [],
            RoomChecks: HandoverRoomChecklist.RequiredCodes.Select(code =>
                new HandoverRoomCheck(code, "Passed", "Ghi chú cũ: khóa cửa hỏng", [])).ToArray(),
            AccessItems: [new HandoverAccessItem("RoomKey", 2, "")],
            InspectedAssets: []);
        var renderer = scope.ServiceProvider.GetRequiredService<IHandoverDraftPdfRenderer>();
        var plainPdf = await renderer.RenderSigningAsync(source, [], default);
        var ink = scope.ServiceProvider.GetRequiredService<IHandoverSignatureInkRenderer>()
            .Render(new HandoverInkInput(360, 150,
                [[[20, 100], [60, 40], [90, 110], [130, 50]],
                  [[150, 90], [200, 60], [260, 95], [320, 70]]]));
        int page;
        double x, y, width;
        using (var document = new PdfDocument(new PdfReader(new MemoryStream(plainPdf))))
        {
            var slot = document.GetDocumentInfo().GetMoreInfo("BHomeSignatureSlotOwner")!.Split(';');
            page = int.Parse(slot[0], CultureInfo.InvariantCulture);
            x = double.Parse(slot[1], CultureInfo.InvariantCulture);
            y = double.Parse(slot[2], CultureInfo.InvariantCulture);
            width = double.Parse(slot[3], CultureInfo.InvariantCulture);
            NoEmbeddedPhotos(document);
        }
        using var key = RSA.Create(2048);
        using var certificate = new CertificateRequest("CN=Synthetic Owner", key,
            HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1).CreateSelfSigned(
                DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        var pdfSigner = scope.ServiceProvider.GetRequiredService<IPdfSigner>();
        var prepared = pdfSigner.Prepare(plainPdf, [certificate], DateTimeOffset.UtcNow,
            new VisibleSignature(page, x, y, width, "Ký điện tử bởi: Chủ nhà tổng hợp", ink,
                CaptionUnderImage: true));
        var signed = pdfSigner.Complete(prepared.PreparedPdf, prepared.FieldName,
            prepared.DocumentDigest, [certificate],
            key.SignHash(prepared.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        using var verified = new PdfDocument(new PdfReader(new MemoryStream(signed)));
        var signatures = new SignatureUtil(verified);
        Assert.Single(signatures.GetSignatureNames());
        Assert.True(signatures.SignatureCoversWholeDocument(prepared.FieldName));
        Assert.True(signatures.ReadSignatureData(prepared.FieldName)
            .VerifySignatureIntegrityAndAuthenticity());
        Assert.Contains(Enumerable.Range(1, verified.GetNumberOfPdfObjects()),
            n => verified.GetPdfObject(n) is PdfStream stream &&
                 PdfName.Image.Equals(stream.GetAsName(PdfName.Subtype)));
        Assert.DoesNotContain("PHỤ LỤC BẰNG CHỨNG", ContractPdfRendererTests.Text(verified));
        Assert.Contains("Ghi chú cũ: khóa cửa hỏng", ContractPdfRendererTests.Text(verified));
    }

    private static void NoEmbeddedPhotos(PdfDocument pdf)
    {
        for (var page = 1; page <= pdf.GetNumberOfPages(); page++)
        {
            var xObjects = pdf.GetPage(page).GetResources().GetResource(PdfName.XObject);
            Assert.True(xObjects is null || xObjects.Size() == 0,
                $"Page {page} must not embed photographic evidence in the handover PDF");
        }
    }

    [Fact]
    public async Task MoveInOwnerSigningSourceIsConciseHasNoEmbeddedEvidenceRoundsMetersAndKeepsBothSignatureBoxes()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var meter = new HandoverReading(Guid.NewGuid(), "SYN-1", 0, new DateOnly(2026, 11, 20),
            1234.75m, Guid.NewGuid(), "private-evidence", new string('A', 64));
        var draft = new HandoverDraftView(5, "PendingOwnerReview", Guid.NewGuid(), "A101",
            "Cơ sở thử nghiệm", "Địa chỉ thử nghiệm", new DateOnly(2026, 11, 20),
            new DateOnly(2027, 11, 20), 3500000, 3500000, "Hợp đồng thử nghiệm",
            meter, meter with { UtilityType = 1, Value = 98.25m }, [], "Tường và sàn tốt", "2 chìa",
            "Staff đã kiểm tra", [], null, true, null, null, [], [],
            RoomChecks: HandoverRoomChecklist.RequiredCodes.Select((code, index) =>
                new HandoverRoomCheck(code, index == 0 ? "Issue" : "Passed",
                    index == 0 ? "Tường có vết nứt cần sửa" : "Đã kiểm tra và đạt, không in vào PDF", [])).ToArray(),
            AccessItems: [new HandoverAccessItem("RoomKey", 2, "Đã kiểm đếm")],
            OwnerReadyReason: "Đồng ý bàn giao",
            OwnerHandlingPlan: "Không có ngoại lệ cần xử lý",
            StaffSubmittedBy: Guid.NewGuid(),
            StaffSubmittedAt: new DateTimeOffset(2026, 11, 20, 5, 30, 0, TimeSpan.Zero),
            ReinspectionHistory: [new HandoverReinspectionRecord(4,
                "Kiểm tra lại cửa", Guid.NewGuid(), DateTimeOffset.UtcNow,
                [new HandoverReinspectionItem("RoomCheck", "doors_windows_locks")])]);
        using var bitmap = new SKBitmap(120, 80);
        bitmap.Erase(SKColors.LightBlue);
        using var image = SKImage.FromBitmap(bitmap);
        using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        var photo = new HandoverDocumentPhoto(Guid.NewGuid(),
            "Ảnh hiện trạng · SHA256 " + new string('B', 64), png.ToArray());
        var template = scope.ServiceProvider.GetRequiredService<IHandoverDraftPdfRenderer>();

        var named = draft with { OwnerName = "Chủ nhà mẫu", TenantName = "Người thuê mẫu" };
        var draftPdf = await template.RenderDraftAsync(named, default);
        var signingPdf = await template.RenderSigningAsync(named, [photo], default);
        using var preview = new PdfDocument(new PdfReader(new MemoryStream(draftPdf)));
        using var signing = new PdfDocument(new PdfReader(new MemoryStream(signingPdf)));
        var content = ContractPdfRendererTests.Text(signing);
        Assert.Contains("BẢN NHÁP", ContractPdfRendererTests.Text(preview));
        Assert.DoesNotContain("BẢN NHÁP", content);
        Assert.Contains("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", content);
        Assert.Contains("Độc lập - Tự do - Hạnh phúc", content);
        Assert.Contains("BIÊN BẢN BÀN GIAO PHÒNG Ở", content);
        Assert.Contains("Bên giao (Chủ nhà): Chủ nhà mẫu", content);
        Assert.Contains("Bên nhận (Người thuê): Người thuê mẫu", content);
        Assert.Contains("Cơ sở: Cơ sở thử nghiệm", content);
        Assert.Contains("Phòng: A101", content);
        Assert.Contains("Giá thuê: 3.500.000 đ/tháng", content);
        Assert.Contains("Tiền cọc: 3.500.000 đ", content);
        Assert.Contains("Ngày lập/ghi nhận kiểm tra: 20/11/2026 12:30", content);
        Assert.Contains("Trạng thái: Cần xử lý", content);
        Assert.Contains("Lý do / ghi chú: Tường có vết nứt cần sửa", content);
        Assert.Contains("Đã kiểm tra và đạt, không in vào PDF", content);
        Assert.Contains("Đã kiểm tra và đạt, không in vào PDF", ContractPdfRendererTests.Text(preview));
        Assert.DoesNotContain("PendingOwnerReview", content);
        Assert.DoesNotContain("Chưa duyệt", content);
        Assert.DoesNotContain("Chưa xác nhận", content);
        Assert.Contains("XÁC NHẬN CỦA CÁC BÊN", content);
        Assert.Contains("BÊN GIAO (CHỦ NHÀ)", content);
        Assert.Contains("BÊN NHẬN (NGƯỜI THUÊ)", content);
        Assert.Contains("Staff đã kiểm tra", content);
        Assert.Contains("Kiểm tra lại cửa", content);
        Assert.Contains("1.234", content);
        Assert.DoesNotContain("1.234,75", content);
        Assert.DoesNotContain("98,25", content);
        Assert.DoesNotContain("PHỤ LỤC BẰNG CHỨNG", content);
        Assert.DoesNotContain("Ảnh và bằng chứng được lưu riêng trên BHOME", content);
        Assert.DoesNotContain("Bản nháp tham khảo", ContractPdfRendererTests.Text(preview));
        Assert.DoesNotContain("Ảnh hiện trạng · SHA256", content);
        Assert.DoesNotContain(new string('B', 64), content);
        NoEmbeddedPhotos(preview);
        NoEmbeddedPhotos(signing);
        Assert.Contains("Đồng ý bàn giao", content);
        Assert.Equal(signing.GetNumberOfPages(),
            int.Parse(signing.GetDocumentInfo().GetMoreInfo("BHomeSignatureSlotOwner")!.Split(';')[0]));
        Assert.NotNull(signing.GetDocumentInfo().GetMoreInfo("BHomeSignatureSlotTenant"));
        Assert.Empty(new iText.Signatures.SignatureUtil(signing).GetSignatureNames());
    }

    [Fact]
    public async Task CompletedCanonicalInventoryOverridesStaleUncheckedDraftAndShowsActualInspection()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var inventoryId = Guid.NewGuid();
        var asset = new HandoverAsset(inventoryId, "Ghế kiểm kê", "Tốt", "Chưa ghi",
            ConfiguredQuantity: 4, ObservedQuantity: null, Checked: false);
        var draft = new HandoverDraftView(3, "PendingOwnerReview", Guid.NewGuid(), "A102",
            "Cơ sở A", "Địa chỉ A", new(2026, 11, 20), new(2027, 11, 20),
            3000000, 3000000, "Điều khoản", null, null, [asset], "Đã kiểm tra", "",
            "", [], null, false, null, null, [], [],
            InspectedAssets: [new HandoverInspectedAsset(inventoryId, "Ghế kiểm kê", 4, 3,
                "Missing", "Thiếu một ghế trong phòng")]);
        var bytes = await scope.ServiceProvider.GetRequiredService<IHandoverDraftPdfRenderer>()
            .RenderDraftAsync(draft, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var content = ContractPdfRendererTests.Text(pdf);
        Assert.Contains("Thực tế kiểm kê", content);
        Assert.Contains("Ghế kiểm kê", content);
        Assert.Contains("Trạng thái: Cần xử lý", content);
        Assert.Contains("Lý do / ghi chú: Thiếu tài sản", content);
        Assert.Contains("Thiếu một ghế trong phòng", string.Join(" ", content.Split((char[]?)null,
            StringSplitOptions.RemoveEmptyEntries)));
        Assert.DoesNotContain("Chưa kiểm kê", content);
        NoEmbeddedPhotos(pdf);
    }

    [Fact]
    public async Task CompletedCanonicalEmptyInventoryDoesNotShowIncompleteState()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var draft = new HandoverDraftView(2, "PendingOwnerReview", Guid.NewGuid(), "C103",
            "Cơ sở C", "Địa chỉ C", new(2026, 11, 20), new(2027, 11, 20),
            2500000, 2500000, "Điều khoản", null, null, [], "Đã kiểm tra", "",
            "", [], null, false, null, null, [], [], InspectedAssets: []);
        var bytes = await scope.ServiceProvider.GetRequiredService<IHandoverDraftPdfRenderer>()
            .RenderDraftAsync(draft, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var content = ContractPdfRendererTests.Text(pdf);
        Assert.Contains("Đã hoàn thành kiểm kê", content);
        Assert.DoesNotContain("Chưa có kiểm kê", content);
        Assert.Contains("Ngày lập/ghi nhận kiểm tra: Chưa xác định", content);
    }

    [Fact]
    public async Task LatestStaffReinspectionOverridesPriorCanonicalAssetObservation()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var inventoryId = Guid.NewGuid();
        var updated = new HandoverAsset(inventoryId, "Bàn học", "Tốt", "Tốt",
            ConfiguredQuantity: 2, ObservedQuantity: 2, Checked: true,
            Notes: "Đã kiểm tra lại đủ hai bàn");
        var draft = new HandoverDraftView(8, "PendingOwnerReview", Guid.NewGuid(), "B201",
            "Cơ sở B", "Địa chỉ B", new(2026, 11, 20), new(2027, 11, 20),
            3100000, 3100000, "Điều khoản", null, null, [updated], "Đã kiểm tra", "",
            "", [], null, false, null, null, [], [],
            ReinspectionItems: [new HandoverReinspectionItem("Asset", AssetId: inventoryId,
                Rechecked: true)],
            InspectedAssets: [new HandoverInspectedAsset(inventoryId, "Bàn học", 2, 1,
                "Missing", "Trước kiểm tra lại còn thiếu")]);
        var bytes = await scope.ServiceProvider.GetRequiredService<IHandoverDraftPdfRenderer>()
            .RenderDraftAsync(draft, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var content = ContractPdfRendererTests.Text(pdf);
        // Staff notes on a passing reinspection are retained in the PDF.
        Assert.Contains("Đã kiểm tra lại đủ hai bàn", content);
        Assert.DoesNotContain("Trước kiểm tra lại còn thiếu", content);
        Assert.DoesNotContain("Chưa kiểm kê", content);
    }

    [Theory]
    [InlineData("MoveIn")]
    [InlineData("MoveOut")]
    [InlineData("AssetChange")]
    public async Task VietnameseMultiPageReportHasVersionQuantitiesAndNoDigitalSignatureOrRejectsMoveOut(string type)
    {
        using var backend = ContractPdfRendererTests.Backend(); using var scope = backend.CreateScope();
        var reading = new HandoverReading(Guid.NewGuid(), "E-SYN", 0, new(2026, 11, 16), 124.7m, Guid.NewGuid(), "private", "hash");
        var assets = Enumerable.Range(1, 60).Select(i => new HandoverAsset(Guid.NewGuid(), $"Nhóm ghế {i}", "Tốt", "Đã kiểm tra: Nguyễn Ánh, Đặng Thị Hồng",
            ConfiguredQuantity: 4, Unit: "cái", ObservedQuantity: 3, HandedOverQuantity: 3, GoodQuantity: 2, WornQuantity: 1, DamagedQuantity: 0, MissingQuantity: 1)).ToArray();
        var snapshot = new HandoverSnapshot(new(2026, 11, 16), "S101", "Tường, sàn, cửa đã kiểm tra", "Hai chìa khóa", "Ghi chú tổng hợp", assets, reading, reading with { UtilityType = 1 }, [],
            MissingBaselineReason: type == "MoveOut" ? "Hợp đồng cũ không có baseline" : null, OtherTenantsRemain: type == "MoveOut",
            RoomChecks: type == "MoveIn" ?
            [
                new HandoverRoomCheck("doors_windows_locks", "Passed", "Ghi chú cũ trên biên bản đã ký", []),
                new HandoverRoomCheck("walls_ceiling_floor", "Issue", "Tường có vết nứt cũ", [])
            ] : null);
        using var bitmap = new SKBitmap(80, 80);
        bitmap.Erase(SKColors.Red);
        using var skImage = SKImage.FromBitmap(bitmap);
        using var png = skImage.Encode(SKEncodedImageFormat.Png, 100);
        var report = new HandoverDocumentReport(Guid.NewGuid(), Guid.NewGuid(), type, 3, "Cơ sở thử nghiệm", "Địa chỉ tổng hợp", Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow, snapshot, null, [], ["Owner chấp thuận ngoại lệ có bằng chứng"],
            [new HandoverDocumentPhoto(Guid.NewGuid(), "Ảnh bí mật không nhúng", png.ToArray())]);
        var renderer = scope.ServiceProvider.GetRequiredService<IHandoverDocumentRenderer>();
        if (type == "MoveOut")
        {
            // Move-out is saved as a private inspection snapshot, not a newly generated
            // or signed PDF. Only archived historic MoveOut PDFs remain downloadable.
            var error = await Assert.ThrowsAsync<ContractException>(() => renderer.RenderAsync(report, default));
            Assert.Equal("move_out_pdf_not_supported", error.Code);
            return;
        }
        var bytes = await renderer.RenderAsync(report, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        Assert.True(pdf.GetNumberOfPages() > 2); Assert.Equal("3", pdf.GetDocumentInfo().GetMoreInfo("BHomeVersion"));
        var text = ContractPdfRendererTests.Text(pdf);
        Assert.Contains("Nguyễn Ánh, Đặng Thị Hồng", text); Assert.Contains("Nhóm ghế 60", text); Assert.Contains("Trang 1/", text);
        if (type != "AssetChange") Assert.Contains("124", text);
        Assert.DoesNotContain("124,7", text);
        Assert.DoesNotContain("Ảnh bí mật không nhúng", text);
        Assert.DoesNotContain("PHỤ LỤC BẰNG CHỨNG", text);
        if (type == "MoveIn")
        {
            Assert.Contains("Ghi chú cũ trên biên bản đã ký", text);
            Assert.Contains("Lý do / ghi chú: Tường có vết nứt cũ", text);
        }
        NoEmbeddedPhotos(pdf);
        Assert.Contains("không phải chữ ký số", text); Assert.Empty(new iText.Signatures.SignatureUtil(pdf).GetSignatureNames());
    }
}
