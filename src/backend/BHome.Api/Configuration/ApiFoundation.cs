using BHome.Api.IdentityAccess;
using BHome.Api.Middleware;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;

namespace BHome.Api.Configuration;

public static class ApiFoundation
{
    public static IServiceCollection AddApiFoundation(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddControllers();
        services.AddHttpContextAccessor();
        services.AddScoped<AuthTransportFilter>();
        services.AddOptions<AuthRateLimitOptions>().Bind(configuration.GetSection("AuthRateLimit"))
            .Validate(o => o.PermitLimit is >= 1 and <= 10000 && o.WindowSeconds is >= 1 and <= 3600,
                "Auth rate limit must be 1-10000 requests per 1-3600 seconds.").ValidateOnStart();
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy("Auth", context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = context.RequestServices.GetRequiredService<IOptions<AuthRateLimitOptions>>().Value.PermitLimit,
                    Window = TimeSpan.FromSeconds(context.RequestServices.GetRequiredService<IOptions<AuthRateLimitOptions>>().Value.WindowSeconds),
                    QueueLimit = 0
                }));
            options.OnRejected = async (context, cancellationToken) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                    context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retry.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
                await context.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>().WriteAsync(new ProblemDetailsContext
                {
                    HttpContext = context.HttpContext,
                    ProblemDetails = new Microsoft.AspNetCore.Mvc.ProblemDetails { Status = 429, Title = "Too many requests." }
                });
            };
        });
        services.AddScoped<ICurrentUser, HttpCurrentUser>();
        services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
            foreach (var role in Roles.All)
                options.AddPolicy(role, policy => policy.RequireAuthenticatedUser().RequireRole(role));
            foreach (var permission in RolePermissions.All)
                options.AddPolicy(permission.Key, policy => policy.RequireAuthenticatedUser().RequireRole(permission.Value));
        });
        services.AddCors(options => options.AddPolicy("Clients", policy =>
        {
            var origins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
            if (origins.Length > 0) policy.WithOrigins(origins).WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .WithHeaders("Content-Type", "Authorization", "X-Correlation-ID", "Idempotency-Key", "X-BHome-Client")
                .WithExposedHeaders("X-Correlation-ID").AllowCredentials();
        }));
        services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
        {
            context.ProblemDetails.Extensions["correlationId"] = context.HttpContext.TraceIdentifier;
            // Default framework exception metadata is never suitable for client responses.
            context.ProblemDetails.Extensions.Remove("exception");
        });
        services.AddExceptionHandler<ApiExceptionHandler>();
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("postgresql", tags: ["ready"]);
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(options =>
        {
            options.OperationFilter<TaskApiOperationFilter>();
            options.SwaggerDoc("v1", new OpenApiInfo { Title = "BHOME API", Version = "v1" });
            options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT"
            });
            options.AddSecurityRequirement(new OpenApiSecurityRequirement
            {
                [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = []
            });
        });
        return services;
    }
}
