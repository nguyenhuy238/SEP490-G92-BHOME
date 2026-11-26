using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.IdentityAccess;
using BHome.Application.IdentityAccess;

namespace BHome.Api.Middleware;

public sealed class SePayOwnerConfigurationMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ICurrentUser actor)
    {
        var path = context.Request.Path;
        var paymentRequest = path.StartsWithSegments("/api/v1/receiving-bank-accounts") ||
            path.StartsWithSegments("/api/v1/integrations/sepay");
        if (paymentRequest && actor.IsInRole(Roles.Owner) && actor.UserId is { } owner)
            await context.RequestServices.GetRequiredService<ISePayOwnerConnections>().ApplyOwnerAsync(owner, context.RequestAborted);
        await next(context);
    }
}
