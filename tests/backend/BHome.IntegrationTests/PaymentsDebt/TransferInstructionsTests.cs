using System.Net;
using System.Net.Http.Json;
using BHome.Application.PaymentsDebt;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.PaymentsDebt;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task TransferInstructionsRequireOwnerConfigurationAndDisappearAfterSettlement()
    {
        var w=await Setup();using var owner=await Client(w.Owner);using var tenant=await Client(w.Tenants[0]);using var staff=await Client(w.Staff);
        var route=$"/api/v1/invoices/{w.Invoice}/transfer-instructions";
        Assert.Equal("ReceivingAccountUnavailable",(await tenant.GetFromJsonAsync<TransferInstructions>(route))!.Availability);
        var config=new ReceivingAccountInput(w.Location,"970415","000000000000","BHOME SYNTHETIC DEMO",true,true,true,0);
        Assert.Equal(HttpStatusCode.Forbidden,(await tenant.PutAsJsonAsync("/api/v1/receiving-bank-accounts",config)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await staff.GetAsync(route)).StatusCode);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts",config)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict,(await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts",config)).StatusCode);
        var instructions=(await tenant.GetFromJsonAsync<TransferInstructions>(route))!;
        Assert.Equal("Available",instructions.Availability);Assert.True(instructions.IsDevelopmentDemo);
        Assert.Equal(100000,instructions.OutstandingAmount);Assert.Equal(PaymentRules.InvoiceReference(w.Invoice),instructions.TransferDescription);
        Assert.StartsWith("000201010212",instructions.QrPayload);Assert.StartsWith("data:image/png;base64,",instructions.QrImageDataUri);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts",config with{ExpectedVersion=1,Enabled=false})).EnsureSuccessStatusCode();
        Assert.Equal("ReceivingAccountUnavailable",(await tenant.GetFromJsonAsync<TransferInstructions>(route))!.Availability);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts",config with{ExpectedVersion=2})).EnsureSuccessStatusCode();
        var transfer=await As(w.Owner,BHome.Domain.IdentityAccess.Roles.Owner,s=>s.RegisterAsync(Input(w),Guid.NewGuid(),default));
        await As(w.Owner,BHome.Domain.IdentityAccess.Roles.Owner,s=>s.AllocateAsync(transfer.Id,new(w.Invoice,w.Tenants[0],true),Guid.NewGuid(),default));
        var settled=(await tenant.GetFromJsonAsync<TransferInstructions>(route))!;
        Assert.Equal("Settled",settled.Availability);Assert.Null(settled.QrImageDataUri);Assert.Null(settled.AccountNumber);
    }
}

public sealed class VietQrTests
{
    [Fact]
    public void SyntheticPayloadEncodesReceiverExactAmountMemoAndCrcWithoutCallingAProvider()
    {
        var generator=new VietQrGenerator();var result=generator.Generate("970415","000000000000",123456,"SYNTHETIC BILL 1")!;
        Assert.Contains("00069704150112000000000000",result.Payload);
        Assert.Contains("5406123456",result.Payload);Assert.Contains("0816SYNTHETIC BILL 1",result.Payload);
        Assert.Null(generator.Generate("970415","000000000000",10000000000000m,"SYNTHETIC BILL 1"));
        Assert.Null(generator.Generate("970415","000000000000",1,"NỘI DUNG KHÔNG ASCII"));
        using var image=Cv2.ImDecode(Convert.FromBase64String(result.PngDataUri.Split(',')[1]),ImreadModes.Grayscale);
        Assert.False(image.Empty());Assert.True(image.Width>=200);
        using var decoder=new QRCodeDetector();Assert.Equal(result.Payload,decoder.DetectAndDecode(image,out _));
    }
}
