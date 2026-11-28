using BHome.Api.IdentityAccess;
using BHome.Api.Middleware;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application.Identity;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.Api.Configuration;

public static class ApiFoundation
{
    public static IServiceCollection AddApiFoundation(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddControllers(options =>
        {
            options.Filters.Add<ApiProblemResultFilter>();
            options.ModelMetadataDetailsProviders.Add(new LocalizedValidationMetadata());
            var messages = options.ModelBindingMessageProvider;
            messages.SetMissingRequestBodyRequiredValueAccessor(() => "Vui lòng gửi đầy đủ thông tin yêu cầu.");
            messages.SetValueMustNotBeNullAccessor(_ => "Vui lòng nhập giá trị bắt buộc.");
            messages.SetAttemptedValueIsInvalidAccessor((_, _) => "Dữ liệu không đúng định dạng. Vui lòng kiểm tra lại.");
            messages.SetNonPropertyAttemptedValueIsInvalidAccessor(_ => "Dữ liệu không đúng định dạng. Vui lòng kiểm tra lại.");
            messages.SetValueIsInvalidAccessor(_ => "Dữ liệu không đúng định dạng. Vui lòng kiểm tra lại.");
            messages.SetValueMustBeANumberAccessor(_ => "Vui lòng nhập số hợp lệ.");
            messages.SetUnknownValueIsInvalidAccessor(_ => "Giá trị không được hỗ trợ. Vui lòng kiểm tra lại.");
            messages.SetNonPropertyUnknownValueIsInvalidAccessor(() => "Giá trị không được hỗ trợ. Vui lòng kiểm tra lại.");
            messages.SetNonPropertyValueMustBeANumberAccessor(() => "Vui lòng nhập số hợp lệ.");
            messages.SetMissingBindRequiredValueAccessor(_ => "Vui lòng nhập giá trị bắt buộc.");
            messages.SetMissingKeyOrValueAccessor(() => "Thông tin gửi lên chưa đầy đủ. Vui lòng kiểm tra lại.");
        }).AddJsonOptions(options =>
        {
            options.JsonSerializerOptions.Converters.Add(new RetiredRoomTypeJsonConverterFactory());
            options.JsonSerializerOptions.TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver
            {
                Modifiers = { info =>
                {
                    if (info.Kind == System.Text.Json.Serialization.Metadata.JsonTypeInfoKind.Object &&
                        (info.Type == typeof(BHome.Application.PropertyManagement.RoomWrite) ||
                         info.Type == typeof(BHome.Application.PropertyManagement.PolicyWrite)))
                        info.UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow;
                } }
            };
        });
        services.AddHttpContextAccessor();
        services.AddTransient<Microsoft.AspNetCore.Mvc.Infrastructure.ProblemDetailsFactory, ApiProblemDetailsFactory>();
        services.AddScoped<AuthTransportFilter>();
        services.AddOptions<AuthRateLimitOptions>().Bind(configuration.GetSection("AuthRateLimit"))
            .Validate(o => o.PermitLimit is >= 1 and <= 10000 && o.WindowSeconds is >= 1 and <= 3600,
                "Auth rate limit must be 1-10000 requests per 1-3600 seconds.").ValidateOnStart();
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Owner polling must not consume anonymous signers' or login request budgets.
            // Per-invitation OTP cooldown/send/guess limits remain enforced by the service.
            foreach (var policy in new[] { "SigningRead", "SigningOtp", "SigningVerify" })
                options.AddPolicy(policy, context => RateLimitPartition.GetFixedWindowLimiter(
                    policy + ":" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = context.RequestServices.GetRequiredService<IOptions<AuthRateLimitOptions>>().Value.PermitLimit,
                        Window = TimeSpan.FromSeconds(context.RequestServices.GetRequiredService<IOptions<AuthRateLimitOptions>>().Value.WindowSeconds),
                        QueueLimit = 0
                    }));
            options.AddPolicy("EmailTest", context => context.User.IsInRole("Owner")
                ? RateLimitPartition.GetFixedWindowLimiter("development-email-test", _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 1, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 })
                : RateLimitPartition.GetNoLimiter("email-test-unauthorized"));
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
                await ApiProblems.WriteAsync(context.HttpContext,
                    new Microsoft.AspNetCore.Mvc.ProblemDetails { Status = 429 }, cancellationToken);
            };
        });
        services.AddScoped<ICurrentUser, HttpCurrentUser>();
        AddSigningIdentity(services);
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
            ApiProblems.Enrich(context.HttpContext, context.ProblemDetails);
        });
        services.AddExceptionHandler<ApiExceptionHandler>();
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("postgresql", tags: ["ready"]);
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(options =>
        {
            // Incident and Finance intentionally expose different ExpenseView DTOs.
            // Namespace only colliding schema names; keep all established schema IDs stable.
            options.CustomSchemaIds(SchemaId);
            options.OperationFilter<TaskApiOperationFilter>();
            options.OperationFilter<IncidentApiOperationFilter>();
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

    private static string SchemaId(Type type)
    {
        if (type.IsConstructedGenericType)
            return string.Concat(type.GetGenericArguments().Select(SchemaId)) + type.Name.Split('`')[0];
        var name = type.Name.Replace("[]", "Array", StringComparison.Ordinal);
        return name == "ExpenseView" ? type.FullName!.Replace('.', '_').Replace('+', '_') : name;
    }

    internal static void AddSigningIdentity(IServiceCollection services) =>
        services.TryAddScoped<ISigningCurrentUser>(provider =>
            new SigningCurrentUserAdapter(provider.GetRequiredService<ICurrentUser>()));

    private sealed class SigningCurrentUserAdapter(ICurrentUser user) : ISigningCurrentUser
    {
        public Guid? UserId => user.UserId;
        public bool IsInRole(string role) => user.IsInRole(role);
    }
}
