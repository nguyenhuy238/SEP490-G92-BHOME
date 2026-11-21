using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers;

// Only a public CA certificate, never a PFX/private key. Explicit local-development opt-in.
[ApiController, ApiExplorerSettings(IgnoreApi = true)]
public sealed class MobileDevelopmentController(IWebHostEnvironment environment, IConfiguration configuration) : ControllerBase
{
    [AllowAnonymous, HttpGet("development/mobile-ca.cer")]
    public IActionResult Certificate()
    {
        if (!environment.IsDevelopment() || !configuration.GetValue<bool>("MobileDevelopment:Enabled")) return NotFound();
        var path = configuration["MobileDevelopment:RootCertificate"];
        if (string.IsNullOrEmpty(path) || !path.EndsWith(".cer", StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path)) return NotFound();
        Response.Headers.CacheControl = "no-store";
        return PhysicalFile(Path.GetFullPath(path), "application/x-x509-ca-cert", "bhome-local-mobile-ca.cer");
    }
}
