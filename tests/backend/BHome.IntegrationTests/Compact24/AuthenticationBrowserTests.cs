using System.Diagnostics;
using System.Text.Json;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed class AuthenticationBrowserTests
{
    [CompactBrowserFact]
    public async Task OwnerRefreshesANestedPageWithTheSameOriginSecureCookieAndRealApi()
    {
        var fixture = new Compact24Fixture(); await fixture.InitializeAsync();
        try
        {
            var root = FindRepository(); var directory = Path.Combine(root, ".tools", "auth-browser-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var apiPort = LoopbackBrowserApiBridge.AvailablePort(); var webPort = LoopbackBrowserApiBridge.AvailablePort();
            var apiUrl = $"http://127.0.0.1:{apiPort}"; var webUrl = $"http://127.0.0.1:{webPort}";
            using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cors:AllowedOrigins:0"] = webUrl, ["AuthWeb:AllowedOrigins:0"] = webUrl,
                ["Api:UseHttpsRedirection"] = "false", ["Email:Enabled"] = "false", ["Jobs:Enabled"] = "false"
            })));
            var email = Guid.NewGuid().ToString("N") + "@example.invalid";
            await using (var scope = host.Services.CreateAsyncScope())
                await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true }, "Owner", WorkflowTestUsers.Password);
            await using var bridge = new LoopbackBrowserApiBridge(host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }), apiPort);
            var configPath = Path.Combine(directory, "fixture.private.json");
            await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(new { api = apiUrl, web = webUrl, email, password = WorkflowTestUsers.Password, output = directory }));
            var node = Environment.GetEnvironmentVariable("BHOME_TEST_NODE") ?? Path.Combine(root, ".tools", "node-v22.23.4-win-x64", "node.exe");
            Assert.True(File.Exists(node), "Node 22 is required for the isolated browser test.");
            var start = new ProcessStartInfo(node) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(Path.Combine(root, "scripts", "Test-AuthenticationBrowser.mjs")); start.ArgumentList.Add(configPath);
            using var child = Process.Start(start) ?? throw new InvalidOperationException("browser_runner_not_started");
            var output = child.StandardOutput.ReadToEndAsync(); var errors = child.StandardError.ReadToEndAsync();
            try { using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(3)); await child.WaitForExitAsync(deadline.Token); }
            finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
            await File.WriteAllTextAsync(Path.Combine(directory, "runner.private.log"), await output + "\n" + await errors);
            Assert.True(child.ExitCode == 0, "Isolated authentication browser test failed; inspect the private runner log (credentials omitted here).");
            Assert.True(File.Exists(Path.Combine(directory, "passed.json")), "Browser verification evidence missing.");
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
