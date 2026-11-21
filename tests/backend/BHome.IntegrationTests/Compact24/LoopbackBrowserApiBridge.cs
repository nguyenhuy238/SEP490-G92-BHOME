using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace BHome.IntegrationTests.Compact24;

// Network transport only: every API request executes the real ASP.NET test host. No route
// responses or financial decisions are mocked here. Storage remains the fixture substitute.
internal sealed class LoopbackBrowserApiBridge : IAsyncDisposable
{
    private readonly HttpListener listener = new();
    private readonly HttpClient api;
    private readonly CancellationTokenSource stop = new();
    private readonly ConcurrentBag<Task> requests = [];
    private readonly Task accepting;
    internal static int AvailablePort()
    {
        var socket = new TcpListener(IPAddress.Loopback, 0); socket.Start();
        try { return ((IPEndPoint)socket.LocalEndpoint).Port; }
        finally { socket.Stop(); }
    }
    internal LoopbackBrowserApiBridge(HttpClient api, int port)
    {
        this.api = api;
        listener.Prefixes.Add($"http://127.0.0.1:{port}/"); listener.Start();
        accepting = AcceptAsync();
    }
    private async Task AcceptAsync()
    {
        while (!stop.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().WaitAsync(stop.Token); }
            catch (Exception e) when (e is OperationCanceledException or HttpListenerException or ObjectDisposedException) { break; }
            requests.Add(ForwardAsync(context));
        }
    }
    private async Task ForwardAsync(HttpListenerContext context)
    {
        try
        {
            var incoming = context.Request;
            if (incoming.RawUrl is not { } route || !route.StartsWith("/api/v1/", StringComparison.Ordinal))
            { context.Response.StatusCode = 404; return; }
            using var request = new HttpRequestMessage(new HttpMethod(incoming.HttpMethod), route);
            if (incoming.HasEntityBody) request.Content = new StreamContent(incoming.InputStream);
            foreach (var name in incoming.Headers.AllKeys.OfType<string>())
            {
                if (name.Equals("Host", StringComparison.OrdinalIgnoreCase) || name.Equals("Connection", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) || name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                if (incoming.Headers.GetValues(name) is not { } values) continue;
                if (!request.Headers.TryAddWithoutValidation(name, values)) request.Content?.Headers.TryAddWithoutValidation(name, values);
            }
            using var response = await api.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stop.Token);
            context.Response.StatusCode = (int)response.StatusCode;
            foreach (var header in response.Headers.Concat(response.Content.Headers))
            {
                if (header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase) || header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                foreach (var value in header.Value) context.Response.Headers.Add(header.Key, value);
            }
            await response.Content.CopyToAsync(context.Response.OutputStream, stop.Token);
        }
        catch (Exception) when (stop.IsCancellationRequested) { }
        catch (HttpListenerException e) when (e.NativeErrorCode is 64 or 995 or 1229) { /* Browser disconnected/cancelled its read. */ }
        catch { context.Response.StatusCode = 502; throw; }
        finally
        {
            // A browser may cancel an in-flight read while navigating or closing its context.
            // Closing that disconnected response must not replace the actual test failure.
            try { context.Response.Close(); }
            catch (HttpListenerException) { }
        }
    }
    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync(); listener.Stop(); await accepting;
        try { await Task.WhenAll(requests); }
        finally { listener.Close(); stop.Dispose(); api.Dispose(); }
    }
}
