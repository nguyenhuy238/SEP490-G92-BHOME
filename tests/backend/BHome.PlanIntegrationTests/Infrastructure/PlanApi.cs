using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>Thin HTTP client for the running BHOME API. Paths are relative, e.g. "api/v1/auth/login".</summary>
public sealed class PlanApi : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string? _unreachable;

    private readonly HttpClient _client;

    public PlanApi()
    {
        var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false };
        if (PlanSettings.Current.AcceptAnyServerCertificate)
        {
            handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
        }

        _client = new HttpClient(handler) { BaseAddress = PlanSettings.Current.BaseUrl, Timeout = TimeSpan.FromSeconds(60) };
    }

    public Uri BaseUrl => PlanSettings.Current.BaseUrl;

    /// <summary>
    /// Sends a request. When <paramref name="waitWhenRateLimited"/> is true a 429 answer is waited out
    /// (Retry-After, max 65 s) and sent again, so the auth rate limit hit by one test does not break the next one.
    /// </summary>
    public async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string path,
        object? json = null,
        string? bearer = null,
        IReadOnlyDictionary<string, string>? headers = null,
        Func<HttpContent>? content = null,
        bool waitWhenRateLimited = true)
    {
        for (var attempt = 0; ; attempt++)
        {
            using var request = new HttpRequestMessage(method, path.TrimStart('/'));
            if (json is not null)
            {
                request.Content = json is string raw
                    ? new StringContent(raw, Encoding.UTF8, "application/json")
                    : new StringContent(JsonSerializer.Serialize(json, Json), Encoding.UTF8, "application/json");
            }
            else if (content is not null)
            {
                request.Content = content();
            }

            if (bearer is not null)
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            }

            if (headers is not null)
            {
                foreach (var (name, value) in headers)
                {
                    if (!request.Headers.TryAddWithoutValidation(name, value))
                    {
                        request.Content?.Headers.TryAddWithoutValidation(name, value);
                    }
                }
            }

            if (_unreachable is not null)
            {
                throw new SkipException(_unreachable);
            }

            HttpResponseMessage response;
            try
            {
                response = await _client.SendAsync(request);
            }
            catch (HttpRequestException error) when (error.InnerException is System.Net.Sockets.SocketException)
            {
                // No API is listening (e.g. CI runs `dotnet test` on the solution without starting the API): skip, don't fail.
                // Remembered for the rest of the run so the remaining tests skip at once instead of retrying the connection.
                _unreachable = $"The BHOME API is not reachable at {BaseUrl} ({error.Message}). Start the API or set BHOME_IT_BASE_URL.";
                throw new SkipException(_unreachable);
            }

            if (response.StatusCode != HttpStatusCode.TooManyRequests || !waitWhenRateLimited || attempt >= 2)
            {
                return response;
            }

            var wait = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(61);
            response.Dispose();
            await Task.Delay(wait > TimeSpan.FromSeconds(65) ? TimeSpan.FromSeconds(65) : wait + TimeSpan.FromSeconds(1));
        }
    }

    public Task<HttpResponseMessage> GetAsync(string path, string? bearer = null, IReadOnlyDictionary<string, string>? headers = null)
        => SendAsync(HttpMethod.Get, path, null, bearer, headers);

    public Task<HttpResponseMessage> PostAsync(string path, object? json, string? bearer = null, IReadOnlyDictionary<string, string>? headers = null)
        => SendAsync(HttpMethod.Post, path, json ?? new { }, bearer, headers);

    public Task<HttpResponseMessage> PutAsync(string path, object? json, string? bearer = null, IReadOnlyDictionary<string, string>? headers = null)
        => SendAsync(HttpMethod.Put, path, json ?? new { }, bearer, headers);

    public Task<HttpResponseMessage> PatchAsync(string path, object? json, string? bearer = null, IReadOnlyDictionary<string, string>? headers = null)
        => SendAsync(HttpMethod.Patch, path, json ?? new { }, bearer, headers);

    public Task<HttpResponseMessage> DeleteAsync(string path, string? bearer = null, IReadOnlyDictionary<string, string>? headers = null)
        => SendAsync(HttpMethod.Delete, path, null, bearer, headers);

    /// <summary>Raw binary upload (docs/api uses raw PNG/JPEG bodies, not multipart, for OCR and evidence).</summary>
    public Task<HttpResponseMessage> SendBytesAsync(
        HttpMethod method,
        string path,
        byte[] bytes,
        string mediaType,
        string? bearer = null,
        IReadOnlyDictionary<string, string>? headers = null)
        => SendAsync(method, path, null, bearer, headers, () =>
        {
            var c = new ByteArrayContent(bytes);
            c.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
            return c;
        });

    public void Dispose() => _client.Dispose();
}
