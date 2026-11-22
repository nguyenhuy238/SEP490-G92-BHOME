using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace BHome.Api.Middleware;

internal sealed class ApiProblemResultFilter : IAlwaysRunResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is ObjectResult { Value: ProblemDetails problem } result)
        {
            problem.Status ??= result.StatusCode;
            ApiProblems.Enrich(context.HttpContext, problem);
            result.ContentTypes.Clear();
            result.ContentTypes.Add("application/problem+json");
        }
    }
    public void OnResultExecuted(ResultExecutedContext context) { }
}
