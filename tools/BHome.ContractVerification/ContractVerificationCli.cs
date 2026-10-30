using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Ocr;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.ContractVerification;

internal static class ContractVerificationCli
{
    public static async Task<int> Main(string[] args)
    {
        if (!args.Contains("--allow-temporary-test-root", StringComparer.Ordinal))
        {
            Console.Error.WriteLine("Full browser verification requires temporary CurrentUser CA trust. Run interactively with --allow-temporary-test-root and accept Windows add/remove prompts. No trust store was modified.");
            return 1;
        }
        var root = Directory.GetCurrentDirectory();
        if (!File.Exists(Path.Combine(root, "src/backend/BHome.Api/BHome.Api.csproj")))
            throw new InvalidOperationException("Run this verification tool from the repository root.");
        var temporary = Directory.CreateTempSubdirectory("bhome-contract-verification-");
        var fixture = new CaptureFixture();
        const string contentRootKey = "ASPNETCORE_TEST_CONTENTROOT_BHOME_API";
        var priorContentRoot = Environment.GetEnvironmentVariable(contentRootKey);
        Environment.SetEnvironmentVariable(contentRootKey, Path.Combine(root, "src/backend/BHome.Api"));
        Process? api = null;
        X509Certificate2? browserTrustAnchor = null;
        var exitCode = 0;
        var stage = "disposable infrastructure";
        try
        {
            await fixture.InitializeAsync();
            var settings = new Dictionary<string, string?>();
            stage = "production provider registrations";
            await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            {
                var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                foreach (var key in new[] { "ConnectionStrings:Database", "ObjectStorage:Endpoint", "ObjectStorage:UseSsl",
                    "ObjectStorage:Bucket", "ObjectStorage:AccessKey", "ObjectStorage:SecretKey", "IdentityProtection:ActiveEncryptionVersion",
                    "IdentityProtection:ActiveHmacVersion", "IdentityProtection:EncryptionKeys:test", "IdentityProtection:HmacKeys:test" })
                    settings[key] = config[key];
                // Record that this harness is using the actual fail-closed integrations, not test replacements.
                if (scope.ServiceProvider.GetRequiredService<IContractSigningProvider>().GetType().Name != "ViettelMySignContractAdapter" ||
                    scope.ServiceProvider.GetRequiredService<IContractSettlementLedger>().GetType().Name != "PendingContractSettlementLedger" ||
                    scope.ServiceProvider.GetRequiredService<IContractHoldingLedger>().GetType().Name != "UnconfiguredContractHoldingLedger")
                    throw new InvalidOperationException("Unexpected provider replacement: live verification refused.");
            }
            var actors = new Dictionary<string, object>();
            stage = "synthetic accounts";
            var password = "Synthetic!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                foreach (var (name, role) in new[] { ("owner", Roles.Owner), ("staff", Roles.Staff), ("tenant", Roles.Tenant),
                    ("otherStaff", Roles.Staff), ("otherTenant", Roles.Tenant) })
                {
                    var id = Guid.NewGuid(); var email = $"{name}-{id:N}@example.invalid";
                    var user = new ApplicationUser { Id = id, UserName = email, Email = email, IsActive = true };
                    if (!(await users.CreateAsync(user, password)).Succeeded || !(await users.AddToRoleAsync(user, role)).Succeeded)
                        throw new InvalidOperationException("Synthetic account provisioning failed.");
                    actors[name] = new { id, email, password };
                }
            }
            using var caKey = RSA.Create(2048);
            stage = "ephemeral TLS";
            var caRequest = new CertificateRequest("CN=BHOME disposable verification CA", caKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            caRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
            caRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign, true));
            using var ca = caRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddHours(2));
            // The Windows browser and HttpClient must validate chain/hostname normally.
            // Install only this ephemeral public CA in CurrentUser, and always remove it below.
            browserTrustAnchor = new X509Certificate2(ca.Export(X509ContentType.Cert));
            using (var trust = new X509Store(StoreName.Root, StoreLocation.CurrentUser))
            {
                trust.Open(OpenFlags.ReadWrite);
                trust.Add(browserTrustAnchor);
            }
            using var serverKey = RSA.Create(2048);
            var serverRequest = new CertificateRequest("CN=localhost", serverKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            serverRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
            serverRequest.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new("1.3.6.1.5.5.7.3.1") }, true));
            var names = new SubjectAlternativeNameBuilder(); names.AddDnsName("localhost"); names.AddIpAddress(IPAddress.Loopback);
            serverRequest.CertificateExtensions.Add(names.Build());
            using var issued = serverRequest.Create(ca, DateTimeOffset.UtcNow.AddMinutes(-4), DateTimeOffset.UtcNow.AddHours(1), RandomNumberGenerator.GetBytes(16));
            using var certificate = issued.CopyWithPrivateKey(serverKey);
            var pfxPath = Path.Combine(temporary.FullName, "server.pfx");
            var caPath = Path.Combine(temporary.FullName, "ca.pem");
            var pfxPassword = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
            await File.WriteAllBytesAsync(pfxPath, certificate.Export(X509ContentType.Pfx, pfxPassword));
            await File.WriteAllTextAsync(caPath, ca.ExportCertificatePem());
            var apiPort = FreePort(); var webPort = FreePort();
            var baseUrl = $"https://localhost:{apiPort}"; var origin = $"https://localhost:{webPort}";
            var start = new ProcessStartInfo("dotnet")
            {
                WorkingDirectory = Path.Combine(root, "src/backend/BHome.Api"),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.ArgumentList.Add(Path.Combine(root, "src/backend/BHome.Api/bin/Debug/net8.0/BHome.Api.dll"));
            // Do not inherit developer DB/provider credentials into the disposable host.
            var systemVariables = new[] { "PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
                "HOME", "DOTNET_ROOT", "DOTNET_ROOT_X64", "ComSpec", "SystemDrive", "ProgramFiles", "ProgramFiles(x86)" }
                .ToDictionary(k => k, Environment.GetEnvironmentVariable);
            start.Environment.Clear();
            foreach (var pair in systemVariables.Where(p => p.Value is not null)) start.Environment[pair.Key] = pair.Value;
            foreach (var pair in settings) start.Environment[pair.Key.Replace(":", "__")] = pair.Value;
            start.Environment["DOTNET_ENVIRONMENT"] = "Testing";
            start.Environment["ASPNETCORE_URLS"] = baseUrl;
            start.Environment["Kestrel__Certificates__Default__Path"] = pfxPath;
            start.Environment["Kestrel__Certificates__Default__Password"] = pfxPassword;
            start.Environment["Jwt__SigningKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
            start.Environment["Cors__AllowedOrigins__0"] = origin;
            start.Environment["AuthWeb__AllowedOrigins__0"] = origin;
            start.Environment["AuthRateLimit__PermitLimit"] = "10000";
            start.Environment["Ocr__Enabled"] = "false";
            start.Environment["Jobs__Enabled"] = "false";
            start.Environment["DigitalSigning__Viettel__BaseUrl"] = "";
            start.Environment["DigitalSigning__Viettel__ClientId"] = "";
            start.Environment["DigitalSigning__Viettel__ClientSecret"] = "";
            start.Environment["Logging__LogLevel__Default"] = "Warning";
            api = Process.Start(start)!;
            stage = "HTTPS API readiness";
            // Drain output without publishing requests or credentials; clients record only safe check results.
            api.OutputDataReceived += (_, _) => { }; api.ErrorDataReceived += (_, _) => { };
            api.BeginOutputReadLine(); api.BeginErrorReadLine();
            using var handler = new HttpClientHandler();
            using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(2) };
            var ready = false;
            for (var i = 0; i < 60 && !api.HasExited; i++)
            {
                try { ready = (await client.GetAsync(baseUrl + "/health/ready")).IsSuccessStatusCode; } catch (HttpRequestException) { } catch (TaskCanceledException) { }
                if (ready) break;
                await Task.Delay(500);
            }
            if (!ready) throw new InvalidOperationException("Disposable HTTPS API did not become ready.");
            var nodePath = Path.Combine(root, ".tools/node-v22.23.4-win-x64/node.exe");
            var nodeStart = new ProcessStartInfo(File.Exists(nodePath) ? nodePath : "node")
            {
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true
            };
            nodeStart.ArgumentList.Add(Path.Combine(root, "scripts/Verify-ContractClients.cjs"));
            nodeStart.Environment.Remove("NODE_TLS_REJECT_UNAUTHORIZED");
            nodeStart.Environment.Remove("NODE_OPTIONS");
            nodeStart.Environment["NODE_EXTRA_CA_CERTS"] = caPath;
            using var node = Process.Start(nodeStart)!;
            stage = "real clients";
            await node.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { baseUrl, origin, webPort, pfxPath, pfxPassword, temporary = temporary.FullName, actors }));
            node.StandardInput.Close();
            await node.WaitForExitAsync();
            if (node.ExitCode != 0) throw new InvalidOperationException("Real client verification failed.");
            await using var verification = fixture.Factory.Services.CreateAsyncScope();
            stage = "persisted effects";
            var db = verification.ServiceProvider.GetRequiredService<BHomeDbContext>();
            if (await db.Set<Contract>().CountAsync() != 2 || await db.Set<Contract>().AnyAsync(c => (c.Status != ContractStatus.Draft && c.Status != ContractStatus.PendingSigning) || c.PreviousContractId != null) ||
                await db.Set<Room>().AnyAsync(r => r.Status == RoomStatus.Occupied) || await db.Set<DepositVerification>().CountAsync() != 1 ||
                await db.Set<DepositVerification>().SumAsync(d => d.Amount) != 3000000 || await db.Set<ContractSignature>().AnyAsync() ||
                await db.Set<BHome.DigitalSigning.Domain.SigningCertificate>().AnyAsync() || await db.Set<ContractMoveOut>().AnyAsync() ||
                await db.SecurityAudit.CountAsync(a => a.Event == "ContractDepositVerified") != 1)
                throw new InvalidOperationException("Unexpected business effects after blocked signing/activation.");
            Console.WriteLine("PASS: persisted effects checked: 2 pending contracts, 1 synthetic manual deposit, no signature/activation/room occupancy.");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"Live verification failed at {stage} ({e.GetType().Name}); no credential/provider detail printed.");
            Console.Error.WriteLine(string.Join(Environment.NewLine, (e.StackTrace ?? "").Split(Environment.NewLine).Take(4)));
            exitCode = 1;
        }
        finally
        {
            if (browserTrustAnchor is not null)
            {
                try
                {
                    using var trust = new X509Store(StoreName.Root, StoreLocation.CurrentUser);
                    trust.Open(OpenFlags.ReadWrite);
                    if (trust.Certificates.Find(X509FindType.FindByThumbprint, browserTrustAnchor.Thumbprint, false).Count != 0)
                        trust.Remove(browserTrustAnchor);
                    if (trust.Certificates.Find(X509FindType.FindByThumbprint, browserTrustAnchor.Thumbprint, false).Count != 0)
                        throw new InvalidOperationException("Ephemeral test CA cleanup failed.");
                    Console.WriteLine("PASS: ephemeral test CA removed from CurrentUser trust store.");
                }
                catch (Exception cleanupError) when (cleanupError is CryptographicException or InvalidOperationException)
                {
                    exitCode = 1;
                    Console.Error.WriteLine($"CA cleanup requires Windows confirmation. Remove only BHOME disposable verification CA {browserTrustAnchor.Thumbprint} in certmgr.msc; other resource cleanup continues.");
                }
                finally { browserTrustAnchor.Dispose(); }
            }
            if (api is { HasExited: false }) { api.Kill(entireProcessTree: true); await api.WaitForExitAsync(); }
            api?.Dispose();
            try { await fixture.DisposeAsync(); }
            finally
            {
                Environment.SetEnvironmentVariable(contentRootKey, priorContentRoot);
                var resolved = Path.GetFullPath(temporary.FullName);
                if (resolved.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase) && Path.GetFileName(resolved).StartsWith("bhome-contract-verification-", StringComparison.Ordinal))
                    Directory.Delete(resolved, recursive: true);
            }
        }
        return exitCode;
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}
