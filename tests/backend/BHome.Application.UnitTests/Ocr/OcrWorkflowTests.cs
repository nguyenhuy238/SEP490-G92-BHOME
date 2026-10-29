using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Ocr;

public sealed class OcrWorkflowTests
{
    [Theory]
    [InlineData(Roles.Owner, true, true)]
    [InlineData(Roles.Owner, false, true)]
    [InlineData(Roles.Staff, true, true)]
    [InlineData(Roles.Staff, false, false)]
    [InlineData(Roles.Tenant, true, false)]
    public async Task IdentityRequiresServerLoadedOwnershipOrCurrentAssignment(string role, bool inScope, bool allowed)
    {
        var user = Substitute.For<ICurrentUser>();
        var userId = Guid.NewGuid();
        user.UserId.Returns(userId); user.IsInRole(role).Returns(true);
        var assignments = Substitute.For<IStaffLocationAccess>();
        assignments.IsAssignedAsync(userId, Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(inScope);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var resident = Guid.NewGuid();
        resources.FindIdentityAsync(resident, Arg.Any<CancellationToken>()).Returns(
            new OcrWorkflowResource(new ResourceScope(Guid.NewGuid(), null), true, OcrDocumentKind.IdentityFront));
        var ocr = Substitute.For<IOcrService>();
        var expected = new OcrProposal(new Dictionary<string, string>(), "test");
        ocr.ExtractAsync(Arg.Any<Stream>(), OcrDocumentKind.IdentityFront, Arg.Any<CancellationToken>()).Returns(expected);
        var service = new OcrWorkflowService(resources, new ResourceAccess(user, assignments), ocr);
        using var input = new MemoryStream();
        if (allowed) Assert.Same(expected, await service.IdentityAsync(resident, OcrDocumentKind.IdentityFront, input, default));
        else
        {
            await Assert.ThrowsAsync<OcrAccessException>(() => service.IdentityAsync(resident, OcrDocumentKind.IdentityFront, input, default));
            await ocr.DidNotReceive().ExtractAsync(Arg.Any<Stream>(), Arg.Any<OcrDocumentKind>(), Arg.Any<CancellationToken>());
        }
    }

    [Fact]
    public async Task ClosedOrMissingTaskNeverInvokesOcr()
    {
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(Roles.Staff).Returns(true);
        var assignments = Substitute.For<IStaffLocationAccess>();
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var id = Guid.NewGuid();
        var ocr = Substitute.For<IOcrService>();
        var service = new OcrWorkflowService(resources, new ResourceAccess(user, assignments), ocr);
        using var input = new MemoryStream();
        await Assert.ThrowsAsync<OcrAccessException>(() => service.MeterAsync(id, input, default));
        resources.FindMeterTaskAsync(id, Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(
            new ResourceScope(Guid.NewGuid(), null), false, OcrDocumentKind.MechanicalWater));
        await Assert.ThrowsAsync<OcrWorkflowStateException>(() => service.MeterAsync(id, input, default));
        await ocr.DidNotReceive().ExtractAsync(Arg.Any<Stream>(), Arg.Any<OcrDocumentKind>(), Arg.Any<CancellationToken>());
    }
}
