using System.ComponentModel.DataAnnotations;

namespace BHome.Application.IdentityAccess;

/// <summary>Uses the same contact-write rule as the service, independently of login aliases.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class ContactPhoneNumberAttribute : ValidationAttribute
{
    public const string InvalidMessage = "Nhập số điện thoại Việt Nam hợp lệ hoặc số quốc tế có mã nước (+).";
    public ContactPhoneNumberAttribute() => ErrorMessage = InvalidMessage;
    public override bool IsValid(object? value) => value is null || value is string phone &&
        (string.IsNullOrWhiteSpace(phone) || ContactPhone.Normalize(phone) is not null);
}
