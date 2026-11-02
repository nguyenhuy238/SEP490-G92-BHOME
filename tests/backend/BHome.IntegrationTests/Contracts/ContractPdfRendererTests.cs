using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Infrastructure;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Contracts;

// Pure renderer tests: no database, storage, provider credentials or hosted services are used.
[Trait("Category", "Unit")]
public sealed class ContractPdfRendererTests
{
    internal const string TemplateId = "main-contract-development-v1";

    internal static ServiceProvider Backend(string? environment = "Testing", string? templateId = TemplateId, bool simulation = false)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ContractPdf:TemplateId"] = templateId,
            ["ContractWorkflow:SimulatedSigningEnabled"] = simulation.ToString()
        }).Build();
        var services = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(configuration);
        if (environment is not null) services.AddSingleton<IHostEnvironment>(new TestEnvironment(environment));
        services.AddInfrastructure(configuration);
        return services.BuildServiceProvider();
    }

    internal static ContractDocument Snapshot()
    {
        var representative = Guid.NewGuid();
        return Seal(new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), representative,
            [representative, Guid.NewGuid()], new(2026, 11, 1), new(2027, 11, 1), 3000000, 6000000,
            null, 0, "Dữ liệu kiểm thử: Nguyễn Ánh, Đặng Thị Hồng; tiền thuê và bảo đảm.\nDòng thứ hai: <b>văn bản thuần</b>.", ""));
    }

    // This is the pre-existing persisted snapshot format; tests must not silently adopt another serializer.
    internal static ContractDocument Seal(ContractDocument document) => document with
    {
        SnapshotHash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(document with { SnapshotHash = "" })))
    };

    internal static string Text(PdfDocument pdf) => string.Join("\n", Enumerable.Range(1, pdf.GetNumberOfPages())
        .Select(page => PdfTextExtractor.GetTextFromPage(pdf.GetPage(page))));

    [Theory]
    [InlineData("Development")]
    [InlineData("Testing")]
    public async Task PDF01_ExplicitDevelopmentTemplateRendersPersistedSnapshotAndVersion(string environment)
    {
        using var backend = Backend(environment);
        using var scope = backend.CreateScope();
        var input = Snapshot();
        var bytes = await scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>().RenderAsync(input, default);

        Assert.True(bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8));
        Assert.InRange(bytes.Length, 5, 10 * 1024 * 1024);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        Assert.True(pdf.GetNumberOfPages() >= 1);
        Assert.Equal(input.ContractId.ToString(), pdf.GetDocumentInfo().GetMoreInfo("BHomeContractId"));
        Assert.Equal(input.SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeSnapshotHash"));
        Assert.Equal(TemplateId, pdf.GetDocumentInfo().GetMoreInfo("BHomeTemplateId"));
        Assert.Equal("1", pdf.GetDocumentInfo().GetMoreInfo("BHomeTemplateVersion"));
        var text = Text(pdf);
        foreach (var id in new[] { input.ContractId, input.RoomId, input.OwnerSignerId, input.TenantUserId, input.RepresentativeResidentId }.Concat(input.ResidentIds))
            Assert.Contains(id.ToString(), text);
        Assert.Contains(input.SnapshotHash, text);
        Assert.Contains("01/11/2026", text);
        Assert.Contains("01/11/2027", text);
        Assert.Contains("3.000.000 VND", text);
        Assert.Contains("6.000.000 VND", text);
        Assert.Contains("CHƯA PHÊ DUYỆT", text);
        Assert.Empty(new iText.Signatures.SignatureUtil(pdf).GetSignatureNames());
    }

    [Fact]
    public async Task PDF05_VietnameseTextSurvivesExtractionAndFontIsEmbedded()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var bytes = await scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>().RenderAsync(Snapshot(), default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.Contains("Nguyễn Ánh, Đặng Thị Hồng", text);
        Assert.Contains("tiền thuê và bảo đảm", text);
        Assert.Contains("<b>văn bản thuần</b>", text);
        var fonts = pdf.GetPage(1).GetResources().GetResource(PdfName.Font);
        Assert.NotEmpty(fonts.KeySet());
        Assert.Contains(fonts.KeySet(), name =>
        {
            var font = fonts.GetAsDictionary(name);
            var descendant = font.GetAsArray(PdfName.DescendantFonts)?.GetAsDictionary(0);
            var descriptor = descendant?.GetAsDictionary(PdfName.FontDescriptor);
            return font.GetAsStream(PdfName.ToUnicode) is not null && descriptor?.GetAsStream(PdfName.FontFile2) is not null;
        });
    }

    [Theory]
    [InlineData("contract")]
    [InlineData("room")]
    [InlineData("same-signers")]
    [InlineData("residents")]
    [InlineData("duplicate-residents")]
    [InlineData("representative")]
    [InlineData("dates")]
    [InlineData("rent")]
    [InlineData("fractional-money")]
    [InlineData("deposit")]
    [InlineData("holding")]
    [InlineData("terms")]
    [InlineData("long-terms")]
    public async Task PDF02_InvalidRequiredSnapshotDataIsRejected(string invalid)
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var input = Snapshot();
        input = invalid switch
        {
            "contract" => input with { ContractId = Guid.Empty },
            "room" => input with { RoomId = Guid.Empty },
            "same-signers" => input with { TenantUserId = input.OwnerSignerId },
            "residents" => input with { ResidentIds = null! },
            "duplicate-residents" => input with { ResidentIds = [input.RepresentativeResidentId, input.RepresentativeResidentId] },
            "representative" => input with { RepresentativeResidentId = Guid.NewGuid() },
            "dates" => input with { EndDate = input.StartDate },
            "rent" => input with { MonthlyRent = 0 },
            "fractional-money" => input with { RequiredDeposit = 1.5m },
            "deposit" => input with { RequiredDeposit = -1 },
            "holding" => input with { AppliedHoldingDeposit = 1 },
            "terms" => input with { Terms = " " },
            "long-terms" => input with { Terms = new string('x', 12001) },
            _ => throw new InvalidOperationException()
        };
        var error = await Assert.ThrowsAsync<ContractException>(() => scope.ServiceProvider
            .GetRequiredService<IContractDocumentRenderer>().RenderAsync(Seal(input), default));
        Assert.Equal(400, error.Status);
        Assert.Equal("invalid_contract_document", error.Code);
        Assert.DoesNotContain("Nguyễn", error.Message);
    }

    [Theory]
    [InlineData(null, "contract_template_not_configured")]
    [InlineData("missing-v999", "contract_template_not_found")]
    public async Task PDF03_MissingTemplateCannotRenderSuccessfully(string? id, string code)
    {
        using var backend = Backend(templateId: id);
        using var scope = backend.CreateScope();
        var error = await Assert.ThrowsAsync<ContractException>(() => scope.ServiceProvider
            .GetRequiredService<IContractDocumentRenderer>().RenderAsync(Snapshot(), default));
        Assert.Equal(503, error.Status);
        Assert.Equal(code, error.Code);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Test")]
    [InlineData(null)]
    public async Task DevelopmentTemplateCannotBeUsedOutsideExplicitDevelopmentOrTesting(string? environment)
    {
        using var backend = Backend(environment);
        using var scope = backend.CreateScope();
        var error = await Assert.ThrowsAsync<ContractException>(() => scope.ServiceProvider
            .GetRequiredService<IContractDocumentRenderer>().RenderAsync(Snapshot(), default));
        Assert.Equal(503, error.Status);
        Assert.Equal("contract_template_not_approved", error.Code);
    }

    [Fact]
    public async Task PDF04_ChangedTermsOrOccupantsDoNotReplaceSealedDocument()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var renderer = scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>();
        var input = Snapshot();
        var original = await renderer.RenderAsync(input, default);
        var changed = input with { Terms = "Thay đổi chưa được sealed" };
        var error = await Assert.ThrowsAsync<ContractException>(() => renderer.RenderAsync(changed, default));
        Assert.Equal(409, error.Status);
        Assert.Equal("signed_terms_changed", error.Code);
        input.ResidentIds[1] = Guid.NewGuid();
        error = await Assert.ThrowsAsync<ContractException>(() => renderer.RenderAsync(input, default));
        Assert.Equal("signed_terms_changed", error.Code);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(original)));
        Assert.Equal(changed.SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeSnapshotHash"));
        Assert.DoesNotContain(changed.Terms, Text(pdf));
    }

    [Fact]
    public async Task LongTermsAndVerifiedHoldingFieldsAreRetainedAcrossPages()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var holdingId = Guid.NewGuid();
        var input = Seal(Snapshot() with
        {
            HoldingContractId = holdingId,
            AppliedHoldingDeposit = 1000000,
            Terms = string.Join('\n', Enumerable.Range(1, 140).Select(i => $"Dòng {i}: dữ liệu tổng hợp, không bổ sung điều khoản pháp lý."))
        });
        var bytes = await scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>().RenderAsync(input, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.True(pdf.GetNumberOfPages() > 1);
        Assert.Contains(holdingId.ToString(), text);
        Assert.Contains("1.000.000 VND", text);
        Assert.Contains("Dòng 140:", text);
    }

    [Fact]
    public async Task UnsupportedGlyphsAreRejectedRatherThanSilentlyOmitted()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var input = Seal(Snapshot() with { Terms = "Dữ liệu kiểm thử \U0001F680" });
        var error = await Assert.ThrowsAsync<ContractException>(() => scope.ServiceProvider
            .GetRequiredService<IContractDocumentRenderer>().RenderAsync(input, default));
        Assert.Equal("contract_document_unsupported_character", error.Code);
    }

    [Fact]
    public async Task CancelledRequestDoesNotProducePdf()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => scope.ServiceProvider
            .GetRequiredService<IContractDocumentRenderer>().RenderAsync(Snapshot(), cancelled.Token));
    }

    [Fact]
    public async Task ConcurrentRenderingDoesNotMixSnapshotsOrReusePdfFontObjectsAcrossDocuments()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var renderer = scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>();
        var snapshots = Enumerable.Range(0, 6).Select(_ => Snapshot()).ToArray();
        var outputs = await Task.WhenAll(snapshots.Select(input => Task.Run(async () => await renderer.RenderAsync(input, default))));
        for (var i = 0; i < snapshots.Length; i++)
        {
            using var pdf = new PdfDocument(new PdfReader(new MemoryStream(outputs[i])));
            Assert.Equal(snapshots[i].ContractId.ToString(), pdf.GetDocumentInfo().GetMoreInfo("BHomeContractId"));
            Assert.Equal(snapshots[i].SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeSnapshotHash"));
            var text = Text(pdf);
            Assert.Contains(snapshots[i].ContractId.ToString(), text);
            Assert.DoesNotContain(snapshots[(i + 1) % snapshots.Length].ContractId.ToString(), text);
        }
    }

    [Theory]
    [InlineData("../template")]
    [InlineData("file:///private.pdf")]
    public void InvalidTemplateConfigurationIsRejected(string id)
    {
        using var backend = Backend(templateId: id);
        var values = backend.GetRequiredService<IOptions<BHome.Infrastructure.Contracts.ContractPdfOptions>>();
        Assert.Throws<OptionsValidationException>(() => values.Value);
    }

    private sealed class TestEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "BHome.Renderer.Tests";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
