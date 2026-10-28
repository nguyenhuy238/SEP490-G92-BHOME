using System.Diagnostics;

namespace BHome.Api.Middleware;

internal sealed class CorrelationMiddleware(RequestDelegate next, ILogger<CorrelationMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var incoming = context.Request.Headers["X-Correlation-ID"].ToString();
        var id = Guid.TryParse(incoming, out var parsed) ? parsed.ToString() : Guid.NewGuid().ToString();
        context.TraceIdentifier = id;
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["X-Correlation-ID"] = id;
            return Task.CompletedTask;
        });
        using var scope = logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id });
        var start = Stopwatch.GetTimestamp();
        try { await next(context); }
        finally
        {
            logger.LogInformation("HTTP {Method} completed {StatusCode} in {ElapsedMs} ms",
                context.Request.Method, context.Response.StatusCode, Stopwatch.GetElapsedTime(start).TotalMilliseconds);
        }
    }
}
