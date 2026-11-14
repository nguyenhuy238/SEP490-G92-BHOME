using System.Text.Json;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>Helpers to read JSON answers without depending on backend DTO classes.</summary>
public static class JsonBody
{
    public static async Task<string> TextAsync(this HttpResponseMessage response)
        => await response.Content.ReadAsStringAsync();

    public static async Task<JsonElement> JsonAsync(this HttpResponseMessage response)
    {
        var text = await response.TextAsync();
        Assert.False(string.IsNullOrWhiteSpace(text), $"Expected a JSON body but the answer ({(int)response.StatusCode}) was empty.");
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    /// <summary>Reads a value by a dotted path ("a.b.0.c"), property names case-insensitive. Null when absent.</summary>
    public static JsonElement? Find(this JsonElement element, string path)
    {
        var current = element;
        foreach (var part in path.Split('.'))
        {
            if (current.ValueKind == JsonValueKind.Array && int.TryParse(part, out var index))
            {
                if (index >= current.GetArrayLength())
                {
                    return null;
                }

                current = current[index];
                continue;
            }

            if (current.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var found = false;
            foreach (var p in current.EnumerateObject())
            {
                if (string.Equals(p.Name, part, StringComparison.OrdinalIgnoreCase))
                {
                    current = p.Value;
                    found = true;
                    break;
                }
            }

            if (!found)
            {
                return null;
            }
        }

        return current;
    }

    /// <summary>Value at the path as text (strings unquoted, numbers/bools raw). Null when absent or JSON null.</summary>
    public static string? Str(this JsonElement element, string path)
    {
        var v = element.Find(path);
        if (v is null || v.Value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return v.Value.ValueKind == JsonValueKind.String ? v.Value.GetString() : v.Value.GetRawText();
    }

    /// <summary>Every string value anywhere in the document (used to look for the message the plan expects).</summary>
    public static IEnumerable<string> AllStrings(this JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                yield return element.GetString() ?? string.Empty;
                break;
            case JsonValueKind.Object:
                foreach (var p in element.EnumerateObject())
                {
                    foreach (var s in p.Value.AllStrings())
                    {
                        yield return s;
                    }
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var s in item.AllStrings())
                    {
                        yield return s;
                    }
                }

                break;
        }
    }

    /// <summary>Items of a list answer: a bare array, or the first array property of a page envelope (items, data…).</summary>
    public static IReadOnlyList<JsonElement> Items(this JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return element.EnumerateArray().ToList();
        }

        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in element.EnumerateObject())
            {
                if (p.Value.ValueKind == JsonValueKind.Array)
                {
                    return p.Value.EnumerateArray().ToList();
                }
            }
        }

        return Array.Empty<JsonElement>();
    }
}
