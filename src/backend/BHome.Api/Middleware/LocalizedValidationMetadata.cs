using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc.ModelBinding.Metadata;

namespace BHome.Api.Middleware;

internal sealed class LocalizedValidationMetadata : IValidationMetadataProvider, IDisplayMetadataProvider
{
    private static readonly Dictionary<string, string> Labels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["FullName"] = "họ và tên",
        ["Name"] = "tên",
        ["Email"] = "email",
        ["Phone"] = "số điện thoại",
        ["Address"] = "địa chỉ",
        ["Password"] = "mật khẩu",
        ["NewPassword"] = "mật khẩu mới",
        ["ConfirmPassword"] = "mật khẩu xác nhận",
        ["CurrentPassword"] = "mật khẩu hiện tại",
        ["Employment"] = "thông tin công việc",
        ["EmploymentType"] = "loại công việc",
        ["StartDate"] = "ngày bắt đầu",
        ["EndDate"] = "ngày kết thúc",
        ["BaseRate"] = "mức lương",
        ["Status"] = "trạng thái",
        ["Reason"] = "lý do",
        ["Description"] = "mô tả",
        ["RoomNumber"] = "số phòng",
        ["Area"] = "diện tích",
        ["Capacity"] = "sức chứa",
        ["Amount"] = "số tiền",
        ["Page"] = "trang",
        ["PageSize"] = "số dòng mỗi trang"
    };

    internal static bool IsVietnamese(string text) => text.Any(c => c > 127);
    internal static bool IsSafe(string text) => IsVietnamese(text) &&
        !text.StartsWith("The ", StringComparison.Ordinal) && !text.StartsWith("A non-empty", StringComparison.Ordinal) &&
        !text.Contains('\n') && !text.Contains('\r');

    public void CreateDisplayMetadata(DisplayMetadataProviderContext context)
    {
        if (context.Key.Name is { } name && Labels.TryGetValue(name, out var label))
            context.DisplayMetadata.DisplayName = () => label;
    }

    public void CreateValidationMetadata(ValidationMetadataProviderContext context)
    {
        var type = Nullable.GetUnderlyingType(context.Key.ModelType) ?? context.Key.ModelType;
        if (type.IsEnum && !context.Attributes.OfType<EnumDataTypeAttribute>().Any())
            context.ValidationMetadata.ValidatorMetadata.Add(new EnumDataTypeAttribute(type)
            { ErrorMessage = "{0} không hợp lệ. Vui lòng chọn giá trị được hỗ trợ." });
        foreach (var attribute in context.Attributes.OfType<ValidationAttribute>()
                     .Concat(context.ValidationMetadata.ValidatorMetadata.OfType<ValidationAttribute>()).Distinct())
        {
            if (attribute.ErrorMessageResourceType is not null ||
                attribute.ErrorMessage is { } message && IsVietnamese(message)) continue;
            attribute.ErrorMessage = attribute switch
            {
                RequiredAttribute => "Vui lòng nhập {0}.",
                EmailAddressAttribute => "Email không đúng định dạng. Ví dụ: ten@gmail.com",
                PhoneAttribute => "Số điện thoại không đúng định dạng. Vui lòng kiểm tra lại.",
                StringLengthAttribute { MinimumLength: > 0 } => "{0} phải có từ {2} đến {1} ký tự.",
                StringLengthAttribute => "{0} không được vượt quá {1} ký tự.",
                MaxLengthAttribute => "{0} không được vượt quá {1} ký tự/phần tử.",
                MinLengthAttribute => "{0} phải có ít nhất {1} ký tự/phần tử.",
                RangeAttribute => "{0} phải nằm trong khoảng từ {1} đến {2}.",
                CompareAttribute => "{0} không khớp với {1}. Vui lòng kiểm tra lại.",
                RegularExpressionAttribute or EnumDataTypeAttribute => "{0} không hợp lệ. Vui lòng kiểm tra định dạng hoặc chọn giá trị được hỗ trợ.",
                _ => "{0} chưa hợp lệ. Vui lòng kiểm tra lại."
            };
        }
    }

    internal static string ErrorCode(string message) => message switch
    {
        var s when s.StartsWith("Vui lòng nhập", StringComparison.Ordinal) => "required_field",
        var s when s.StartsWith("Email không", StringComparison.Ordinal) => "invalid_email_format",
        var s when s.StartsWith("Nhập số điện thoại", StringComparison.Ordinal) ||
            s.StartsWith("Số điện thoại không", StringComparison.Ordinal) => "invalid_phone_number",
        "Mật khẩu xác nhận không khớp." => "password_mismatch",
        var s when s.Contains("ký tự", StringComparison.Ordinal) => "invalid_length",
        var s when s.Contains("khoảng từ", StringComparison.Ordinal) => "out_of_range",
        _ => "invalid_field"
    };
}
