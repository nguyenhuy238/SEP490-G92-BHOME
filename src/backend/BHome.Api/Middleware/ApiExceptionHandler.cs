using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.DigitalSigning.Application;
using BHome.Application.Ocr;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Api.Middleware;

internal sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var schemaMismatch = exception is PostgresException { SqlState: "42703" or "42P01" or "42883" } or
            DbUpdateException { InnerException: PostgresException { SqlState: "42703" or "42P01" or "42883" } };
        var status = schemaMismatch ? StatusCodes.Status503ServiceUnavailable : exception switch
        {
            BHome.Application.Operations.OperationsException operations => operations.Status,
            BHome.Application.Finance.FinanceException finance => finance.Status,
            BHome.Application.Notifications.NotificationException notification => notification.Status,
            BHome.Application.Billing.AdjustmentException adjustment => adjustment.Status,
            BHome.Application.PaymentsDebt.PaymentException payment => payment.Status,
            BHome.Application.Billing.InvoiceException invoice => invoice.Status,
            PropertyException property => property.Status,
            BHome.Application.IncidentMaintenance.IncidentException incident => incident.Status,
            BHome.Application.StaffOperations.OperationalTaskException task => task.Status,
            ContractException contract => contract.Status,
            DigitalSigningException signing => signing.Error switch
            {
                DigitalSigningError.Invalid => 400,
                DigitalSigningError.Unauthenticated => 401,
                DigitalSigningError.Forbidden => 403,
                DigitalSigningError.NotFound => 404,
                DigitalSigningError.Conflict => 409,
                DigitalSigningError.ProviderUnavailable => 503,
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
        logger.Log(status >= 500 ? LogLevel.Error : LogLevel.Warning, exception,
            "Request {CorrelationId} failed with {ErrorCode}", context.TraceIdentifier, exception.GetType().Name);
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";
        var code = schemaMismatch ? "database_schema_incompatible" : exception switch
        {
            BHome.Application.Operations.OperationsException operations => operations.Code,
            BHome.Application.Finance.FinanceException finance => finance.Code,
            BHome.Application.Notifications.NotificationException notification => notification.Code,
            BHome.Application.Billing.AdjustmentException adjustment => adjustment.Code,
            BHome.Application.PaymentsDebt.PaymentException payment => payment.Code,
            BHome.Application.Billing.InvoiceException invoice => invoice.Code,
            PropertyException property => property.Code,
            BHome.Application.IncidentMaintenance.IncidentException incident => incident.Code,
            BHome.Application.StaffOperations.OperationalTaskException task => task.Code,
            ContractException contract => contract.Code,
            CaptureConflictException conflict => conflict.Code,
            CaptureValidationException validation => validation.Code,
            OcrInputException input => input.Code,
            _ => null
        };
        var problem = new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = new ProblemDetails
            {
                Status = status,
                Title = title,
                Type = $"https://httpstatuses.com/{status}",
                // Digital-signing refusals are written for the person on screen ("Ảnh phải có nền trong suốt.").
                Detail = exception is DigitalSigningException readable ? readable.Message : null,
                Extensions = code is null ? new Dictionary<string, object?>() : new Dictionary<string, object?> { ["code"] = code }
            }
        };
        if (!await problems.TryWriteAsync(problem))
        {
            // A private-file client requests PDF/octet-stream, but rejected downloads still use
            // the API error contract. Content negotiation must not turn a valid 4xx into a 500.
            problem.ProblemDetails.Extensions["correlationId"] = context.TraceIdentifier;
            await context.Response.WriteAsJsonAsync(problem.ProblemDetails,
                options: (System.Text.Json.JsonSerializerOptions?)null,
                contentType: "application/problem+json", cancellationToken: cancellationToken);
        }
        return true;
    }
}
