using BHome.DigitalSigning.Application;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace BHome.DigitalSigning.Api;

// Maps the expected outcomes of signing use cases to ProblemDetails with their Vietnamese message. Anything else is left
// to BHome's ApiExceptionHandler (generic 500/503 without detail), so this handler must be registered before it.
internal sealed class DigitalSigningExceptionHandler(
    IProblemDetailsService problems, ILogger<DigitalSigningExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not DigitalSigningException expected) return false;
        var status = expected.Error switch
        {
            DigitalSigningError.Invalid => StatusCodes.Status400BadRequest,
            DigitalSigningError.Unauthenticated => StatusCodes.Status401Unauthorized,
            DigitalSigningError.Forbidden => StatusCodes.Status403Forbidden,
            DigitalSigningError.NotFound => StatusCodes.Status404NotFound,
            DigitalSigningError.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status502BadGateway
        };
        logger.Log(status >= 500 ? LogLevel.Warning : LogLevel.Information,
            "Request {CorrelationId} ended with signing outcome {Outcome}", context.TraceIdentifier, expected.Error);
        context.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = new ProblemDetails
            {
                Status = status,
                Title = expected.Message,
                Type = $"https://httpstatuses.com/{status}"
            }
        });
    }
}

public static class DigitalSigningApiExtensions
{
    // Call before BHome's AddExceptionHandler<ApiExceptionHandler>(): handlers run in registration order.
    public static IServiceCollection AddDigitalSigningApi(this IServiceCollection services)
    {
        services.AddExceptionHandler<DigitalSigningExceptionHandler>();
        return services;
    }
}
