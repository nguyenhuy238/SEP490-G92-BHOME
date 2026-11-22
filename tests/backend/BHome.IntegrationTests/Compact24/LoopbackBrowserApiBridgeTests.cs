using System.Net;

namespace BHome.IntegrationTests.Compact24;

public sealed class LoopbackBrowserApiBridgeTests
{
    [Fact]
    public async Task DisposingBridgeCancelsAnInFlightReadWithoutReplacingBrowserResultsWithACleanupFailure()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var port = LoopbackBrowserApiBridge.AvailablePort();
        var bridge = new LoopbackBrowserApiBridge(new HttpClient(new PendingHandler(entered))
        {
            BaseAddress = new Uri("http://synthetic.example.invalid")
        }, port);
        using var browser = new HttpClient();
        var reading = browser.GetAsync($"http://127.0.0.1:{port}/api/v1/synthetic-pending");
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally
        {
            await bridge.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));
        }
        // A stopped listener may return an empty response or abort the browser connection.
        try { using var response = await reading.WaitAsync(TimeSpan.FromSeconds(10)); }
        catch (HttpRequestException) { }
    }

    private sealed class PendingHandler(TaskCompletionSource entered) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            entered.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }
}
