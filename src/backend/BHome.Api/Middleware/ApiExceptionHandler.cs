using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using BHome.Application.Ocr;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Middleware;

internal sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var status = exception switch
        {
            BHome.Application.StaffOperations.OperationalTaskException task => task.Status,
            ContractException contract => contract.Status,
            DigitalSigningException signing => signing.Error switch
            {
                DigitalSigningError.Invalid => 400, DigitalSigningError.Unauthenticated => 401,
                DigitalSigningError.Forbidden => 403, DigitalSigningError.NotFound => 404,
                DigitalSigningError.Conflict => 409, DigitalSigningError.ProviderUnavailable => 503,
                _ => 500
            },
            IntegrationUnavailableException => StatusCodes.Status503ServiceUnavailable,
            OcrAccessException => StatusCodes.Status404NotFound,
            CaptureConflictException or OcrWorkflowStateException => StatusCodes.Status409Conflict,
            CaptureValidationException => StatusCodes.Status400BadRequest,
            OcrInputException { Code: "image_too_large" } => StatusCodes.Status413PayloadTooLarge,
            OcrInputException => StatusCodes.Status400BadRequest,
            BadHttpRequestException { StatusCode: >= 400 and < 500 } request => request.StatusCode,
            _ => StatusCodes.Status500InternalServerError
        };
        var title = status switch
        {
            StatusCodes.Status413PayloadTooLarge => "Request body too large.",
            >= 400 and < 500 => "Invalid HTTP request.",
            StatusCodes.Status503ServiceUnavailable => "Service temporarily unavailable.",
            _ => "An unexpected error occurred."
        };
        logger.Log(status >= 500 ? LogLevel.Error : LogLevel.Warning,
            "Request {CorrelationId} failed with {ErrorCode}", context.TraceIdentifier, exception.GetType().Name);
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";
        var code = exception switch
        {
            BHome.Application.StaffOperations.OperationalTaskException task => task.Code,
            ContractException contract => contract.Code,
            CaptureConflictException conflict => conflict.Code,
            CaptureValidationException validation => validation.Code,
            OcrInputException input => input.Code,
            _ => null
        };
        await problems.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = new ProblemDetails
            {
                Status = status,
                Title = title,
                Type = $"https://httpstatuses.com/{status}"
                ,
                Extensions = code is null ? new Dictionary<string, object?>() : new Dictionary<string, object?> { ["code"] = code }
            }
        });
        return true;
    }
}
