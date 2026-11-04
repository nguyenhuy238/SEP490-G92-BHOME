using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24MigrationTests
{
    [CompactPostgresFact]
    public async Task CompleteCopyRollsBackIdentityAndBusinessRowsWhenLaterTargetWriteFails()
    {
        await using var pair = await Pair.Create(); await pair.Seed();
        var location = new Location("Synthetic rollback scope") { ChainId = await pair.Source.Set<Chain>().Select(c => c.Id).SingleAsync(), Address = "Synthetic address" };
        var type = new RoomType { LocationId = location.Id, Name = "Synthetic rollback type", DefaultCapacity = 1 };
        var room = new Room { LocationId = location.Id, RoomTypeId = type.Id, RoomNumber = "ROLLBACK-1", Capacity = 1, Status = RoomStatus.Available };
        pair.Source.AddRange(location, type, room); await pair.Source.SaveChangesAsync();
        await pair.Target.Database.ExecuteSqlRawAsync("""
            CREATE FUNCTION compact_test_fail_room() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Synthetic later target failure'; END $$;
            CREATE TRIGGER compact_test_fail_room BEFORE INSERT ON rooms FOR EACH ROW EXECUTE FUNCTION compact_test_fail_room();
            """);
        await Assert.ThrowsAsync<DbUpdateException>(() => new Compact24DataMigration(pair.Source, pair.Target).CopyAsync());
        pair.Target.ChangeTracker.Clear();
        Assert.Empty(await pair.Target.Users.ToArrayAsync()); Assert.Empty(await pair.Target.Locations.ToArrayAsync());
        Assert.Empty(await pair.Target.Set<Chain>().ToArrayAsync()); Assert.Empty(await pair.Target.Set<Room>().ToArrayAsync());
        Assert.Empty(await pair.Target.SecurityAudit.ToArrayAsync());
        Assert.Equal(1, await pair.Source.Users.CountAsync()); Assert.Equal(1, await pair.Source.Set<Room>().CountAsync());
    }

    [CompactPostgresFact]
    public async Task CompleteCopyBlocksNonemptyUnsupportedIdentityExtensionsWithoutLosingSourceData()
    {
        await using var pair = await Pair.Create(); var user = await pair.Seed();
        pair.Source.UserClaims.Add(new IdentityUserClaim<Guid> { UserId = user.Id, ClaimType = "synthetic-extension", ClaimValue = "synthetic-value" });
        await pair.Source.SaveChangesAsync();
        var migration = new Compact24DataMigration(pair.Source, pair.Target);
        Assert.Contains("identity_extension_behavior_requires_mapping_decision:AspNetUserClaims", (await migration.InspectAsync()).Blockers);
        Assert.Equal("source_preflight_failed", (await Assert.ThrowsAsync<Compact24MigrationException>(() => migration.CopyAsync())).Code);
        Assert.Empty(await pair.Target.Users.ToArrayAsync()); Assert.Equal(1, await pair.Source.UserClaims.CountAsync());
    }

    [CompactPostgresFact]
    public async Task OfflineCliInspectsAndCopiesAndRejectsLiveDatabaseNameBeforeConnecting()
    {
        await using var pair = await Pair.Create(); await pair.Seed();
        var location = new Location("Synthetic CLI scope") { ChainId = await pair.Source.Set<Chain>().Select(c => c.Id).SingleAsync(), Address = "Synthetic address" };
        pair.Source.Add(location); await pair.Source.SaveChangesAsync();
        var source = pair.Source.Database.GetConnectionString()!;
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(root.FullName, "src", "backend", "BHome.sln"))) root = root.Parent ?? throw new InvalidOperationException("Repository root unavailable.");
        var configuration = new DirectoryInfo(AppContext.BaseDirectory).Parent!.Name;
        var executable = Path.Combine(root.FullName, "tools", "BHome.Compact24Migration", "bin", configuration, "net8.0", "BHome.Compact24Migration.dll");
        var report = Path.Combine(Path.GetTempPath(), "bhome-compact24-cli-" + Guid.NewGuid().ToString("N") + ".json");
        async Task<(int Exit, JsonDocument Report)> Run(string action, string connection)
        {
            var start = new System.Diagnostics.ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(executable); start.ArgumentList.Add(action); start.ArgumentList.Add(report);
            start.Environment["BHOME_COMPACT24_SOURCE"] = connection; start.Environment["BHOME_COMPACT24_TARGET"] = pair.Fixture.Connection;
            using var process = System.Diagnostics.Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync(); await Task.WhenAll(output, error);
            return (process.ExitCode, JsonDocument.Parse(await File.ReadAllTextAsync(report)));
        }
        var inspected = await Run("--inspect", source);
        using (inspected.Report) { Assert.Equal(0, inspected.Exit); Assert.Equal("PREFLIGHT_READY", inspected.Report.RootElement.GetProperty("Status").GetString()); }
        var copied = await Run("--copy-all", source);
        using (copied.Report)
        {
            Assert.Equal(0, copied.Exit); Assert.Equal("DATA_COPIED_AND_RECONCILED", copied.Report.RootElement.GetProperty("Status").GetString());
            Assert.Equal(70, copied.Report.RootElement.GetProperty("DataMigration").GetProperty("Tables").GetArrayLength());
        }
        Assert.Equal(location.Id, (await pair.Target.Locations.SingleAsync()).Id);
        var forbidden = new NpgsqlConnectionStringBuilder(source) { Database = "bhome" };
        var rejected = await Run("--inspect", forbidden.ConnectionString);
        using (rejected.Report) { Assert.NotEqual(0, rejected.Exit); Assert.Equal("fixture_database_names_required", rejected.Report.RootElement.GetProperty("Code").GetString()); }
        File.Delete(report);
    }

    [CompactPostgresFact]
    public Task CompleteCopyPreservesContractSignaturesHandoverMoveOutAndSettlementHistory() => CopyWorkflow("ContractLifecycle", async capture =>
    {
        await using var contracts = new BHome.IntegrationTests.Contracts.ContractFixture(capture); await contracts.InitializeAsync();
        await new BHome.IntegrationTests.Contracts.ContractLifecycleApiTests(contracts).T10_T11_T12_T13_T14_InspectionFinalMetersPendingSettlementAndCompletedMoveOut();
    });

    [CompactPostgresFact]
    public Task CompleteCopyPreservesActualPdfSigningDirectoryAndDocumentEvidence() => CopyWorkflow("ActualPdfSigning", async capture =>
    {
        await using var contracts = new BHome.IntegrationTests.Contracts.ContractFixture(capture); await contracts.InitializeAsync();
        await new BHome.IntegrationTests.Contracts.ContractLifecycleApiTests(contracts).ProductionAdapterAndPdfSignerCompleteTwoPartyContractThroughApiWithSyntheticRemoteCa();
    });

    [CompactPostgresFact]
    public Task CompleteCopyPreservesStaffTaskCommandsEvidenceAndNotificationHistory() => CopyWorkflow("StaffOperations", capture =>
        new BHome.IntegrationTests.StaffOperations.OperationalTaskApiTests(capture).CompleteWorkflowPersistsPrivateEvidenceNotificationsReworkAndOwnerVerification(), async source =>
        {
            // Synthetic durable pending state, deliberately not a claim that its private object exists.
            source.Add(new BHome.Domain.StaffOperations.OperationalTaskFileUpload
            { TaskId = await source.Set<BHome.Domain.Billing.OperationalTask>().Select(t => t.Id).FirstAsync(), ObjectKey = "synthetic/pending-upload", CleanupAfter = DateTimeOffset.UtcNow.AddHours(1) });
            var owner = await source.UserRoles.Where(r => r.RoleId == Guid.Parse("00000000-0000-0000-0000-000000000001")).Select(r => r.UserId).SingleAsync();
            source.PasswordResetGrants.Add(new PasswordResetGrant { UserId = owner, TokenHash = new string('C', 64), ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5) });
            source.Add(new BHome.Infrastructure.Jobs.BackgroundJobRecord
            {
                Id = Guid.NewGuid(),
                Name = "synthetic-migration-job",
                IdempotencyKey = "synthetic-import-once",
                PayloadJson = "{}",
                State = "Processing",
                Attempts = 2,
                AvailableAt = DateTimeOffset.UtcNow.AddMinutes(-1),
                LockedUntil = DateTimeOffset.UtcNow.AddMinutes(1),
                LockToken = Guid.NewGuid(),
                LastErrorCode = "SyntheticRetry"
            });
            await source.SaveChangesAsync();
        });

    [CompactPostgresFact]
    public Task CompleteCopyPreservesAutomationQueuePlansAttemptsAndApprovedAdjustments() => CopyWorkflow("AutomationAndAdjustments", capture =>
        new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).DraftJobRequiresSharedRepresentativeAndPreservesApprovedCorrectionOnReplay());

    [CompactPostgresFact]
    public Task CompleteCopyPreservesNotificationDeliveryAttemptsAndReadState() => CopyWorkflow("NotificationDelivery", capture =>
        new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).DeliveryRetriesUseOneStableKeyAndPreservePaidLedgerAndInAppReadState());

    [CompactPostgresFact]
    public Task CompleteCopyPreservesOutboxPublicationsAndHistoricalRecipients() => CopyWorkflow("NotificationEvents", capture =>
        new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).InvoicePaymentAndAdjustmentEventsReachEntitledRecipientsWithoutPrivateDataOrReplayDuplicates());

    [CompactPostgresFact]
    public Task CompleteCopyPreservesAdjustmentEvidenceIncludingPrivateObjectKeys() => CopyWorkflow("AdjustmentEvidence", capture =>
        new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).AdjustmentEvidenceIsValidatedPrivateAndCannotBeReusedOrStolen());

    [CompactPostgresFact]
    public Task CompleteCopyPreservesContractExpiryNoticeHistory() => CopyWorkflow("ContractExpiry", capture =>
        new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).ExpiryJobDeduplicatesParallelRunsPreservesOccupancyAndScopesRecipients());

    [CompactPostgresFact]
    public Task CompleteCopyPreservesConfirmedHandoverAndFinalInspectionBaselines() => CopyWorkflow("HandoverAndInspection", async capture =>
    {
        await using var contracts = new BHome.IntegrationTests.Contracts.ContractFixture(capture); await contracts.InitializeAsync();
        await new BHome.IntegrationTests.Contracts.ContractLifecycleApiTests(contracts).MoveInHandoverRequiresScopedStaffRealReadingsEvidenceAndSameVersionConfirmations();
    });

    [CompactPostgresFact]
    public async Task CompleteCopyPreservesPropertyChangesAssetsAndReceivingAccountVersions()
    {
        await using var pair = await Pair.Create();
        using var sourceHost = new ApiFactory { ConnectionString = pair.Source.Database.GetConnectionString()! };
        var fixture = new AuthenticationDatabaseFixture(sourceHost);
        await new BHome.IntegrationTests.PropertyManagement.PropertyApiTests(fixture).FullConfigurationUpdatesRequireVersionsAndRetainActorAndSnapshots();
        var owner = await pair.Source.UserRoles.Where(r => r.RoleId == Guid.Parse("00000000-0000-0000-0000-000000000001")).Select(r => r.UserId).SingleAsync();
        pair.Source.Add(new BHome.Domain.PaymentsDebt.ReceivingBankAccount
        {
            LocationId = await pair.Source.Locations.Select(l => l.Id).FirstAsync(),
            BankIdentifier = "000000",
            AccountNumber = "0000000000",
            AccountHolder = "SYNTHETIC ACCOUNT",
            Enabled = false,
            IsDevelopmentDemo = true,
            Version = 1,
            ConfirmedByUserId = owner,
            ConfirmedAt = DateTimeOffset.UtcNow
        });
        await pair.Source.SaveChangesAsync();
        var result = await new Compact24DataMigration(pair.Source, pair.Target).CopyAsync();
        Assert.True(result.Committed); Assert.Equal(70, result.Tables.Count); Assert.All(result.Tables, table => Assert.True(table.KeysAndValuesMatch));
        await Compact24Evidence.WriteAsync("PropertyAndBankConfiguration", result);
    }

    [CompactPostgresFact]
    public Task CompleteCopyPreservesEncryptedIdentityAndMainDraftDocuments() => CopyWorkflow("EncryptedMainDraft", async capture =>
    {
        await using var contracts = new BHome.IntegrationTests.Contracts.ContractFixture(capture); await contracts.InitializeAsync();
        await new BHome.IntegrationTests.Contracts.MainDraftApiTests(contracts).VerifiedOnboardingCreatesDraftWithoutTenantAndPersistsDocxWhenPdfConverterMissing();
    });

    private static async Task CopyWorkflow(string scenarioName, Func<BHome.IntegrationTests.Ocr.CaptureFixture, Task> scenario, Func<BHomeDbContext, Task>? beforeCopy = null)
    {
        await using var pair = await Pair.Create();
        using var root = new ApiFactory { ConnectionString = pair.Source.Database.GetConnectionString()! };
        var storage = new Compact24WorkflowFixture.TestObjectStorage();
        await using var host = root.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["IdentityProtection:ActiveEncryptionVersion"] = "test",
                ["IdentityProtection:ActiveHmacVersion"] = "test",
                ["IdentityProtection:EncryptionKeys:test"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
                ["IdentityProtection:HmacKeys:test"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
            }));
            b.ConfigureServices(s =>
            {
                s.AddSingleton<BHome.Application.Storage.IObjectStorage>(storage);
                s.AddSingleton<SingleOwnerMigrationFixture>();
            });
        });
        await scenario(new BHome.IntegrationTests.Ocr.CaptureFixture(host, "http://private-storage-test.invalid"));
        if (beforeCopy is not null) await beforeCopy(pair.Source);
        var result = await new Compact24DataMigration(pair.Source, pair.Target).CopyAsync();
        Assert.True(result.Committed); Assert.True(result.SourceReadOnly); Assert.Equal(70, result.Tables.Count);
        Assert.All(result.Tables, table => { Assert.True(table.KeysAndValuesMatch); Assert.Equal(table.SourceRows, table.TargetRecords); });
        await Compact24Evidence.WriteAsync(scenarioName, result);
    }

    [CompactPostgresFact]
    public async Task CompleteCopyPreservesVerifiedBankReceiptsAllocationsClaimsAndHistory()
    {
        await using var pair = await Pair.Create();
        using var root = new ApiFactory { ConnectionString = pair.Source.Database.GetConnectionString()! };
        await using var host = root.WithWebHostBuilder(b => b.ConfigureServices(s =>
            s.AddSingleton<BHome.Application.Storage.IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage())));
        var capture = new BHome.IntegrationTests.Ocr.CaptureFixture(host, "http://private-storage-test.invalid");
        await new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).OwnerApiReconcilesPersistedInvoiceAndRejectsUnmatchedTransferWithHistory();
        var copied = await new Compact24DataMigration(pair.Source, pair.Target).CopyAsync();
        Assert.Equal(70, copied.Tables.Count); Assert.All(copied.Tables, row => Assert.True(row.KeysAndValuesMatch));
        Assert.Equal(await pair.Source.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().SumAsync(a => a.Amount),
            await pair.Target.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().SumAsync(a => a.Amount));
        Assert.Equal(await pair.Source.Set<BHome.Domain.PaymentsDebt.BankReferenceClaim>().CountAsync(),
            await pair.Target.Set<BHome.Domain.PaymentsDebt.BankReferenceClaim>().CountAsync());
        await Compact24Evidence.WriteAsync("VerifiedPayments", copied);
    }

    [CompactPostgresFact]
    public async Task CompleteCopyReconcilesSeventySourcesAfterLegacyInvoiceAndMeterWorkflow()
    {
        await using var pair = await Pair.Create();
        using var root = new ApiFactory { ConnectionString = pair.Source.Database.GetConnectionString()! };
        await using var host = root.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["IdentityProtection:ActiveEncryptionVersion"] = "test",
                ["IdentityProtection:ActiveHmacVersion"] = "test",
                ["IdentityProtection:EncryptionKeys:test"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
                ["IdentityProtection:HmacKeys:test"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
            }));
            b.ConfigureServices(s => s.AddSingleton<BHome.Application.Storage.IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage()));
        });
        var capture = new BHome.IntegrationTests.Ocr.CaptureFixture(host, "http://private-storage-test.invalid");
        await new BHome.IntegrationTests.Billing.InvoiceApiTests(capture).FinalizationRequiresReviewedConfirmedDataIsConcurrentSafeImmutableAndHistoricallyScoped();
        var copied = await new Compact24DataMigration(pair.Source, pair.Target).CopyAsync();
        Assert.True(copied.Committed); Assert.True(copied.SourceReadOnly); Assert.Equal(70, copied.Tables.Count);
        Assert.All(copied.Tables, row => { Assert.True(row.KeysAndValuesMatch); Assert.Equal(row.SourceRows, row.TargetRecords); });
        Assert.Equal(await pair.Source.Set<BHome.Domain.Billing.Invoice>().CountAsync(), await pair.Target.Set<BHome.Domain.Billing.Invoice>().CountAsync());
        Assert.Equal(await pair.Source.Set<BHome.Domain.Billing.MeterReading>().CountAsync(), await pair.Target.Set<BHome.Domain.Billing.MeterReading>().CountAsync());
        Assert.Equal(BHome.Domain.Billing.InvoiceStatus.Final, (await pair.Target.Set<BHome.Domain.Billing.Invoice>().SingleAsync()).Status);
        await Compact24Evidence.WriteAsync("InvoiceAndMeters", copied);
    }

    [CompactPostgresFact]
    public async Task IdentityCopyKeepsIdsHashesStampsSessionsTokensAndReadOnlySourceThenExistingLoginWorks()
    {
        await using var pair = await Pair.Create();
        var user = await pair.Seed();
        var now = DateTimeOffset.UtcNow; now = now.AddTicks(-(now.Ticks % 10));
        var session = new AuthenticationSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            SecurityStamp = user.SecurityStamp!,
            CreatedAt = now,
            LastActivityAt = now,
            ExpiresAt = now.AddDays(7),
            Device = "Synthetic device"
        };
        var refresh = new RefreshTokenRecord { Id = Guid.NewGuid(), SessionId = session.Id, TokenHash = new string('A', 64), CreatedAt = now, ExpiresAt = now.AddDays(2) };
        pair.Source.AuthenticationSessions.Add(session); pair.Source.RefreshTokens.Add(refresh);
        pair.Source.PasswordResetGrants.Add(new PasswordResetGrant { UserId = user.Id, TokenHash = new string('B', 64), ExpiresAt = now.AddMinutes(10) });
        await pair.Source.SaveChangesAsync();
        var auditCount = await pair.Source.SecurityAudit.CountAsync();
        var migration = new Compact24FixtureMigration(pair.Source, pair.Target);
        var plan = await migration.InspectAsync();
        Assert.Equal(70, plan.Tables.Count); Assert.Empty(plan.Blockers);
        var result = await migration.CopyIdentityFixtureAsync();
        Assert.True(result.Reconciled); Assert.Equal(1, result.Users); Assert.Equal(1, result.Sessions); Assert.Equal(1, result.Tokens); Assert.Equal(1, result.ResetGrants);
        Assert.Equal(auditCount, result.AuditEvents);
        Assert.Equal(auditCount, await pair.Source.SecurityAudit.CountAsync());
        var copied = await pair.Target.Users.SingleAsync();
        Assert.Equal(user.Id, copied.Id); Assert.Equal(user.PasswordHash, copied.PasswordHash); Assert.Equal(user.SecurityStamp, copied.SecurityStamp);
        Assert.Equal(refresh.TokenHash, (await pair.Target.Refresh.SingleAsync(x => x.Id == refresh.Id)).TokenHash);
        using var client = pair.Fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Pair.Password })).StatusCode);
        Assert.Equal(1, await pair.Source.AuthenticationSessions.CountAsync());
    }

    [CompactPostgresFact]
    public async Task UnsupportedBusinessRowsAreReportedAndPreventAllTargetWrites()
    {
        await using var pair = await Pair.Create(); await pair.Seed();
        var chain = await pair.Source.Set<Chain>().SingleAsync();
        pair.Source.Locations.Add(new Location("Synthetic scope") { ChainId = chain.Id, Address = "Synthetic address" });
        await pair.Source.SaveChangesAsync();
        var migration = new Compact24FixtureMigration(pair.Source, pair.Target);
        var plan = await migration.InspectAsync();
        Assert.Contains("unsupported_source_rows:Locations", plan.Blockers);
        await Assert.ThrowsAsync<Compact24MigrationException>(() => migration.CopyIdentityFixtureAsync());
        Assert.Empty(await pair.Target.Users.ToArrayAsync());
        Assert.Equal(1, await pair.Source.Locations.CountAsync());
    }

    [CompactPostgresFact]
    public async Task ConstraintFailureAfterUserInsertRollsBackWholeTargetCopy()
    {
        await using var pair = await Pair.Create(); var user = await pair.Seed();
        pair.Source.AuthenticationSessions.Add(new AuthenticationSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            SecurityStamp = user.SecurityStamp!,
            CreatedAt = DateTimeOffset.UtcNow,
            LastActivityAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1)
        });
        await pair.Source.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateException>(() => new Compact24FixtureMigration(pair.Source, pair.Target).CopyIdentityFixtureAsync());
        pair.Target.ChangeTracker.Clear();
        Assert.Empty(await pair.Target.Users.ToArrayAsync()); Assert.Equal(1, await pair.Source.Users.CountAsync());
    }

    [CompactPostgresFact]
    public async Task AmbiguousEmailAndDevelopmentDatabaseNamesFailClosed()
    {
        await using var pair = await Pair.Create(); var first = await pair.Seed();
        var duplicate = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = Guid.NewGuid().ToString(),
            NormalizedUserName = Guid.NewGuid().ToString(),
            Email = "synthetic-other@example.invalid",
            NormalizedEmail = first.NormalizedEmail,
            PasswordHash = first.PasswordHash,
            SecurityStamp = "synthetic-stamp",
            ConcurrencyStamp = "synthetic-version"
        };
        pair.Source.Users.Add(duplicate);
        pair.Source.UserRoles.Add(new IdentityUserRole<Guid> { UserId = duplicate.Id, RoleId = Guid.Parse("00000000-0000-0000-0000-000000000003") });
        await pair.Source.SaveChangesAsync();
        var rejected = await Assert.ThrowsAsync<Compact24MigrationException>(() => new Compact24FixtureMigration(pair.Source, pair.Target).CopyIdentityFixtureAsync());
        Assert.Equal("ambiguous_normalized_email", rejected.Code);
        Assert.Empty(await pair.Target.Users.ToArrayAsync());
        await using var forbidden = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql("Host=127.0.0.1;Database=bhome;Username=unconfigured").Options);
        await Assert.ThrowsAsync<Compact24MigrationException>(() => new Compact24FixtureMigration(forbidden, pair.Target).InspectAsync());
    }

    private sealed class Pair : IAsyncDisposable
    {
        public const string Password = "Synthetic!Password-493";
        private string admin = "";
        private string sourceName = "";
        public Compact24Fixture Fixture { get; } = new();
        public BHomeDbContext Source { get; private set; } = null!;
        public Compact24DbContext Target { get; private set; } = null!;
        public static async Task<Pair> Create()
        {
            var pair = new Pair { admin = Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")! };
            try
            {
                await pair.Fixture.InitializeAsync();
                var settings = new NpgsqlConnectionStringBuilder(pair.admin);
                pair.sourceName = "bhome_compact24_source_" + Guid.NewGuid().ToString("N");
                await using (var c = new NpgsqlConnection(pair.admin))
                {
                    await c.OpenAsync(); await using var command = new NpgsqlCommand($"CREATE DATABASE \"{pair.sourceName}\"", c); await command.ExecuteNonQueryAsync();
                }
                settings.Database = pair.sourceName;
                pair.Source = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(settings.ConnectionString).Options);
                await pair.Source.Database.MigrateAsync();
                pair.Target = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(pair.Fixture.Connection).Options);
                return pair;
            }
            catch { await pair.DisposeAsync(); throw; }
        }
        public async Task<ApplicationUser> Seed()
        {
            var id = Guid.NewGuid(); var user = new ApplicationUser
            {
                Id = id,
                UserName = id.ToString(),
                NormalizedUserName = id.ToString().ToUpperInvariant(),
                Email = $"{id:N}@example.invalid",
                NormalizedEmail = $"{id:N}@example.invalid".ToUpperInvariant(),
                EmailConfirmed = true,
                SecurityStamp = Guid.NewGuid().ToString(),
                ConcurrencyStamp = Guid.NewGuid().ToString(),
                LockoutEnabled = true
            };
            user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, Password);
            Source.Users.Add(user); Source.UserRoles.Add(new IdentityUserRole<Guid> { UserId = id, RoleId = Guid.Parse("00000000-0000-0000-0000-000000000001") });
            await Source.SaveChangesAsync(); return user;
        }
        public async ValueTask DisposeAsync()
        {
            try { if (Source is not null) await Source.DisposeAsync(); if (Target is not null) await Target.DisposeAsync(); await Fixture.DisposeAsync(); }
            finally
            {
                if (System.Text.RegularExpressions.Regex.IsMatch(sourceName, "^bhome_compact24_source_[a-f0-9]{32}$"))
                {
                    await using var c = new NpgsqlConnection(admin); await c.OpenAsync();
                    await using var command = new NpgsqlCommand($"DROP DATABASE \"{sourceName}\" WITH (FORCE)", c); await command.ExecuteNonQueryAsync();
                }
            }
        }
    }
}
