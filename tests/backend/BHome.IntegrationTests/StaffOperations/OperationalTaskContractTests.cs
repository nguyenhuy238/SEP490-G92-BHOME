using BHome.Api.Controllers.StaffOperations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Swashbuckle.AspNetCore.Swagger;

namespace BHome.IntegrationTests.StaffOperations;

public sealed class OperationalTaskContractTests
{
    [Fact]
    public void OpenApiDocumentsCommandsEvidenceAndIdempotencyHeaders()
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var document = scope.ServiceProvider.GetRequiredService<ISwaggerProvider>().GetSwagger("v1");
        const string route = "/api/v1/operational-tasks";
        foreach (var suffix in new[] { "", "/{id}", "/{id}/start", "/{id}/submit", "/{id}/verify", "/{id}/rework", "/{id}/cancel", "/{id}/evidence", "/{id}/history", "/notifications" })
            Assert.Contains(route + suffix, document.Paths.Keys);
        var create = document.Paths[route].Operations[Microsoft.OpenApi.Models.OperationType.Post];
        var key = Assert.Single(create.Parameters, x => x.Name == "Idempotency-Key");
        Assert.True(key.Required); Assert.Equal("uuid", key.Schema.Format);
        Assert.Contains("201", create.Responses.Keys); Assert.Contains("409", create.Responses.Keys);
        var upload = document.Paths[route + "/{id}/evidence"].Operations[Microsoft.OpenApi.Models.OperationType.Put];
        Assert.Contains("image/png", upload.RequestBody.Content.Keys); Assert.Contains("image/jpeg", upload.RequestBody.Content.Keys);
        Assert.Contains("413", upload.Responses.Keys);
        Assert.DoesNotContain(document.Paths[route + "/{id}"].Operations.Keys, x => x == Microsoft.OpenApi.Models.OperationType.Patch || x == Microsoft.OpenApi.Models.OperationType.Delete);
        Assert.All(typeof(OperationalTasksController).GetMethods().Where(m => m.GetCustomAttributes(typeof(HttpPostAttribute), false).Any()),
            method => Assert.NotEqual("SetStatus", method.Name));
    }
}
