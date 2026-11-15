using BHome.Application.IdentityAccess;

namespace BHome.Application.UnitTests.IdentityAccess;

public sealed class ContactPhoneTests
{
    [Theory]
    [InlineData("0912 345 678", "+84912345678")]
    [InlineData("+84 (912) 345-678", "+84912345678")]
    [InlineData("024 1234 5678", "+842412345678")]
    [InlineData("+1 202 555 0100", "+12025550100")]
    public void CanonicalizesSupportedContactFormats(string value, string expected) => Assert.Equal(expected, ContactPhone.Normalize(value));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("1234567890")]
    [InlineData("09000000000")]
    [InlineData("+840912345678")]
    [InlineData("0912ABC678")]
    [InlineData("+0123456789")]
    [InlineData("+849123456789")]
    public void RejectsInvalidNewContacts(string? value) => Assert.Null(ContactPhone.Normalize(value));
}
