using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using BHome.Domain.Locations;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Minio;
using Minio.DataModel.Args;

namespace BHome.ContractVerification;

// Real browser -> production HTTP pipeline -> disposable Compact24. No route mocks or test API.
internal static class FinanceVerificationCli
{
    public static async Task<int> RunAsync(bool mainDraft = false)
    {
        if(string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")))
            throw new InvalidOperationException("Set loopback disposable PostgreSQL admin configuration.");
        var root=Directory.GetCurrentDirectory();var temporary=Directory.CreateTempSubdirectory("bhome-finance-verification-");
        const string contentRootKey="ASPNETCORE_TEST_CONTENTROOT_BHOME_API";
        var priorContentRoot=Environment.GetEnvironmentVariable(contentRootKey);
        Environment.SetEnvironmentVariable(contentRootKey,Path.Combine(root,"src/backend/BHome.Api"));
        var fixture=new Compact24Fixture();Process? api=null;IContainer? minio=null;var stage="initialization";
        try
        {
            await fixture.InitializeAsync();
            var email=$"finance-{Guid.NewGuid():N}@example.invalid";var password="Synthetic!"+Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            var actors=new Dictionary<string,object>();
            Guid locationId;
            await using(var scope=fixture.Factory!.Services.CreateAsyncScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
                var user=new ApplicationUser{Id=Guid.NewGuid(),UserName=email,Email=email,IsActive=true};db.PrepareUserRole(user,"Owner");
                var result=await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().CreateAsync(user,password);
                if(!result.Succeeded)throw new InvalidOperationException("Synthetic account creation failed.");
                actors["owner"]=new{id=user.Id,email,password};
                if(mainDraft)foreach(var (name,role) in new[]{("staff","Staff"),("tenant","Tenant"),("coTenant1","Tenant"),("coTenant2","Tenant"),("otherTenant","Tenant")})
                {
                    var account=new ApplicationUser{Id=Guid.NewGuid(),Email=$"draft-{Guid.NewGuid():N}@example.invalid",IsActive=true};account.UserName=account.Email;
                    db.PrepareUserRole(account,role);
                    if(!(await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().CreateAsync(account,password)).Succeeded)throw new InvalidOperationException("Synthetic account creation failed.");
                    actors[name]=new{id=account.Id,email=account.Email,password};
                }
                var chain=new Chain{Name="Synthetic Finance Chain"};db.Add(chain);await db.SaveChangesAsync();
                var location=new Location("Cơ sở kiểm thử tài chính"){ChainId=chain.Id,Address="Địa chỉ tổng hợp"};locationId=location.Id;
                var type=new RoomType{LocationId=location.Id,Name="Synthetic",DefaultCapacity=3};
                var room=new Room{LocationId=location.Id,RoomTypeId=type.Id,RoomNumber="FIN-01",Capacity=3,Status=RoomStatus.Available};db.AddRange(location,type,room);
                if(mainDraft)db.Add(new Asset{LocationId=location.Id,RoomId=room.Id,Name="SYNTHETIC EXPENSE ASSET",Category="Furniture",Condition="Tốt"});
                // Pre-existing synthetic rate configuration is the only dated business fixture.
                // Live policy APIs correctly forbid backdating. Readings, contracts, invoices,
                // approvals and payments below must still be created through actual client APIs.
                if(mainDraft)
                {
                    var priorDay=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow,"Asia/Ho_Chi_Minh").DateTime).AddDays(-1);
                    foreach(var (code,category,rate) in new[]{("RENT",ChargeCategory.Rent,3000000m),("ELECTRICITY",ChargeCategory.Electricity,3500m),("WATER",ChargeCategory.Water,18000m)})
                        db.Add(new BillingPolicy{LocationId=location.Id,ChargeCode=code,Category=category,Name=code,
                            Method=category==ChargeCategory.Rent?ChargingMethod.FixedPerRoomPerMonth:ChargingMethod.Metered,Rate=rate,EffectiveFrom=priorDay});
                }
                await db.SaveChangesAsync();
            }
            using var key=RSA.Create(2048);var request=new CertificateRequest("CN=localhost",key,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
            var san=new SubjectAlternativeNameBuilder();san.AddDnsName("localhost");request.CertificateExtensions.Add(san.Build());
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true,false,0,true));
            using var certificate=request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5),DateTimeOffset.UtcNow.AddHours(1));
            var pfxPath=Path.Combine(temporary.FullName,"server.pfx");var caPath=Path.Combine(temporary.FullName,"ca.pem");
            var pfxPassword=Convert.ToHexString(RandomNumberGenerator.GetBytes(16));await File.WriteAllBytesAsync(pfxPath,certificate.Export(X509ContentType.Pfx,pfxPassword));await File.WriteAllTextAsync(caPath,certificate.ExportCertificatePem());
            var apiPort=Port();var webPort=Port();var baseUrl=$"https://localhost:{apiPort}";var origin=$"https://localhost:{webPort}";
            var start=new ProcessStartInfo("dotnet"){WorkingDirectory=Path.Combine(root,"src/backend/BHome.Api"),UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
            start.ArgumentList.Add(Path.Combine(root,"src/backend/BHome.Api/bin/Debug/net8.0/BHome.Api.dll"));
            var systemVariables=new[]{"PATH","SystemRoot","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME","DOTNET_ROOT","ComSpec","SystemDrive","ProgramFiles","ProgramFiles(x86)"}.ToDictionary(k=>k,Environment.GetEnvironmentVariable);
            start.Environment.Clear();foreach(var pair in systemVariables.Where(p=>p.Value is not null))start.Environment[pair.Key]=pair.Value;
            start.Environment["IdentityProtection__ActiveEncryptionVersion"]="test";
            start.Environment["IdentityProtection__ActiveHmacVersion"]="test";
            start.Environment["IdentityProtection__EncryptionKeys__test"]=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            start.Environment["IdentityProtection__HmacKeys__test"]=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            if(mainDraft)
            {
                var storagePassword=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
                minio=new ContainerBuilder("bhome/minio-local:2025-10-15").WithEnvironment("MINIO_ROOT_USER","synthetic-test").WithEnvironment("MINIO_ROOT_PASSWORD",storagePassword)
                    .WithCommand("server","/data").WithPortBinding(9000,true).WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r=>r.ForPort(9000).ForPath("/minio/health/live"))).Build();
                await minio.StartAsync();var endpoint=$"{minio.Hostname}:{minio.GetMappedPublicPort(9000)}";
                using var storage=new MinioClient().WithEndpoint(endpoint).WithCredentials("synthetic-test",storagePassword).Build();
                await storage.MakeBucketAsync(new MakeBucketArgs().WithBucket("draft-browser"));
                foreach(var pair in new Dictionary<string,string>{["ObjectStorage__Endpoint"]=endpoint,["ObjectStorage__UseSsl"]="false",["ObjectStorage__Bucket"]="draft-browser",["ObjectStorage__AccessKey"]="synthetic-test",["ObjectStorage__SecretKey"]=storagePassword,["ContractWorkflow__SimulatedSigningEnabled"]="true",["MainDraft__LibreOfficeContainerImage"]="bhome/contract-converter:local",["DigitalSigning__Viettel__BaseUrl"]="",["DigitalSigning__Viettel__ClientId"]="",["DigitalSigning__Viettel__ClientSecret"]=""})start.Environment[pair.Key]=pair.Value;
            }
            foreach(var pair in new Dictionary<string,string>{["DOTNET_ENVIRONMENT"]="Testing",["ASPNETCORE_URLS"]=baseUrl,["ConnectionStrings__Database"]=fixture.Connection,["Kestrel__Certificates__Default__Path"]=pfxPath,["Kestrel__Certificates__Default__Password"]=pfxPassword,["Jwt__SigningKey"]=Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)),["Cors__AllowedOrigins__0"]=origin,["AuthWeb__AllowedOrigins__0"]=origin,["Ocr__Enabled"]="false",["Jobs__Enabled"]="false",["Logging__LogLevel__Default"]="Warning"})start.Environment[pair.Key]=pair.Value;
            stage="production API";api=Process.Start(start)!;api.OutputDataReceived+=(_,_)=>{};api.ErrorDataReceived+=(_,_)=>{};api.BeginOutputReadLine();api.BeginErrorReadLine();
            // Pin only this generated test certificate; never disable production TLS validation.
            using var handler=new HttpClientHandler{ServerCertificateCustomValidationCallback=(_,cert,_,_)=>cert?.Thumbprint==certificate.Thumbprint};
            using var client=new HttpClient(handler){Timeout=TimeSpan.FromSeconds(2)};var ready=false;
            for(var attempt=0;attempt<60 && !api.HasExited;attempt++){try{ready=(await client.GetAsync(baseUrl+"/health/ready")).IsSuccessStatusCode;}catch(HttpRequestException){}catch(TaskCanceledException){}if(ready)break;await Task.Delay(500);}
            if(!ready)throw new InvalidOperationException("Disposable API did not become ready.");
            var nodeStart=new ProcessStartInfo(Path.Combine(root,".tools/node-v22.23.4-win-x64/node.exe")){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardInput=true};
            nodeStart.ArgumentList.Add(Path.Combine(root,"scripts/Verify-FinanceClients.cjs"));nodeStart.Environment.Remove("NODE_TLS_REJECT_UNAUTHORIZED");nodeStart.Environment.Remove("NODE_OPTIONS");nodeStart.Environment["NODE_EXTRA_CA_CERTS"]=caPath;
            using var node=Process.Start(nodeStart)!;stage="browser workflows";
            await node.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new{baseUrl,origin,webPort,pfxPath,pfxPassword,temporary=temporary.FullName,email,password,locationId,mainDraft,actors}));node.StandardInput.Close();await node.WaitForExitAsync();
            if(node.ExitCode==0 && mainDraft)
            {
                stage="shared invoice ledger assertions";
                await using var scope=fixture.Factory!.Services.CreateAsyncScope();
                var db=scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
                var invoice=await db.Set<Invoice>().AsNoTracking().Include(i=>i.Recipients).Include(i=>i.Lines).AsSplitQuery().SingleAsync();
                if(invoice.Status!=InvoiceStatus.Final || invoice.Total!=3430000 || invoice.Recipients.Count!=3 || invoice.Lines.Count!=3)
                    throw new InvalidOperationException("Shared invoice/recipient invariant failed.");
                var allocations=await db.Set<PaymentAllocation>().AsNoTracking().ToArrayAsync();
                if(allocations.Length!=2 || allocations.Sum(a=>a.Amount)!=3410000 || allocations.Select(a=>a.PaidByUserId).Distinct().Count()!=2)
                    throw new InvalidOperationException("Shared invoice allocation invariant failed.");
                if(await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM refund_requests WHERE status='COMPLETED' AND requested_amount=10000 AND execution_evidence_key IS NOT NULL").SingleAsync()!=1)
                    throw new InvalidOperationException("Expected one explicitly recorded synthetic excess refund.");
                if(!await db.IsSchemaReadyAsync())throw new InvalidOperationException("Compact24 schema changed.");
                Console.WriteLine("PASS: disposable database retains one immutable Final invoice, three recipients, two distinct payer allocations, one explicitly recorded synthetic excess refund and the unchanged Compact24 schema.");
            }
            return node.ExitCode;
        }
        catch(Exception e){Console.Error.WriteLine($"Finance verification failed at {stage}: {e.GetType().Name}. No credentials printed.");return 1;}
        finally
        {
            if(api is not null){if(!api.HasExited)api.Kill(true);await api.WaitForExitAsync();api.Dispose();}
            await fixture.DisposeAsync();
            if(minio is not null)await minio.DisposeAsync();
            Environment.SetEnvironmentVariable(contentRootKey,priorContentRoot);
            var resolved=Path.GetFullPath(temporary.FullName);if(resolved.StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(resolved).StartsWith("bhome-finance-verification-",StringComparison.Ordinal))Directory.Delete(resolved,true);
        }
    }
    private static int Port(){using var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();return ((IPEndPoint)listener.LocalEndpoint).Port;}
}
