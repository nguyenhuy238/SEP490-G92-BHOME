using BHome.IntegrationTests.Contracts;

namespace BHome.IntegrationTests.Compact24;

// Exercise the deployed JSON document projections, not just the legacy EF tables.
[Trait("Category", "Docker")]
public sealed class MainDraftDocumentRegressionTests(PropertyContractDockerFixture fixture) : IClassFixture<PropertyContractDockerFixture>
{
    [Fact]
    public Task CurrentPdfSurvivesPersistenceAndOldPdfIsRejectedAfterDraftUpdate() =>
        new MainDraftApiTests(fixture.Contracts).ActualLibreOfficeConversionPersistsPrivatePdfWithVietnameseAndIssueDate();

    [Fact]
    public Task ConfigurationChangeRequiresExplicitSave() =>
        new MainDraftApiTests(fixture.Contracts).ConfigurationChangeBlocksGenerationUntilExplicitDraftSave();

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task MissingOrCorruptObjectsRecoverWithoutChangingTheDraft(bool corrupt) =>
        new MainDraftApiTests(fixture.Contracts).ExplicitGenerationReplacesMissingOrCorruptDraftFilesWithoutChangingTerms(corrupt);
}
