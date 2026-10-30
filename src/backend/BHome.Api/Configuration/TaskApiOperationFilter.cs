using BHome.Api.Controllers.StaffOperations;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace BHome.Api.Configuration;

internal sealed class TaskApiOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(OperationalTasksController)) return;
        var method = context.ApiDescription.HttpMethod;
        if (method is "POST" or "PUT" && context.MethodInfo.Name != nameof(OperationalTasksController.Read))
        {
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "Idempotency-Key", In = ParameterLocation.Header, Required = true,
                Description = "Non-empty UUID. Retries by the same actor with identical input return the original result; reuse with different input returns 409.",
                Schema = new OpenApiSchema { Type = "string", Format = "uuid" }
            });
        }
        foreach (var (status, description) in new[]
        {
            ("400", "Invalid input or missing idempotency key"), ("401", "Authentication required"),
            ("403", "Function permission denied"), ("404", "Resource unavailable in the current scope"),
            ("409", "State/version/responsibility/idempotency conflict")
        }) operation.Responses.TryAdd(status, new OpenApiResponse { Description = description });
        if (context.MethodInfo.Name == nameof(OperationalTasksController.Upload))
        {
            // The action streams Request.Body directly, so ApiExplorer cannot infer this body.
            operation.RequestBody = new OpenApiRequestBody
            {
                Required = true,
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["image/png"] = new() { Schema = new OpenApiSchema { Type = "string", Format = "binary" } },
                    ["image/jpeg"] = new() { Schema = new OpenApiSchema { Type = "string", Format = "binary" } }
                }
            };
            operation.Responses.TryAdd("413", new OpenApiResponse { Description = "Evidence exceeds the configured size limit" });
            operation.Responses.TryAdd("415", new OpenApiResponse { Description = "Only image/png and image/jpeg are supported" });
        }
    }
}
