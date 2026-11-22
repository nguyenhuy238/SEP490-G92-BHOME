using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BHome.Api.Middleware;

internal static class ApiProblems
{
    private static readonly IReadOnlyDictionary<string, string> Messages = LoadMessages();

    private static IReadOnlyDictionary<string, string> LoadMessages()
    {
        using var stream = typeof(ApiProblems).Assembly.GetManifestResourceStream("BHome.Api.ErrorMessages.json")!;
        return JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!;
    }

    public static string DefaultCode(int status) => status switch
    {
        400 => "invalid_request",
        401 => "authentication_required",
        403 => "forbidden",
        404 => "resource_not_found",
        409 => "data_conflict",
        413 => "request_too_large",
        415 => "unsupported_media_type",
        429 => "rate_limited",
        503 => "service_unavailable",
        _ => status >= 500 ? "internal_error" : "request_rejected"
    };

    public static string Message(int status, string? code = null) =>
        code is not null && Messages.TryGetValue(code, out var message) ? message : status switch
        {
            400 => "Dữ liệu gửi lên chưa hợp lệ. Kiểm tra các trường và định dạng dữ liệu.",
            401 => "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
            403 => "Bạn không có quyền thực hiện thao tác này trong phạm vi hiện tại.",
            404 => "Không tìm thấy dữ liệu trong phạm vi được phép truy cập.",
            409 => "Dữ liệu đã thay đổi hoặc xung đột. Tải lại và kiểm tra trước khi lưu.",
            413 => "Dữ liệu tải lên vượt giới hạn cho phép. Giảm dung lượng tệp rồi thử lại.",
            415 => "Định dạng dữ liệu không được hỗ trợ. Kiểm tra loại tệp và định dạng yêu cầu.",
            429 => "Bạn gửi quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.",
            503 => "Dịch vụ đang tạm gián đoạn. Kiểm tra trạng thái dữ liệu trước khi gửi lại.",
            _ => "Máy chủ chưa xử lý được yêu cầu. Tải lại để kiểm tra kết quả; cung cấp mã truy vết nếu lỗi tiếp diễn."
        };

    public static void Enrich(HttpContext context, ProblemDetails problem)
    {
        var status = problem.Status ?? context.Response.StatusCode;
        var code = problem.Extensions.TryGetValue("code", out var existing) && existing is string value
            ? value : DefaultCode(status);
        problem.Extensions["code"] = code;
        problem.Extensions["correlationId"] = context.TraceIdentifier;
        problem.Extensions["traceId"] = context.TraceIdentifier;
        problem.Extensions.Remove("exception");
        // Only catalogued messages or intentional localized controller titles are public.
        var message = Message(status, code);
        if (status is 401 or 403 or 404) message = Message(status);
        if (status < 500 && problem.Title is { } title && LocalizedValidationMetadata.IsVietnamese(title)) message = title;
        problem.Title = message;
        problem.Extensions["message"] = message;
        problem.Type ??= $"https://httpstatuses.com/{status}";
        if (status is 400 or 409)
        {
            var field = code switch
            {
                "email_already_used" => "email",
                "phone_already_used" or "invalid_phone_number" => "phone",
                "duplicate_room_number" => "roomNumber",
                "duplicate_asset_code" => "code",
                "employment_period_overlap" => "employment.startDate",
                "current_password_required" or "current_password_invalid" => "currentPassword",
                _ => null
            };
            if (field is not null)
            {
                problem.Extensions["errors"] = new Dictionary<string, string[]> { [field] = [message] };
                problem.Extensions["fieldErrors"] = new Dictionary<string, FieldError[]> { [field] = [new(code, message)] };
            }
        }
        if (problem is ValidationProblemDetails validation)
        {
            problem.Extensions["code"] = "validation_error";
            problem.Title = "Thông tin nhập chưa hợp lệ. Vui lòng kiểm tra các trường được đánh dấu.";
            problem.Extensions["message"] = problem.Title;
            problem.Extensions["fieldErrors"] = validation.Errors
                .GroupBy(x => FieldName(x.Key))
                .ToDictionary(x => x.Key, x => x.SelectMany(pair => pair.Value).Distinct()
                    .Select(text => new FieldError(LocalizedValidationMetadata.ErrorCode(text), text)).ToArray());
        }
    }

    public static async Task WriteAsync(HttpContext context, ProblemDetails problem, CancellationToken token)
    {
        context.Response.StatusCode = problem.Status ?? 500;
        Enrich(context, problem);
        if (!await context.RequestServices.GetRequiredService<IProblemDetailsService>().TryWriteAsync(
            new ProblemDetailsContext { HttpContext = context, ProblemDetails = problem }))
            await context.Response.WriteAsJsonAsync(problem, options: (JsonSerializerOptions?)null,
                contentType: "application/problem+json", cancellationToken: token);
    }

    internal static string FieldName(string key) => string.Join('.', key.TrimStart('$', '.')
        .Split('.').Select(JsonNamingPolicy.CamelCase.ConvertName));

    internal sealed record FieldError(string Code, string Message);
}

internal sealed class ApiProblemDetailsFactory : ProblemDetailsFactory
{
    public override ProblemDetails CreateProblemDetails(HttpContext httpContext, int? statusCode = null,
        string? title = null, string? type = null, string? detail = null, string? instance = null)
    {
        var problem = new ProblemDetails { Status = statusCode ?? 500, Title = title, Type = type, Detail = detail, Instance = instance };
        ApiProblems.Enrich(httpContext, problem);
        return problem;
    }

    public override ValidationProblemDetails CreateValidationProblemDetails(HttpContext httpContext,
        ModelStateDictionary modelStateDictionary, int? statusCode = null, string? title = null,
        string? type = null, string? detail = null, string? instance = null)
    {
        // Never echo attempted values, converter messages, JSON paths containing unknown
        // property names, CLR type names or internal exceptions from model binding.
        var safe = new ModelStateDictionary();
        foreach (var entry in modelStateDictionary)
            foreach (var error in entry.Value.Errors)
                safe.AddModelError(entry.Key, error.Exception is null && LocalizedValidationMetadata.IsSafe(error.ErrorMessage)
                    ? error.ErrorMessage : "Dữ liệu không đúng định dạng. Kiểm tra kiểu dữ liệu, ngày (yyyy-MM-dd) và các lựa chọn hợp lệ.");
        var problem = new ValidationProblemDetails(safe)
        { Status = statusCode ?? 400, Title = title, Type = type, Detail = detail, Instance = instance };
        ApiProblems.Enrich(httpContext, problem);
        return problem;
    }
}
