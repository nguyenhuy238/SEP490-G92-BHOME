using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Compact24;

public sealed class MainDraftReleaseBeforeAccountsTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private sealed class Renderer : IMainDraftRenderer
    {
        public string TemplateHash => "synthetic-main-template";
        public bool SigningReviewAvailable => true;
        public Task<byte[]> DocxAsync(MainDraftRenderData data, CancellationToken t) => Task.FromResult("SYNTHETIC DOCX"u8.ToArray());
        public Task<byte[]> PdfAsync(byte[] source, CancellationToken t)
        {
            using var output = new MemoryStream();
            using (var pdf = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfWriter(output))) pdf.AddNewPage();
            return Task.FromResult(output.ToArray());
        }
    }
    [CompactPostgresFact]
    public async Task ReviewedMainReleasesBeforeAccountCreationWithCanonicalOtpDocument()
    {
        using var host = fixture.Factory!.WithWebHostBuilder(b => {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string,string?> {
                ["IdentityProtection:ActiveEncryptionVersion"]="test", ["IdentityProtection:ActiveHmacVersion"]="test",
                ["IdentityProtection:EncryptionKeys:test"]=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                ["IdentityProtection:HmacKeys:test"]=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) }));
            b.ConfigureTestServices(s => { s.AddSingleton<IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage()); s.RemoveAll<IMainDraftRenderer>(); s.AddSingleton<IMainDraftRenderer,Renderer>(); });
        });
        await Compact24SampleSeed.RunAsync(host.Services,"Development",WorkflowTestUsers.Password);
        using var owner = host.CreateClient(); using var staff = host.CreateClient();
        async Task Login(HttpClient c, string email) {
            var response=await c.PostAsJsonAsync("/api/v1/auth/login",new{email,password=WorkflowTestUsers.Password}); response.EnsureSuccessStatusCode();
            c.DefaultRequestHeaders.Authorization=new("Bearer",(await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        }
        await Login(owner,"owner.sample@example.invalid"); await Login(staff,"staff.sample@example.invalid");
        var today=DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7)); var room=Compact24SampleSeed.Id(41); var ownerId=Compact24SampleSeed.Id(1);
        Guid resident; Guid location; int beforeUsers;
        await using(var scope=host.Services.CreateAsyncScope()) {
            var db=scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); beforeUsers=await db.Users.CountAsync();
            location=await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r=>r.Id==room).Select(r=>r.LocationId).SingleAsync();
            var person=new Resident{RoomId=room,OwnerUserId=ownerId,DisplayLabel="SYNTHETIC",ContactEmail=$"{Guid.NewGuid():N}@example.invalid",VerificationStatus=IdentityVerificationStatus.Verified};
            var identity=new IdentityConfirmation(true,"000000000123","SYNTHETIC",new(2000,1,1),"Synthetic address","VN",null,null,new(2020,1,1),new(2030,1,1));
            var bytes=JsonSerializer.SerializeToUtf8Bytes(identity);
            try { person.IdentityData=JsonSerializer.Serialize(scope.ServiceProvider.GetRequiredService<IIdentityProtection>().Encrypt(bytes,new(ownerId,person.Id))); } finally { CryptographicOperations.ZeroMemory(bytes); }
            db.Add(person); await db.SaveChangesAsync(); resident=person.Id;
        }
        var root="/api/v1/contracts/main-drafts";
        var settings=new MainContractSettingsInput(ownerId,today,null,3000000,"Synthetic monthly payment terms","Synthetic terms",new("SYNTHETIC OWNER",new(1980,1,1),"000000000456",new(2020,1,1),"Synthetic issuer","Synthetic address","0000000000"),0);
        (await owner.PutAsJsonAsync(root+"/settings/"+location,settings)).EnsureSuccessStatusCode();
        async Task<HttpResponseMessage> Post(HttpClient c,string path,object body,Guid key) {
            using var request=new HttpRequestMessage(HttpMethod.Post,path){Content=JsonContent.Create(body)};request.Headers.Add("Idempotency-Key",key.ToString());return await c.SendAsync(request);
        }
        var created=await Post(staff,root,new MainDraftInput(room,resident,[resident],today,today.AddMonths(6),"Synthetic notes","0000000001","Synthetic issuer"),Guid.NewGuid());
        Assert.True(created.IsSuccessStatusCode,await created.Content.ReadAsStringAsync()); var draft=(await created.Content.ReadFromJsonAsync<MainDraftView>())!;
        var response=await staff.PostAsync($"{root}/{draft.Id}/signing-review",null);response.EnsureSuccessStatusCode();var review=(await response.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        var input=new MainDraftReleaseInput(null,draft.Version,review.Id,true);var key=Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden,(await Post(staff,$"{root}/{draft.Id}/release",input,key)).StatusCode);
        (await Post(owner,$"{root}/{draft.Id}/release",input,key)).EnsureSuccessStatusCode();
        (await Post(owner,$"{root}/{draft.Id}/release",input,key)).EnsureSuccessStatusCode();
        await using var check=host.Services.CreateAsyncScope(); var savedDb=check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var c=await savedDb.Set<Contract>().Include(c=>c.Residents).SingleAsync(c=>c.Id==draft.Id);
        Assert.Equal(ContractStatus.PendingSigning,c.Status);Assert.Null(c.TenantUserId);Assert.Equal(ContractSigningModes.Internal,c.SigningMode);
        var document=new ContractDocument(c.Id,c.RoomId,c.OwnerSignerId,Guid.Empty,c.RepresentativeResidentId,c.Residents.Select(r=>r.ResidentId).Order().ToArray(),c.StartDate,c.EndDate,c.MonthlyRent,c.RequiredDeposit,c.HoldingContractId,c.AppliedHoldingDeposit,c.Terms,""){IsInternalResidentAcceptance=true};
        Assert.Equal(ContractDocumentSnapshot.Hash(document),c.SnapshotHash);
        var pdf=await check.ServiceProvider.GetRequiredService<IContractSigningDocumentSource>().ReadAsync(document with{SnapshotHash=c.SnapshotHash},default);
        Assert.NotNull(pdf);Assert.True(pdf!.AsSpan(0,5).SequenceEqual("%PDF-"u8));Assert.Equal(beforeUsers,await savedDb.Users.CountAsync());
        Assert.Null((await savedDb.Set<Resident>().SingleAsync(r=>r.Id==resident)).TenantUserId);
    }
}
