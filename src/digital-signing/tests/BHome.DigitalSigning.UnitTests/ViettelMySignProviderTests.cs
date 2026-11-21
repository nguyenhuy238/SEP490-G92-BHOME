using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Infrastructure.Viettel;
using Microsoft.Extensions.Logging.Abstractions;

namespace BHome.DigitalSigning.UnitTests;

public sealed class ViettelMySignProviderTests
{
    private static readonly ViettelAccount Account = new("https://mysign.test", "client-1", "secret-1", null,
        "/vtss/service/ras/v1/login", "/adss/service/ras/csc/v1/credentials/list", "/vtss/service/signHash",
        "/vtss/service/requests/status", 5);

    private readonly FakeViettel viettel = new();

    private ViettelMySignProvider Provider(ViettelAccount? account = null)
    {
        var source = new FixedAccount(account ?? Account);
        return new ViettelMySignProvider(viettel, source, new ViettelTokenCache(TimeProvider.System),
            NullLogger<ViettelMySignProvider>.Instance);
    }

    [Fact]
    public async Task ListsCredentialsByIdThenReadsEachCertificate()
    {
        using var ca = new FakeCa();
        viettel.Answer("/credentials/list", HttpStatusCode.OK, """{"credentialIDs":["cred-1"]}""");
        viettel.Answer("/credentials/info", HttpStatusCode.OK,
            $$$"""{"cert":{"certificates":["{{{Convert.ToBase64String(ca.Certificate.RawData)}}}"]}}""");

        var credentials = await Provider().ListCredentialsAsync("079000000001", null, CancellationToken.None);

        var credential = Assert.Single(credentials);
        Assert.Equal("cred-1", credential.CredentialId);
        Assert.Equal(ca.Certificate.Thumbprint, credential.Certificate.Thumbprint);
        var list = viettel.Requests.Single(request => request.Path.EndsWith("/credentials/list"));
        Assert.Equal("Bearer token-079000000001", list.Authorization);
        Assert.Equal("079000000001", list.Body["user_id"]!.ToString());
        Assert.Equal("client-1", viettel.Requests[0].Body["client_id"]!.ToString());
        Assert.False(viettel.Requests[0].Body.AsObject().ContainsKey("profile_id"));
    }

    [Fact]
    public async Task SendsTheDigestAsynchronouslyWithAPlainDescription()
    {
        viettel.Answer("/signHash", HttpStatusCode.OK, """{"transactionId":"vt-42"}""");
        var digest = Enumerable.Range(0, 32).Select(value => (byte)value).ToArray();

        var transactionId = await Provider().RequestSignatureAsync(
            new SignHashRequest("079000000001", "cred-1", digest, "bhome-abc", "Ký hợp đồng phòng 101/A"),
            CancellationToken.None);

        Assert.Equal("vt-42", transactionId);
        var body = viettel.Requests.Single(request => request.Path.EndsWith("/signHash")).Body;
        Assert.Equal(1, body["async"]!.GetValue<int>());
        Assert.Equal("cred-1", body["credentialID"]!.ToString());
        Assert.Equal(Convert.ToBase64String(digest), body["hash"]![0]!.ToString());
        Assert.Equal("Ky hop dong phong 101 A", Encoding.UTF8.GetString(Convert.FromBase64String(body["description"]!.ToString())));
    }

    [Theory]
    [InlineData("""{"status":"4000"}""", typeof(SignStatus.Pending))]
    [InlineData("""{"status":4001}""", typeof(SignStatus.Expired))]
    [InlineData("""{"status":"4002"}""", typeof(SignStatus.Rejected))]
    [InlineData("""{"status":"50000","error_description":"x"}""", typeof(SignStatus.Failed))]
    [InlineData("""{"status":"1","signatures":["AQID\r\nBA=="]}""", typeof(SignStatus.Signed))]
    public async Task MapsViettelStatusCodes(string answer, Type expected)
    {
        viettel.Answer("/requests/status", HttpStatusCode.OK, answer);

        var status = await Provider().GetStatusAsync("079000000001", "vt-42", CancellationToken.None);

        Assert.IsType(expected, status);
        if (status is SignStatus.Signed signed) Assert.Equal(new byte[] { 1, 2, 3, 4 }, signed.RawSignature);
    }

    [Fact]
    public async Task LogsInAgainOnceWhenTheTokenIsRefused()
    {
        viettel.Answer("/requests/status", HttpStatusCode.Unauthorized, "{}");
        viettel.Answer("/requests/status", HttpStatusCode.OK, """{"status":"4000"}""");

        var status = await Provider().GetStatusAsync("079000000001", "vt-42", CancellationToken.None);

        Assert.IsType<SignStatus.Pending>(status);
        Assert.Equal(2, viettel.Requests.Count(request => request.Path.EndsWith("/login")));
    }

    [Fact]
    public async Task ARefusedLoginIsReportedByTheConnectionCheck()
    {
        viettel.Answer("/login", HttpStatusCode.Unauthorized, """{"error":"invalid_client","error_description":"bad secret"}""");

        var refused = await Provider().CheckAccountAsync("079000000001", CancellationToken.None);

        Assert.Equal("Viettel MySign login failed: invalid_client: bad secret", refused);
    }

    [Fact]
    public async Task AnUnconfiguredAccountIsNeverCalled()
    {
        var provider = Provider(Account with { ClientSecret = null });

        await Assert.ThrowsAsync<SigningProviderException>(
            () => provider.ListCredentialsAsync("079000000001", null, CancellationToken.None));
        Assert.Empty(viettel.Requests);
    }

    [Theory]
    [InlineData("Ký hợp đồng thuê phòng 101/A", "Ky hop dong thue phong 101 A")]
    [InlineData("Đăng ký tạm trú", "Dang ky tam tru")]
    [InlineData("  a__b--c  ", "a__b--c")]
    public void KeepsOnlyWhatViettelAccepts(string text, string expected) => Assert.Equal(expected, ViettelText.Plain(text));

    private sealed class FixedAccount(ViettelAccount account) : IViettelAccountSource
    {
        public Task<ViettelAccount> CurrentAsync(CancellationToken cancellationToken) => Task.FromResult(account);
    }

    // Answers by path suffix, in order; an unscripted login always succeeds with a per-user token.
    private sealed class FakeViettel : HttpMessageHandler, IHttpClientFactory
    {
        private readonly List<(string Suffix, HttpStatusCode Status, string Body)> script = [];

        public List<(string Path, string? Authorization, JsonNode Body)> Requests { get; } = [];

        public void Answer(string suffix, HttpStatusCode status, string body) => script.Add((suffix, status, body));

        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
            Requests.Add((path, request.Headers.Authorization?.ToString(), body));
            var scripted = script.FindIndex(entry => path.EndsWith(entry.Suffix, StringComparison.Ordinal));
            if (scripted >= 0)
            {
                var (_, status, answer) = script[scripted];
                script.RemoveAt(scripted);
                return new HttpResponseMessage(status) { Content = new StringContent(answer, Encoding.UTF8, "application/json") };
            }
            if (path.EndsWith("/login", StringComparison.Ordinal))
            {
                var user = body["user_id"]!.ToString();
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent($$"""{"access_token":"token-{{user}}","expires_in":3600}""")
                };
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("{}") };
        }
    }
}
