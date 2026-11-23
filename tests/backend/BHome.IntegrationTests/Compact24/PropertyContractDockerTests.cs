using BHome.Application.Storage;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.Contracts;
using BHome.IntegrationTests.Ocr;
using BHome.IntegrationTests.PropertyManagement;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using System.Security.Cryptography;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests.Compact24;

// Always a disposable PostgreSQL 16 container; never reads a developer database connection.
public sealed class PropertyContractDockerFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private ApiFactory api = null!;
    private WebApplicationFactory<Program> host = null!;
    internal ContractFixture Contracts { get; private set; } = null!;
    internal AuthenticationDatabaseFixture Properties { get; private set; } = null!;
    internal CaptureFixture Capture { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await database.StartAsync();
        await using var connection = new NpgsqlConnection(database.GetConnectionString());
        await connection.OpenAsync();
        await using var schema = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
        using var reader = new StreamReader(schema);
        await using var command = new NpgsqlCommand(await reader.ReadToEndAsync(), connection);
        await command.ExecuteNonQueryAsync();
        await using var paymentCodeUpgrade = typeof(Compact24DbContext).Assembly
            .GetManifestResourceStream("BHome.Compact24.SettlementSePayCodes.sql")!;
        using var paymentCodeReader = new StreamReader(paymentCodeUpgrade);
        await using var paymentCodeCommand = new NpgsqlCommand(await paymentCodeReader.ReadToEndAsync(), connection);
        await paymentCodeCommand.ExecuteNonQueryAsync();
        var encryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var hmacKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var storage = new Compact24WorkflowFixture.TestObjectStorage();
        api = new ApiFactory
        {
            ConnectionString = database.GetConnectionString(),
            UseCompact24 = true,
            ConfigureTestHost = b =>
            {
                b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["IdentityProtection:ActiveEncryptionVersion"] = "test",
                    ["IdentityProtection:ActiveHmacVersion"] = "test",
                    ["IdentityProtection:EncryptionKeys:test"] = encryptionKey,
                    ["IdentityProtection:HmacKeys:test"] = hmacKey
                }));
                b.ConfigureServices(s => { s.RemoveAll<IHostedService>(); s.AddSingleton<IObjectStorage>(storage); });
            }
        };
        Properties = new AuthenticationDatabaseFixture(api);
        host = api;
        Capture = new CaptureFixture(host, "http://private-storage-test.invalid");
        Contracts = new ContractFixture(Capture);
        await Contracts.InitializeAsync();
    }
    public async Task DisposeAsync()
    {
        if (Contracts is not null) await Contracts.DisposeAsync();
        if (api is not null) await api.DisposeAsync();
        await database.DisposeAsync();
    }
}

[Trait("Category", "Docker")]
public sealed class PropertyContractDockerTests(PropertyContractDockerFixture fixture) : IClassFixture<PropertyContractDockerFixture>
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public Task ActivationHandoverTask(bool assigned) => new ContractLifecycleApiTests(fixture.Contracts).ActivationCreatesOneMoveInTaskWithoutDependingOnAvailableStaff(assigned);
    [Fact]
    public Task ReusedMeterMoveInRequiresCurrentContractBaseline() =>
        new ContractLifecycleApiTests(fixture.Contracts).ReusedMetersRequireFreshContractInitialReadingsBeforeMoveInHandover();
    [Fact] public Task MixedStaffContractList() => new ContractLifecycleApiTests(fixture.Contracts).StaffListIncludesHoldingAndMainWithTypeSpecificFieldsAndPreservesLocationScope();
    [Fact] public Task HoldingLocationConfiguration() => new ContractLifecycleApiTests(fixture.Contracts).HoldingSettingsAreLocationScopedVersionedAndDoNotRewriteCreatedContracts();
    [Fact] public Task AssetConfigurationHistory() => new PropertyApiTests(fixture.Properties).FullConfigurationUpdatesRequireVersionsAndRetainActorAndSnapshots();
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task HoldingAllocation(bool depositFirst) => new ContractLifecycleApiTests(fixture.Contracts).HoldingAllocationIsPersistedOnceAndCannotFundTwoMainContracts(depositFirst);
    [Fact] public Task DebtNotifications() => new PaymentsDebt.PaymentLedgerTests(fixture.Capture).DebtRemindersDeduplicateAndStopAfterVerifiedPayment();
    [Fact] public Task PartialAndPaidNotifications() => new PaymentsDebt.PaymentLedgerTests(fixture.Capture).DelayedNotificationWorkerPreservesPartialSnapshotAndOnePaidTransitionForAllThreeTenants();
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task PropertyContractRace(bool termination) =>
        new ContractLifecycleApiTests(fixture.Contracts).PropertyMutationRacesWithContractTransition(termination);
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task Obligations(bool paymentOnly) => new ContractLifecycleApiTests(fixture.Contracts).PropertyObligationsDistinguishDraftSignedAndActive(paymentOnly);
    [Fact] public Task RemainingContract() => new ContractLifecycleApiTests(fixture.Contracts).RemainingContractKeepsRoomOccupiedWithoutVersionBump();
    [Fact] public Task StaffScope() => new PropertyApiTests(fixture.Properties).StaffReadsOnlyCurrentAssignmentsBeforeCountingAndCannotMutate();
    [Fact] public Task InvalidManualStates() => new PropertyApiTests(fixture.Properties).InvalidScopesReservedStatesAndDeactivationAreRejected();
    [Fact] public Task ResidentAndCapture() => new PropertyApiTests(fixture.Properties).ExistingResidentsBlockClosureAndCaptureCannotBypassUnavailableRoom();
    [Fact] public Task AuditRollback() => new PropertyApiTests(fixture.Properties).DuplicateRoomAndPolicyRacesHaveOneWinnerAndNoOrphanAudit();
    [Fact] public Task InvoiceSnapshot() => new Billing.InvoiceApiTests(fixture.Capture).SharedRoomDraftIsPersistedIdempotentScopedAndExplicitlyMissingReadings();
    [Fact] public Task RoomInsights() => new PropertyApiTests(fixture.Properties).RoomInsightsAreReadOnlyScopedAndUseCompact24AuditDates();
    [Theory]
    [InlineData(3500000, "Payable", 500000)]
    [InlineData(2800000, "RefundEligible", 200000)]
    [InlineData(3000000, "Settled", 0)]
    public Task MoveOutProposalNetDepositSePay(int proposedFee, string expectedStatus, int expectedAmount) =>
        new ContractLifecycleApiTests(fixture.Contracts).TenantAcceptedVerifiedMoveOutQuotePostsOnlyNetMoneyAndSePaySettlesOnce(
            proposedFee, expectedStatus, expectedAmount);
    [Fact]
    public Task MoveOutAlreadyAcceptedReconcilesWithoutSecondConsent() =>
        new ContractLifecycleApiTests(fixture.Contracts).TenantAcceptedVerifiedMoveOutQuotePostsOnlyNetMoneyAndSePaySettlesOnce(
            3500000, "Payable", 500000, recoverPreviousConsent: true);
}
