using BHome.Application.Contracts;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace BHome.Api.Controllers;

// Viettel MySign stays in the backend for later use but can be switched off (ContractSigning:Methods:ViettelMySign).
// While it is off, its certificate and account endpoints answer 404 signing_method_disabled instead of failing later.
[AttributeUsage(AttributeTargets.Class)]
public sealed class ViettelMySignEnabledAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        var options = context.HttpContext.RequestServices.GetService<IOptions<ContractSigningOptions>>();
        if (options is not null && !options.Value.Methods.ViettelMySign) throw new ContractException(404, "signing_method_disabled");
    }
}
