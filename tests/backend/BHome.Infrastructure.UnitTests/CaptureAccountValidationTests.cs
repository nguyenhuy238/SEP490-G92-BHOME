using BHome.Application.Common;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;

namespace BHome.Infrastructure.UnitTests;

public sealed class CaptureAccountValidationTests
{
    [Theory]
    [InlineData("DuplicateUserName", "userName")]
    [InlineData("InvalidUserName", "userName")]
    [InlineData("DuplicateEmail", "email")]
    [InlineData("InvalidEmail", "email")]
    [InlineData("PasswordTooShort", "password")]
    [InlineData("PasswordRequiresNonAlphanumeric", "password")]
    [InlineData("PasswordRequiresDigit", "password")]
    [InlineData("PasswordRequiresLower", "password")]
    [InlineData("PasswordRequiresUpper", "password")]
    [InlineData("PasswordRequiresUniqueChars", "password")]
    public void KnownIdentityFailuresReturnSafeDeterminableFields(string code, string field)
    {
        var error = Assert.IsType<InputValidationException>(CaptureRepository.AccountValidationFailure([code]));
        Assert.Equal("validation_error", error.Message);
        Assert.Single(error.Errors);
        Assert.Contains(error.Errors[field][0], new[]
        {
            "Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.",
            "Tên đăng nhập không đúng định dạng. Vui lòng kiểm tra lại.",
            "Email đã được sử dụng. Kiểm tra lại hoặc chọn email khác.",
            "Email không đúng định dạng. Ví dụ: ten@gmail.com",
            "Mật khẩu chưa đáp ứng yêu cầu bảo mật. Vui lòng chọn mật khẩu khác."
        });
    }

    [Fact]
    public void MultipleIdentityFailuresAreAggregatedAndDuplicateMessagesAreRemoved()
    {
        var error = Assert.IsType<InputValidationException>(CaptureRepository.AccountValidationFailure(
            ["DuplicateEmail", "PasswordTooShort", "PasswordRequiresDigit", "InvalidUserName"]));
        Assert.Equal(3, error.Errors.Count);
        Assert.Single(error.Errors["password"]);
    }

    [Theory]
    [InlineData("PRIVATE_TEST_DETAIL synthetic@example.invalid")]
    [InlineData("DefaultError")]
    public void UnknownIdentityFailuresCannotBecomePublicErrorCodes(string identityCode)
    {
        var error = Assert.IsType<CaptureValidationException>(CaptureRepository.AccountValidationFailure([identityCode]));
        Assert.Equal("staff_account_invalid", error.Code);
        Assert.DoesNotContain(identityCode, error.Message);
        Assert.DoesNotContain("PRIVATE_TEST_DETAIL", error.Code);
    }

    [Fact]
    public void EmptyIdentityFailureHasAStableSafeFallback()
    {
        var error = Assert.IsType<CaptureValidationException>(CaptureRepository.AccountValidationFailure([]));
        Assert.Equal("staff_account_invalid", error.Code);
    }
}
