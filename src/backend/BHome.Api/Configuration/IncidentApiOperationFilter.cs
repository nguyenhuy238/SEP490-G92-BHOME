using BHome.Api.Controllers.IncidentMaintenance;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace BHome.Api.Configuration;

internal sealed class IncidentApiOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(IncidentReportsController) && context.MethodInfo.DeclaringType != typeof(WorkOrdersController)) return;
        if (context.ApiDescription.HttpMethod is "POST" or "PUT" && context.MethodInfo.Name != nameof(IncidentReportsController.Read))
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "Idempotency-Key",
                In = ParameterLocation.Header,
                Required = true,
                Description = "Non-empty UUID. Same actor/key/input replays the original IDs; changed input returns 409. GET the resource for its current version.",
                Schema = new OpenApiSchema { Type = "string", Format = "uuid" }
            });
        foreach (var (status, description) in new[] { ("400", "Invalid input"), ("401", "Authentication required"),
            ("403", "Permission denied"), ("404", "Resource unavailable in this scope"), ("409", "State, version or idempotency conflict") })
            operation.Responses.TryAdd(status, new OpenApiResponse { Description = description });
        if (context.MethodInfo.Name == nameof(IncidentReportsController.Upload))
        {
            operation.RequestBody = new OpenApiRequestBody
            {
                Required = true,
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["image/png"] = new() { Schema = new OpenApiSchema { Type = "string", Format = "binary" } },
                    ["image/jpeg"] = new() { Schema = new OpenApiSchema { Type = "string", Format = "binary" } }
                }
            };
        }
        if (context.MethodInfo.Name is nameof(IncidentReportsController.Upload) or nameof(IncidentReportsController.Submit))
        {
            operation.Responses.TryAdd("413", new OpenApiResponse { Description = "Image exceeds 5,000,000 bytes or request exceeds total limit" });
            operation.Responses.TryAdd("415", new OpenApiResponse { Description = "Unsupported content type" });
        }
    }
}
