using System.Net.NetworkInformation;
using System.Net.Sockets;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Api;
using BHome.DigitalSigning.Api.Controllers;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Infrastructure;
using BHome.DigitalSigning.Sandbox;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection.Extensions;

// Sandbox host: the cloned signing module behind a demo sign-in and a test page, so the team can try remote signing
// before BHome's mobile/web UI exists. Sandbox:Provider = Auto (default: the real Viettel MySign once an Owner saves an
// account on the page, the fake one until then), Fake or Viettel.
// Sandbox:Storage = Memory (default, nothing to install) or Postgres (ConnectionStrings:Database + sql/ script).
var builder = WebApplication.CreateBuilder(args);
var useMemory = !string.Equals(builder.Configuration["Sandbox:Storage"], "Postgres", StringComparison.OrdinalIgnoreCase);
// The saved client secret is encrypted with a key of this machine's own unless one is configured.
if (string.IsNullOrWhiteSpace(builder.Configuration["DigitalSigning:SecretKey"]))
    builder.Configuration["DigitalSigning:SecretKey"] = SandboxData.SecretKey();

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddDigitalSigning(builder.Configuration);
if (useMemory)
{
    builder.Services.Replace(ServiceDescriptor.Singleton<IDigitalSigningStore, MemorySigningStore>());
    builder.Services.Replace(ServiceDescriptor.Singleton<ISigningSettingsStore>(
        new FileSettingsStore(Path.Combine(SandboxData.Folder, "viettel-account.json"))));
    builder.Services.Replace(ServiceDescriptor.Singleton<ISignatureImageStore, MemorySignatureImageStore>());
}
// The real Viettel provider stays registered under its own type; every call picks it or the fake one.
var realProvider = builder.Services.Single(service => service.ServiceType == typeof(ISigningProvider)).ImplementationType!;
builder.Services.AddScoped(realProvider);
builder.Services.AddSingleton<FakeMySign>();
builder.Services.AddSingleton(new SandboxMode(builder.Configuration["Sandbox:Provider"], realProvider));
builder.Services.Replace(ServiceDescriptor.Scoped<ISigningProvider, SandboxSigningProvider>());

builder.Services.AddAuthentication(DemoAuthenticationHandler.SchemeName)
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, DemoAuthenticationHandler>(
        DemoAuthenticationHandler.SchemeName, null);
builder.Services.AddAuthorization();
builder.Services.AddProblemDetails();
builder.Services.AddDigitalSigningApi();
builder.Services.AddControllers().AddApplicationPart(typeof(SigningTransactionsController).Assembly);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();
app.UseExceptionHandler(errors => errors.Run(async context =>
{
    // Sandbox only: an unexpected error shows its type and message so whoever is testing can report it.
    var failure = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new ProblemDetails
    {
        Status = 500, Title = "Lỗi không mong đợi trong sandbox", Detail = $"{failure?.GetType().Name}: {failure?.Message}"
    });
}));
app.UseStatusCodePages();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseSwagger();
app.UseSwaggerUI();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.MapGet("/sandbox/info", async (HttpContext context, IViettelAccountSource accounts, SandboxMode mode,
    CancellationToken cancellationToken) => new
{
    provider = await mode.UsesViettelAsync(accounts, cancellationToken) ? "viettel" : "fake",
    mode = mode.Setting,
    storage = useMemory ? "memory" : "postgres",
    phoneUrls = LanAddresses().Select(address => $"http://{address}:{context.Connection.LocalPort}/phone.html").ToList()
});

{
    // The fake MySign app (phone.html). Anonymous on purpose: it plays Viettel's app, not a BHome user.
    var phone = app.MapGroup("/sandbox/phone");
    phone.MapGet("/requests", (string userId, FakeMySign mysign) => mysign.PendingFor(userId.Trim())
        .Select(request => new { request.Id, request.Description, request.DocumentId, request.CreatedAt }));
    phone.MapPost("/requests/{id}/approve", (string id, FakeMySign mysign) =>
        mysign.Approve(id) ? Results.NoContent() : Results.NotFound());
    phone.MapPost("/requests/{id}/reject", (string id, FakeMySign mysign) =>
        mysign.Reject(id) ? Results.NoContent() : Results.NotFound());
    // What a real registration at Viettel would fix: the holder's name on the fake certificate.
    app.MapPost("/sandbox/fake-signers", (FakeSigner signer, FakeMySign mysign) =>
    {
        mysign.Name(signer.UserId ?? "", signer.Name ?? "");
        return Results.NoContent();
    });
}

app.Run();

// The addresses a phone on the same Wi-Fi can reach: Wi-Fi first, virtual adapters (WSL, Hyper-V, VPN) left out.
static IEnumerable<string> LanAddresses() => NetworkInterface.GetAllNetworkInterfaces()
    .Where(network => network.OperationalStatus == OperationalStatus.Up &&
                      network.NetworkInterfaceType is NetworkInterfaceType.Wireless80211 or NetworkInterfaceType.Ethernet &&
                      !new[] { "virtual", "vethernet", "hyper-v", "wsl", "vmware", "vpn", "tap" }.Any(word =>
                          network.Name.Contains(word, StringComparison.OrdinalIgnoreCase) ||
                          network.Description.Contains(word, StringComparison.OrdinalIgnoreCase)))
    .OrderBy(network => network.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? 0 : 1)
    .SelectMany(network => network.GetIPProperties().UnicastAddresses)
    .Where(unicast => unicast.Address.AddressFamily == AddressFamily.InterNetwork &&
                      !unicast.Address.ToString().StartsWith("169.254.", StringComparison.Ordinal))
    .Select(unicast => unicast.Address.ToString())
    .Distinct();

internal sealed record FakeSigner(string? UserId, string? Name);
