using BHome.Application.Common;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Middleware;

internal sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var status = exception is IntegrationUnavailableException
            ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status500InternalServerError;
        logger.LogError("Request {CorrelationId} failed with {ErrorCode}", context.TraceIdentifier, exception.GetType().Name);
        context.Response.StatusCode = status;
        await problems.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = new ProblemDetails
            {
                Status = status,
                Title = status == 503 ? "Service temporarily unavailable." : "An unexpected error occurred.",
                Type = $"https://httpstatuses.com/{status}"
            }
        });
        return true;
    }
}
