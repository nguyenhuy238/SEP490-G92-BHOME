using BHome.Api.Configuration;
using BHome.Api.Middleware;
using BHome.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options => options.IncludeScopes = true);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddApiFoundation(builder.Configuration);

var app = builder.Build();
app.UseMiddleware<CorrelationMiddleware>();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment()) app.UseHsts();
if (app.Configuration.GetValue("Api:UseHttpsRedirection", true))
    app.UseWhen(context => !(app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("MobileDevelopment:Enabled") &&
        context.Request.Path == "/development/mobile-ca.cer"), branch => branch.UseHttpsRedirection());
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.UseCors("Clients");
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api/v1/auth") || context.Request.Path.StartsWithSegments("/api/v1/ocr") || context.Request.Path.StartsWithSegments("/api/v1/capture"))
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }
    await next(context);
    if (context.Response.StatusCode == StatusCodes.Status403Forbidden && context.User.Identity?.IsAuthenticated == true)
    {
        var userId = Guid.TryParse(context.User.FindFirst("sub")?.Value, out var user) ? user : (Guid?)null;
        var sessionId = Guid.TryParse(context.User.FindFirst("sid")?.Value, out var session) ? session : (Guid?)null;
        await context.RequestServices.GetRequiredService<BHome.Application.IdentityAccess.ISecurityAudit>()
            .ForbiddenAsync(userId, sessionId, context.RequestAborted);
    }
});
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new() { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();
app.Run();

public partial class Program;
