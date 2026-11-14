using System.Net.Http.Headers;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.Integrations;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;

namespace BHome.Infrastructure.PaymentsDebt;

public sealed class SePayApiClient(HttpClient http, SePayOptions options, TimeProvider clock) : ISePayTransactionClient, IBankTransactionProvider
{
    public async Task<SePayPage> GetAsync(SePayPollingCursor cursor, CancellationToken token)
    {
        if (!options.Enabled || string.IsNullOrWhiteSpace(options.ApiToken)) throw new IntegrationUnavailableException("bank transactions");
        if (cursor.Page < 1 || cursor.SinceId is not null && !Guid.TryParse(cursor.SinceId, out _)) throw new PaymentException(400, "invalid_sepay_cursor");
        var path = "transactions?per_page=100&transaction_date_sort=asc&timestamp_format=iso8601&page=" + cursor.Page.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (cursor.SinceId is not null) path += "&since_id=" + Uri.EscapeDataString(cursor.SinceId);
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiToken);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        if (!response.IsSuccessStatusCode) throw new IntegrationUnavailableException("bank transactions");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.RequestTimeoutSeconds));
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
        {
            if (buffer.Length + count > 2_000_000) throw new IntegrationUnavailableException("bank transactions");
            await buffer.WriteAsync(chunk.AsMemory(0, count), timeout.Token);
        }
        try
        {
            using var document = JsonDocument.Parse(buffer.ToArray());
            var root = document.RootElement;
            if (root.GetProperty("status").GetString() != "success") throw new JsonException();
            var items = root.GetProperty("data");
            var pagination = root.GetProperty("meta").GetProperty("pagination");
            var more = pagination.GetProperty("has_more").GetBoolean();
            if (pagination.GetProperty("current_page").GetInt32() != cursor.Page || items.GetArrayLength() > 100 || more && items.GetArrayLength() == 0) throw new JsonException();
            var transactions = new List<SePayTransaction>();
            foreach (var row in items.EnumerateArray())
            {
                var amountIn = row.GetProperty("amount_in").GetDecimal();
                var amountOut = row.GetProperty("amount_out").GetDecimal();
                if (amountIn < 0 || amountOut < 0 || (amountIn > 0) == (amountOut > 0)) throw new JsonException();
                var direction = amountIn > 0 ? "in" : "out";
                if (row.TryGetProperty("transfer_type", out var supplied) && supplied.GetString() != direction) throw new JsonException();
                var id = row.GetProperty("id").GetString()!;
                if (!Guid.TryParse(id, out _)) throw new JsonException();
                var transaction = new SePayTransaction(id, row.GetProperty("bank_brand_name").GetString()!, row.GetProperty("transaction_date").GetString()!,
                    row.GetProperty("account_number").GetString()!, row.TryGetProperty("va", out var va) ? va.GetString() : null,
                    row.TryGetProperty("code", out var code) ? code.GetString() : null, row.GetProperty("transaction_content").GetString()!, direction,
                    amountIn + amountOut, row.GetProperty("reference_number").GetString()!, null,
                    row.TryGetProperty("accumulated", out var accumulated) && accumulated.ValueKind != JsonValueKind.Null ? accumulated.GetDecimal() : null);
                transaction.Validate(clock.GetUtcNow()); transactions.Add(transaction);
            }
            return new(transactions, more);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException or FormatException or PaymentException)
        { throw new IntegrationUnavailableException("bank transaction response"); }
    }

    public async Task<BankTransactionPage> GetTransactionsAsync(string? cursor, CancellationToken cancellationToken)
    {
        var state = cursor is null ? new SePayPollingCursor() : JsonSerializer.Deserialize<SePayPollingCursor>(cursor)!;
        var page = await GetAsync(state, cancellationToken);
        var candidate = page.Items.LastOrDefault()?.Id ?? state.CandidateId;
        var next = page.HasMore ? state with { Page = state.Page + 1, CandidateId = candidate }
            : new SePayPollingCursor(candidate ?? state.SinceId, SynchronizedAt: clock.GetUtcNow());
        return new(page.Items.Select(t => new BankTransaction(SePayService.Reference(options.Mode, t), t.TransferAmount, t.OccurredAt)).ToArray(), JsonSerializer.Serialize(next));
    }
}
