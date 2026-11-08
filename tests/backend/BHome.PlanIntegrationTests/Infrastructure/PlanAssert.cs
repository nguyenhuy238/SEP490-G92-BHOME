using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>Assertions phrased like the "Expected Results" column of the plan. Failures always show the answer body.</summary>
public static class PlanAssert
{
    /// <summary>Asserts the exact HTTP status from the plan and returns the body text.</summary>
    public static async Task<string> StatusAsync(HttpResponseMessage response, HttpStatusCode expected, string? step = null)
    {
        var body = await response.TextAsync();
        Assert.True(
            response.StatusCode == expected,
            $"{Prefix(step)}expected HTTP {(int)expected} {expected} but got {(int)response.StatusCode} {response.StatusCode}. Body: {Trim(body)}");
        return body;
    }

    /// <summary>For plan rows that allow several statuses (e.g. "401/403", "403/404").</summary>
    public static async Task<string> StatusInAsync(HttpResponseMessage response, string? step, params HttpStatusCode[] allowed)
    {
        var body = await response.TextAsync();
        Assert.True(
            allowed.Contains(response.StatusCode),
            $"{Prefix(step)}expected HTTP {string.Join(" or ", allowed.Select(s => (int)s))} but got {(int)response.StatusCode}. Body: {Trim(body)}");
        return body;
    }

    /// <summary>Asserts a 2xx answer (plan says "is saved/created/shown" without a code).</summary>
    public static async Task<string> SuccessAsync(HttpResponseMessage response, string? step = null)
    {
        var body = await response.TextAsync();
        Assert.True(
            response.IsSuccessStatusCode,
            $"{Prefix(step)}expected a successful (2xx) answer but got {(int)response.StatusCode}. Body: {Trim(body)}");
        return body;
    }

    /// <summary>Asserts a 4xx refusal (plan says "is refused" without a code). 5xx is never an accepted refusal.</summary>
    public static async Task<string> RefusedAsync(HttpResponseMessage response, string? step = null)
    {
        var body = await response.TextAsync();
        var code = (int)response.StatusCode;
        Assert.True(code is >= 400 and < 500, $"{Prefix(step)}expected the request to be refused (4xx) but got {code}. Body: {Trim(body)}");
        return body;
    }

    /// <summary>
    /// Asserts that the answer carries the message written in the plan ("message: ..."). The message is looked for in
    /// every string value of the JSON body (title, detail, message, errors…), ignoring trailing dots.
    /// </summary>
    public static void HasMessage(string body, string expectedMessage, string? step = null)
    {
        var expected = expectedMessage.Trim().TrimEnd('.');
        var texts = new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(body);
            texts.AddRange(doc.RootElement.AllStrings());
        }
        catch (JsonException)
        {
            texts.Add(body);
        }

        Assert.True(
            texts.Any(t => t.Contains(expected, StringComparison.Ordinal)),
            $"{Prefix(step)}expected the message \"{expectedMessage}\" in the answer. Body: {Trim(body)}");
    }

    /// <summary>Asserts that a JSON body does not contain any of the given secrets (password hash, raw token…).</summary>
    public static void DoesNotLeak(string body, params string[] forbiddenFragments)
    {
        foreach (var fragment in forbiddenFragments.Where(f => !string.IsNullOrEmpty(f)))
        {
            Assert.False(body.Contains(fragment, StringComparison.OrdinalIgnoreCase), $"The answer must not contain \"{fragment}\". Body: {Trim(body)}");
        }
    }

    private static string Prefix(string? step) => string.IsNullOrWhiteSpace(step) ? string.Empty : step.Trim() + ": ";

    private static string Trim(string body) => body.Length <= 1500 ? body : body[..1500] + "…";
}
