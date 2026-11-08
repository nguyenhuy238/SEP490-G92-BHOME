using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Ocr;

public sealed class OcrWorkflowTests
{
    [Theory]
    [InlineData(OcrDocumentKind.MechanicalWater)]
    [InlineData(OcrDocumentKind.DigitalWater)]
    [InlineData(OcrDocumentKind.MechanicalElectricity)]
    [InlineData(OcrDocumentKind.DigitalElectricity)]
    public async Task AssignedMeterSelectsOnlyTheTrustedServerProfile(OcrDocumentKind kind)
    {
        var (service, resources, ocr, id) = MeterWorkflow(kind, 2, null);
        using var input = new MemoryStream();
        ocr.ExtractAsync(input, kind, Arg.Any<CancellationToken>()).Returns(
            new OcrProposal(new Dictionary<string, string> { ["reading"] = "00012345" }, "synthetic"));
        var result = await service.MeterAsync(id, input, default);
        Assert.Equal("000123.45", result.ProposedFields["reading"]);
        Assert.True(result.RequiresConfirmation);
        await ocr.Received(1).ExtractAsync(input, kind, Arg.Any<CancellationToken>());
        await resources.Received(1).RecordMeterProposalAsync(id, result, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null, 2, null, "meter_profile_unavailable")]
    [InlineData(-1, 2, null, "meter_profile_unavailable")]
    [InlineData((int)OcrDocumentKind.MechanicalWater, -1, null, "invalid_meter_precision")]
    [InlineData((int)OcrDocumentKind.MechanicalWater, 5, null, "invalid_meter_precision")]
    [InlineData((int)OcrDocumentKind.MechanicalWater, 2, -1, "invalid_previous_reading")]
    public async Task InvalidServerMetadataReturnsReviewWithoutReadingAnImage(int? kind, int precision, int? previous, string warning)
    {
        var (service, resources, ocr, id) = MeterWorkflow((OcrDocumentKind?)kind, precision, previous);
        using var input = new MemoryStream([1, 2, 3]);
        var result = await service.MeterAsync(id, input, default);
        Assert.True(result.IsFallback);
        Assert.True(result.RequiresConfirmation);
        Assert.True(result.ManualEntryAvailable);
        Assert.Empty(result.ProposedFields);
        Assert.Contains("reading", result.MissingFields);
        Assert.Equal(new[] { warning }, result.Warnings);
        Assert.Null(result.SourceImageHash);
        Assert.Equal(0, input.Position);
        await ocr.DidNotReceive().ExtractAsync(Arg.Any<Stream>(), Arg.Any<OcrDocumentKind>(), Arg.Any<CancellationToken>());
        await resources.Received(1).RecordMeterProposalAsync(id, result, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AuthorizationPrecedesMetadataReviewAndNeverClearsAnotherLocationsProposal()
    {
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(Roles.Staff).Returns(true);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var id = Guid.NewGuid();
        resources.FindMeterTaskAsync(id, Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(
            new ResourceScope(Guid.NewGuid(), null), true, null));
        var ocr = Substitute.For<IOcrService>();
        var service = new OcrWorkflowService(resources, new ResourceAccess(user, Substitute.For<IStaffLocationAccess>()), ocr);
        using var input = new MemoryStream([1, 2, 3]);
        await Assert.ThrowsAsync<OcrAccessException>(() => service.MeterAsync(id, input, default));
        Assert.Equal(0, input.Position);
        await resources.DidNotReceive().RecordMeterProposalAsync(Arg.Any<Guid>(), Arg.Any<OcrProposal>(), Arg.Any<CancellationToken>());
    }

    private static (OcrWorkflowService Service, IOcrWorkflowResources Resources, IOcrService Ocr, Guid Id)
        MeterWorkflow(OcrDocumentKind? kind, int precision, decimal? previous,IExperimentalMeterOcrService? experimental=null)
    {
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(Roles.Staff).Returns(true);
        var assignments = Substitute.For<IStaffLocationAccess>();
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var id = Guid.NewGuid();
        resources.FindMeterTaskAsync(id, Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(
            new ResourceScope(Guid.NewGuid(), null), true, kind, precision, previous));
        var ocr = Substitute.For<IOcrService>();
        return (new OcrWorkflowService(resources, new ResourceAccess(user, assignments), ocr,experimental), resources, ocr, id);
    }

    [Theory]
    [InlineData(OcrDocumentKind.DigitalElectricity)]
    [InlineData(OcrDocumentKind.MechanicalElectricity)]
    [InlineData(OcrDocumentKind.DigitalWater)]
    [InlineData(OcrDocumentKind.MechanicalWater)]
    public async Task AssignedDiagnosticsUseServerKindWithoutPersistingAProposal(OcrDocumentKind kind)
    {
        var experimental=Substitute.For<IExperimentalMeterOcrService>();
        var (service,resources,ocr,id)=MeterWorkflow(kind,2,null,experimental);
        using var input=new MemoryStream([1,2,3]);
        experimental.ExtractAssignedMeterAsync(input,kind,Arg.Any<CancellationToken>()).Returns(
            ExperimentalMeterOcrResult.Unavailable("synthetic_model_unavailable"));
        var result=await service.ExperimentalMeterAsync(id,input,default);
        Assert.True(result.Experimental);Assert.False(result.BusinessProposalEnabled);
        Assert.Contains("trusted_meter_profile",result.Warnings);Assert.Contains("trusted_meter_precision_available",result.Warnings);
        await experimental.Received(1).ExtractAssignedMeterAsync(input,kind,Arg.Any<CancellationToken>());
        await resources.DidNotReceive().RecordMeterProposalAsync(Arg.Any<Guid>(),Arg.Any<OcrProposal>(),Arg.Any<CancellationToken>());
        await ocr.DidNotReceive().ExtractAsync(Arg.Any<Stream>(),Arg.Any<OcrDocumentKind>(),Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AssignedDiagnosticsRejectInvalidMetadataBeforeConsumingPixels()
    {
        var experimental=Substitute.For<IExperimentalMeterOcrService>();
        var (service,resources,_,id)=MeterWorkflow(OcrDocumentKind.DigitalElectricity,5,null,experimental);
        using var input=new MemoryStream([1,2,3]);
        var result=await service.ExperimentalMeterAsync(id,input,default);
        Assert.Equal("unavailable",result.Status);Assert.Contains("invalid_meter_precision",result.Warnings);
        Assert.Equal(0,input.Position);
        await experimental.DidNotReceive().ExtractAssignedMeterAsync(Arg.Any<Stream>(),Arg.Any<OcrDocumentKind>(),Arg.Any<CancellationToken>());
        await resources.DidNotReceive().RecordMeterProposalAsync(Arg.Any<Guid>(),Arg.Any<OcrProposal>(),Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AssignedDiagnosticsCheckLocationAndTaskStateBeforeInference()
    {
        var user=Substitute.For<ICurrentUser>();user.UserId.Returns(Guid.NewGuid());user.IsInRole(Roles.Staff).Returns(true);
        var assignments=Substitute.For<IStaffLocationAccess>();
        var resources=Substitute.For<IOcrWorkflowResources>();var id=Guid.NewGuid();
        resources.FindMeterTaskAsync(id,Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(new(Guid.NewGuid(),null),false,OcrDocumentKind.DigitalElectricity,2));
        var experimental=Substitute.For<IExperimentalMeterOcrService>();
        var service=new OcrWorkflowService(resources,new ResourceAccess(user,assignments),Substitute.For<IOcrService>(),experimental);
        using var input=new MemoryStream([1,2,3]);
        await Assert.ThrowsAsync<OcrAccessException>(()=>service.ExperimentalMeterAsync(id,input,default));
        assignments.IsAssignedAsync(Arg.Any<Guid>(),Arg.Any<Guid>(),Arg.Any<CancellationToken>()).Returns(true);
        await Assert.ThrowsAsync<OcrWorkflowStateException>(()=>service.ExperimentalMeterAsync(id,input,default));
        Assert.Equal(0,input.Position);
        await experimental.DidNotReceive().ExtractAssignedMeterAsync(Arg.Any<Stream>(),Arg.Any<OcrDocumentKind>(),Arg.Any<CancellationToken>());
        await resources.DidNotReceive().RecordMeterProposalAsync(Arg.Any<Guid>(),Arg.Any<OcrProposal>(),Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("00999", true)]
    [InlineData("01000", false)]
    [InlineData("01001", false)]
    public async Task PreviousConfirmedReadingAddsAnAdvisoryWithoutChangingTheObservedValue(string reading, bool warning)
    {
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(Roles.Staff).Returns(true);
        var assignments = Substitute.For<IStaffLocationAccess>();
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var id = Guid.NewGuid();
        resources.FindMeterTaskAsync(id, Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(
            new ResourceScope(Guid.NewGuid(), null), true, OcrDocumentKind.MechanicalWater, 1, 100m));
        var ocr = Substitute.For<IOcrService>();
        ocr.ExtractAsync(Arg.Any<Stream>(), OcrDocumentKind.MechanicalWater, Arg.Any<CancellationToken>()).Returns(
            new OcrProposal(new Dictionary<string, string> { ["reading"] = reading }, "synthetic"));
        var service = new OcrWorkflowService(resources, new ResourceAccess(user, assignments), ocr);
        using var input = new MemoryStream();
        var proposal = await service.MeterAsync(id, input, default);
        Assert.Equal(reading.Insert(reading.Length - 1, "."), proposal.ProposedFields["reading"]);
        Assert.Equal(warning, proposal.Warnings.Contains("reading_below_previous"));
        Assert.True(proposal.RequiresConfirmation);
        await resources.Received(1).RecordMeterProposalAsync(id, proposal, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(Roles.Owner, true)]
    [InlineData(Roles.Tenant, true)]
    [InlineData(Roles.Staff, false)]
    public async Task UnauthorizedMeterAccessDoesNotReadTheImageOrPersistAProposal(string role, bool assigned)
    {
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(role).Returns(true);
        var assignments = Substitute.For<IStaffLocationAccess>();
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(assigned);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var id = Guid.NewGuid();
        resources.FindMeterTaskAsync(id, Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(
            new ResourceScope(Guid.NewGuid(), null), true, OcrDocumentKind.DigitalWater));
        var ocr = Substitute.For<IOcrService>();
        var service = new OcrWorkflowService(resources, new ResourceAccess(user, assignments), ocr);
        using var input = new MemoryStream();
        await Assert.ThrowsAsync<OcrAccessException>(() => service.MeterAsync(id, input, default));
        await ocr.DidNotReceive().ExtractAsync(Arg.Any<Stream>(), Arg.Any<OcrDocumentKind>(), Arg.Any<CancellationToken>());
        await resources.DidNotReceive().RecordMeterProposalAsync(Arg.Any<Guid>(), Arg.Any<OcrProposal>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MeterUsesServerPrecisionBeforeRecordingTheProposal()
    {
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(Roles.Staff).Returns(true);
        var assignments = Substitute.For<IStaffLocationAccess>();
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var resources = Substitute.For<IOcrWorkflowResources>();
        var id = Guid.NewGuid();
        resources.FindMeterTaskAsync(id, Arg.Any<CancellationToken>()).Returns(new OcrWorkflowResource(
            new ResourceScope(Guid.NewGuid(), null), true, OcrDocumentKind.DigitalElectricity, 1));
        var ocr = Substitute.For<IOcrService>();
        ocr.ExtractAsync(Arg.Any<Stream>(), OcrDocumentKind.DigitalElectricity, Arg.Any<CancellationToken>()).Returns(
            new OcrProposal(new Dictionary<string, string> { ["reading"] = "032514" }, "synthetic"));
        var service = new OcrWorkflowService(resources, new ResourceAccess(user, assignments), ocr);
        using var input = new MemoryStream();
        var proposal = await service.MeterAsync(id, input, default);
        Assert.Equal("03251.4", proposal.ProposedFields["reading"]);
        await resources.Received(1).RecordMeterProposalAsync(id,
            Arg.Is<OcrProposal>(value => value.ProposedFields["reading"] == "03251.4" && value.RequiresConfirmation), Arg.Any<CancellationToken>());
    }

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
