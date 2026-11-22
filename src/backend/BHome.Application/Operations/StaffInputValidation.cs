using System.ComponentModel.DataAnnotations;
using System.Reflection;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;

namespace BHome.Application.Operations;

internal static class StaffInputValidation
{
    public static void Validate(object input, EmploymentWrite? employment, string? phone)
    {
        var errors = new Dictionary<string, List<string>>();
        void Add(string key, string message)
        {
            if (!errors.TryGetValue(key, out var values)) errors[key] = values = [];
            if (!values.Contains(message)) values.Add(message);
        }
        void Attributes(object value, string prefix)
        {
            foreach (var parameter in value.GetType().GetConstructors().OrderByDescending(x => x.GetParameters().Length).First().GetParameters())
            {
                var field = value.GetType().GetProperty(parameter.Name!, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)!;
                var fieldValue = field.GetValue(value);
                var key = prefix + char.ToLowerInvariant(field.Name[0]) + field.Name[1..];
                foreach (var rule in parameter.GetCustomAttributes<ValidationAttribute>().Where(rule => !rule.IsValid(fieldValue)))
                    Add(key, rule switch
                    {
                        RequiredAttribute => "Vui lòng nhập đầy đủ trường này.",
                        EmailAddressAttribute => "Email không đúng định dạng. Ví dụ: ten@gmail.com",
                        ContactPhoneNumberAttribute => ContactPhoneNumberAttribute.InvalidMessage,
                        StringLengthAttribute length => $"Độ dài phải từ {length.MinimumLength} đến {length.MaximumLength} ký tự.",
                        RangeAttribute range => $"Giá trị phải từ {range.Minimum} đến {range.Maximum}.",
                        _ => "Giá trị không hợp lệ. Vui lòng kiểm tra định dạng hoặc lựa chọn."
                    });
            }
        }
        Attributes(input, "");
        if (!string.IsNullOrWhiteSpace(phone) && ContactPhone.Normalize(phone) is null)
            Add("phone", ContactPhoneNumberAttribute.InvalidMessage);
        if (employment is null) Add("employment", "Vui lòng nhập thông tin công việc.");
        else
        {
            Attributes(employment, "employment.");
            if (employment.StartDate == default) Add("employment.startDate", "Vui lòng nhập ngày bắt đầu hợp lệ.");
            if (employment.EndDate < employment.StartDate) Add("employment.endDate", "Ngày kết thúc không được trước ngày bắt đầu.");
            if (employment.Status == "Ended" && employment.EndDate is null)
                Add("employment.endDate", "Vui lòng nhập ngày kết thúc khi công việc đã kết thúc.");
            if (employment.BaseRate is { } rate && decimal.Truncate(rate) != rate)
                Add("employment.baseRate", "Mức lương VND phải là số nguyên.");
        }
        if (errors.Count > 0) throw new InputValidationException(errors.ToDictionary(x => x.Key, x => x.Value.ToArray()));
    }
}
