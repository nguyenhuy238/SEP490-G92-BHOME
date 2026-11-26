using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

public sealed class ContractResidentDisplayTests
{
    [Fact]
    public void ContractRepresentativeUsesConfirmedIdentityInsteadOfRoomLabelAndClearsPlaintextBuffer()
    {
        var resident = new Resident { DisplayLabel = "P302", OwnerUserId = Guid.NewGuid(), IdentityData = Envelope };
        var identity = new IdentityConfirmation(true, "000000000123", "NGƯỜI ĐẠI DIỆN KIỂM THỬ", new(1990, 1, 1), null, null, null, null, null, null);
        var protection = new Protection(JsonSerializer.SerializeToUtf8Bytes(identity));
        var display = ContractResidentDisplay.Read(resident, protection);
        Assert.Equal(identity.FullName, display.Name); Assert.Equal(identity.CitizenIdentityNumber, display.Number);
        Assert.All(protection.Buffer!, value => Assert.Equal(0, value));
    }

    [Fact]
    public void ChildWithoutIdentityStillHasItsOwnConfirmedName()
    {
        var resident = new Resident
        {
            DisplayLabel = "Thành viên hộ gia đình",
            ResidentType = ResidentType.CoOccupant,
            HouseholdConfirmedAt = DateTimeOffset.UtcNow,
            HouseholdProfile = Envelope
        };
        var protection = new Protection(JsonSerializer.SerializeToUtf8Bytes(new HouseholdMemberInput("child", "THÀNH VIÊN KIỂM THỬ", new(2020, 1, 1), "Con")));
        var display = ContractResidentDisplay.Read(resident, protection);
        Assert.Equal("THÀNH VIÊN KIỂM THỬ", display.Name); Assert.Null(display.Number);
    }
    private static string Envelope => JsonSerializer.Serialize(new EncryptedIdentity("synthetic", "synthetic", "synthetic", "test"));
    private sealed class Protection(byte[] value) : IIdentityProtection
    {
        public byte[]? Buffer { get; private set; }
        public byte[] Decrypt(EncryptedIdentity envelope, IdentityProtectionScope scope) => Buffer = value.ToArray();
        public EncryptedIdentity Encrypt(ReadOnlySpan<byte> value, IdentityProtectionScope scope) => throw new NotSupportedException();
        public IdentityMatchIndex CreateMatchIndex(string number, Guid owner) => throw new NotSupportedException();
        public IReadOnlyList<IdentityMatchIndex> CreateMatchIndexes(string number, Guid owner) => throw new NotSupportedException();
    }
}
