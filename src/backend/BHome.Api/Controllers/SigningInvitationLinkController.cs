using System.Net;
using BHome.Application.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace BHome.Api.Controllers;

// Target of the "Mở BHOME để ký hợp đồng" button in the signing invitation email. Mail clients (Gmail) often drop
// links with an app scheme, so the email links here over http(s) and this page forwards to the app
// (ContractSigning:InvitationLink:MobileAppUrl). The app signs the user in first when needed, then opens the signing page.
// The page reveals nothing: the contract id is already in the link, and signing still needs the signer's session and OTP.
[ApiController, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), AllowAnonymous, EnableRateLimiting("Auth")]
public sealed class SigningInvitationLinkController(IOptions<ContractSigningOptions> options) : ControllerBase
{
    [HttpGet("open/sign-contract")]
    public IActionResult Open([FromQuery] Guid contractId)
    {
        var app = contractId == Guid.Empty ? null : options.Value.InvitationLink.AppLink(contractId);
        if (app is null) return NotFound();
        var url = WebUtility.HtmlEncode(app);
        Response.Headers["Referrer-Policy"] = "no-referrer";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return Content($$"""
            <!doctype html><html lang="vi"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex">
            <meta http-equiv="refresh" content="0;url={{url}}">
            <title>Mở BHOME để ký hợp đồng</title></head>
            <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937">
            <div style="max-width:480px;margin:48px auto;padding:24px;background:#fff;border-radius:8px;text-align:center">
            <div style="font-size:24px;font-weight:bold;color:#166534">BHOME</div>
            <p style="line-height:1.6">Đang mở ứng dụng BHOME để ký hợp đồng…</p>
            <p><a href="{{url}}" style="display:inline-block;background:#166534;color:#fff;padding:14px 24px;border-radius:6px;font-weight:bold;text-decoration:none">Mở BHOME để ký hợp đồng</a></p>
            <p style="font-size:13px;line-height:1.6;color:#6b7280">Nếu ứng dụng không tự mở, hãy bấm nút trên. Bạn cần cài ứng dụng BHOME trên điện thoại này.</p>
            </div></body></html>
            """, "text/html; charset=utf-8");
    }
}
