using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.PaymentsDebt;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

public sealed class CompactBrowserFactAttribute : FactAttribute
{
    public CompactBrowserFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("BHOME_RUN_BROWSER_E2E") != "true" ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")))
            Skip = "Opt in with BHOME_RUN_BROWSER_E2E=true and an authorized disposable PostgreSQL admin; Node 22 and an installed browser are required.";
    }
}

public sealed class DepositAgreementBrowserTests
{
    [CompactBrowserFact]
    public async Task OwnerBrowserCompletesAgreedRecipientRefundThroughRealApiAndPersistence()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var scenario = await new PaymentLedgerTests(fixture.Capture).PrepareDepositAgreementBrowserAsync();
            var root = FindRepository(); var directory = Path.Combine(root, ".tools", "browser-deposit-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var port = LoopbackBrowserApiBridge.AvailablePort(); var webPort = LoopbackBrowserApiBridge.AvailablePort();
            Assert.NotEqual(port, webPort);
            var apiUrl = $"http://127.0.0.1:{port}"; var webUrl = $"http://127.0.0.1:{webPort}";
            using var host = fixture.Capture.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cors:AllowedOrigins:0"] = webUrl,
                ["AuthWeb:AllowedOrigins:0"] = webUrl,
                ["Api:UseHttpsRedirection"] = "false"
            })));
            await using var bridge = new LoopbackBrowserApiBridge(host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }), port);
            var configPath = Path.Combine(directory, "fixture.json");
            var evidence = Path.Combine(directory, "synthetic-proof.png");
            using (var image = new OpenCvSharp.Mat(40, 100, OpenCvSharp.MatType.CV_8UC3, OpenCvSharp.Scalar.White))
                await File.WriteAllBytesAsync(evidence, image.ImEncode(".png"));
            await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(new
            {
                api = apiUrl,
                web = webUrl,
                contractId = scenario.ContractId,
                ownerEmail = scenario.OwnerEmail,
                password = WorkflowTestUsers.Password,
                beneficiaryResidentId = scenario.BeneficiaryResidentId,
                evidence,
                output = directory
            }));
            var node = Environment.GetEnvironmentVariable("BHOME_TEST_NODE") ?? Path.Combine(root, ".tools", "node-v22.23.4-win-x64", "node.exe");
            Assert.True(File.Exists(node), "Set BHOME_TEST_NODE to the Node 22 executable.");
            var start = new ProcessStartInfo(node) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(Path.Combine(root, "scripts", "Test-DepositAgreementBrowser.mjs")); start.ArgumentList.Add(configPath);
            using var child = Process.Start(start) ?? throw new InvalidOperationException("browser_runner_not_started");
            var output = child.StandardOutput.ReadToEndAsync(); var errors = child.StandardError.ReadToEndAsync();
            try { using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3)); await child.WaitForExitAsync(timeout.Token); }
            finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
            await File.WriteAllTextAsync(Path.Combine(directory, "runner.log"), await output + "\n" + await errors);
            Assert.True(child.ExitCode == 0, "Browser runner failed; inspect " + Path.Combine(directory, "runner.log") + "\n" + await errors);
            using var result = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "result.json")));
            var refundId = result.RootElement.GetProperty("refundId").GetGuid();
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var repository = scope.ServiceProvider.GetRequiredService<IRefundRepository>(); var refund = await repository.GetAsync(refundId, default);
            Assert.Equal("COMPLETED", refund.Status); Assert.Equal(400000, refund.Amount); Assert.Equal(scenario.BeneficiaryResidentId, refund.BeneficiaryResidentId);
            Assert.Equal("CONTRACT_AGREEMENT_OWNER_CONFIRMED", refund.State.BeneficiaryBasis);
            Assert.Equal(scenario.ContractId, refund.State.SettlementContractId); Assert.NotNull(refund.EvidenceKey);
            Assert.Single((await repository.TenantListAsync(scenario.BeneficiaryUserId, 1, 100, default)).Items, r => r.Id == refundId);
            Assert.DoesNotContain((await repository.TenantListAsync(scenario.RepresentativeUserId, 1, 100, default)).Items, r => r.Id == refundId);
            await scope.ServiceProvider.GetRequiredService<BHome.Application.Notifications.INotificationEventPublisher>().PublishPendingAsync(default);
            Assert.Equal(3, await db.Set<UserNotification>().CountAsync(n => n.RelatedObjectType == "Refund" && n.RelatedObjectId == refundId && n.RecipientUserId == scenario.BeneficiaryUserId));
            Assert.False(await db.Set<UserNotification>().AnyAsync(n => n.RelatedObjectType == "Refund" && n.RelatedObjectId == refundId && n.RecipientUserId == scenario.RepresentativeUserId));
        }
        finally { await fixture.DisposeAsync(); }
    }

    private static string FindRepository()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) && Directory.Exists(Path.Combine(directory.FullName, "src", "owner-web"))) return directory.FullName;
        throw new InvalidOperationException("repository_not_found");
    }
}
