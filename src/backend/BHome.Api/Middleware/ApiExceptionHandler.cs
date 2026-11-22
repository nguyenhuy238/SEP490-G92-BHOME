using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.DigitalSigning.Application;
using BHome.Application.Ocr;
using BHome.Application.Storage;
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
        // A disconnected PostgreSQL endpoint is an infrastructure outage (503), not an
        // application fault (500). Keep server-side SQL errors (PostgresException)
        // separate: invalid queries must not be presented as transient unavailability.
        // EF Core's retry strategy wraps transport failures in InvalidOperationException.
        // Walk only the causal chain, and never misclassify PostgreSQL SQL errors as outages.
        var databaseUnavailable = false;
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException) break;
            if (current is NpgsqlException) { databaseUnavailable = true; break; }
        }
        var databaseError = exception as PostgresException ?? exception.InnerException as PostgresException;
        var constraintCode = databaseError?.SqlState switch
        {
            "23505" => "data_unique_conflict",
            "23503" => "data_reference_conflict",
            // Unknown CHECK/NOT NULL failures can be internal write/outbox outages.
            "23514" when databaseError?.ConstraintName is "ck_resident_actual_dates" or "ck_billing_policy_calculation_method" => "data_constraint_invalid",
            "23P01" => "data_overlap_conflict",
            "40001" or "40P01" => "data_concurrency_conflict",
            _ => null
        };
        var status = schemaMismatch || databaseUnavailable ? StatusCodes.Status503ServiceUnavailable :
            constraintCode is not null ? (constraintCode == "data_constraint_invalid" ? 400 : 409) : exception switch
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
                DbUpdateConcurrencyException => StatusCodes.Status409Conflict,
                BHome.Application.Common.InputValidationException => StatusCodes.Status400BadRequest,
                PrivateObjectNotFoundException => StatusCodes.Status404NotFound,
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
        // Exception text can contain SQL parameters, identity fields or provider secrets.
        // Record classification and trace only; do not serialize the exception into logs.
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";
        var code = schemaMismatch ? "database_schema_incompatible" : databaseUnavailable ? "database_temporarily_unavailable" : constraintCode ?? (exception switch
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
            DigitalSigningException signing => "digital_signing_" + signing.Error.ToString().ToLowerInvariant(),
            CaptureConflictException conflict => conflict.Code,
            CaptureValidationException validation => validation.Code,
            OcrInputException input => input.Code,
            PrivateObjectNotFoundException => "private_evidence_file_missing",
            DbUpdateConcurrencyException => "data_concurrency_conflict",
            BHome.Application.Common.InputValidationException => "validation_error",
            _ => ApiProblems.DefaultCode(status)
        });
        logger.Log(status >= 500 ? LogLevel.Error : LogLevel.Warning,
            "Request {CorrelationId} failed with {ErrorCode} ({StatusCode}, {ExceptionType}, PostgreSQL {SqlState})",
            context.TraceIdentifier, code, status, exception.GetType().Name, databaseError?.SqlState);
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
        if (exception is DigitalSigningException readableSigning && status is not (401 or 403 or 404))
            problem.ProblemDetails.Title = readableSigning.Message;
        if (exception is BHome.Application.Common.InputValidationException fields)
        {
            var validation = new ValidationProblemDetails(fields.Errors.ToDictionary(x => x.Key, x => x.Value)) { Status = status };
            validation.Extensions["code"] = code;
            problem.ProblemDetails = validation;
        }
        ApiProblems.Enrich(context, problem.ProblemDetails);
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
