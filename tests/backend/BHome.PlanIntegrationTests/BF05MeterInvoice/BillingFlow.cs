using System.Globalization;
using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF05MeterInvoice;

/// <summary>
/// Preconditions and documented calls for sheet "BF-05 Meter Invoice".
/// An invoice needs a Room with an active (signed) contract, which needs the signing provider, so the data that cannot be
/// created through documented routes is read from environment variables. Each test skips with the list of what to prepare:
///   BHOME_IT_BF05_LOCATION_ID          Location with a billing schedule and an enabled automation plan (Owner "owner", Staff "staff" assigned).
///   BHOME_IT_BF05_BILLING_PERIOD       yyyy-MM-01 period of that Location whose meter day has arrived (meter-task job may run).
///   BHOME_IT_BF05_FUTURE_PERIOD        yyyy-MM-01 later period whose meter day has NOT arrived yet.
///   BHOME_IT_BF05_ROOM_ID              Room of that Location (a replacement meter is created in it by ITC-BF05-001).
///   BHOME_IT_BF05_OPEN_TASK_ID         Periodic meter task assigned to "staff", previous reading confirmed, not confirmed yet (consumed by ITC-BF05-002).
///   BHOME_IT_BF05_REFUSAL_TASK_ID      Open periodic meter task assigned to "staff" with a confirmed baseline (stays open).
///   BHOME_IT_BF05_NO_BASELINE_TASK_ID  Open periodic meter task assigned to "staff" whose meter has no confirmed baseline.
///   BHOME_IT_BF05_SHARED_ROOM_ID       Room with several Tenants ("tenant" and "tenant2") under an active Main Contract.
///   BHOME_IT_BF05_SHARED_CONTRACT_ID   Representative contract of that Room.
///   BHOME_IT_BF05_SHARED_PERIOD        yyyy-MM-01 period of that Room with policies, some readings confirmed and one reading NOT confirmed.
///   BHOME_IT_BF05_COMPLETE_DRAFT_ID    Draft invoice (Room of "tenant") with every input confirmed and the Final date reached (consumed by ITC-BF05-006).
///   BHOME_IT_BF05_SCHED_LOCATION_ID    Location whose plan authorizes automatic Final and whose Final date for BHOME_IT_BF05_SCHED_PERIOD has arrived.
///   BHOME_IT_BF05_SCHED_PERIOD         yyyy-MM-01 period for the scheduled finalization.
///   BHOME_IT_BF05_SCHED_INVOICE_ID     Draft invoice of that Location/period with exactly one missing reading.
///   BHOME_IT_BF05_SCHED_TASK_ID        Open meter task (assigned to "staff") of that missing reading.
///   BHOME_IT_BF05_REVOKE_LOCATION_ID   Second Location whose plan authorizes automatic Final, Final date of BHOME_IT_BF05_REVOKE_PERIOD arrived.
///   BHOME_IT_BF05_REVOKE_PERIOD        yyyy-MM-01 period for the revoked-authorization run.
///   BHOME_IT_BF05_REVOKE_INVOICE_ID    Complete Draft invoice of that Location/period.
/// </summary>
internal static class BillingFlow
{
    public static string Env(string name, string prepare)
    {
        var value = Environment.GetEnvironmentVariable(name);
        Skip.If(string.IsNullOrWhiteSpace(value), $"Precondition not configured: set {name} to {prepare}.");
        return value!.Trim();
    }

    public static JsonElement Parse(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    public static async Task<JsonElement> GetOkAsync(PlanApi api, string path, string token, string step)
        => Parse(await PlanAssert.SuccessAsync(await api.GetAsync(path, token), step));

    public static decimal Dec(string? text) => decimal.Parse(text ?? "0", NumberStyles.Number, CultureInfo.InvariantCulture);

    public static string Text(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    public static int Int(JsonElement e, string path) => int.Parse(e.Str(path) ?? "0", CultureInfo.InvariantCulture);

    public static Task<HttpResponseMessage> RunNowAsync(PlanApi api, string token, string locationId, string period, string phase)
        => api.PostAsync("api/v1/billing-automation/run-now", new { locationId, billingPeriod = period, phase }, token);

    /// <summary>Owner view of the meter tasks of a Location (array answer, max 100 per page).</summary>
    public static async Task<IReadOnlyList<JsonElement>> MeterTasksAsync(PlanApi api, string token, string locationId)
    {
        var all = new List<JsonElement>();
        for (var page = 1; page <= 20; page++)
        {
            var items = (await GetOkAsync(api, $"api/v1/capture/meter-tasks?locationId={locationId}&page={page}", token, "list meter tasks")).Items();
            all.AddRange(items);
            if (items.Count < 100)
            {
                break;
            }
        }

        return all;
    }

    public static bool SamePeriod(string? value, string period)
        => value is not null && value.StartsWith(period[..7], StringComparison.Ordinal);

    /// <summary>Staff uploads the meter image (raw PNG) and returns the evidence id.</summary>
    public static async Task<string> UploadEvidenceAsync(PlanApi api, string staffToken, string taskId)
    {
        var body = await PlanAssert.SuccessAsync(
            await api.SendBytesAsync(HttpMethod.Put, $"api/v1/capture/meter-tasks/{taskId}/evidence", MeterImage, "image/png", staffToken),
            "upload meter image");
        return Parse(body).Str("id") ?? throw new InvalidOperationException("Evidence answer has no id: " + body);
    }

    public static Task<HttpResponseMessage> ConfirmAsync(PlanApi api, string staffToken, string taskId, string value, string evidenceId, bool humanConfirmed = true)
        => api.PostAsync($"api/v1/capture/meter-tasks/{taskId}/confirm", new { humanConfirmed, confirmedValue = value, evidenceId }, staffToken);

    /// <summary>Next reading for a task: previous confirmed value + 1 (decimal string).</summary>
    public static string NextValue(JsonElement task) => Text(Dec(task.Str("previousValue")) + 1);

    public static async Task AssertTaskOpenAsync(PlanApi api, string token, string taskId, string step)
    {
        var task = await GetOkAsync(api, $"api/v1/capture/meter-tasks/{taskId}", token, step);
        Assert.True(string.IsNullOrEmpty(task.Str("confirmedReadingId")), $"{step}: the task must not be completed. Task: {task}");
    }

    /// <summary>Invoice ids the tenant got an Invoice notification for (publishes pending events first, Dev/Testing route).</summary>
    public static async Task<HashSet<string>> InvoiceNotificationTargetsAsync(PlanApi api, string ownerToken, string tenantToken)
    {
        using (await api.PostAsync("api/v1/notifications/process-events", null, ownerToken))
        {
        }

        var targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var inbox = await GetOkAsync(api, "api/v1/notifications?category=Invoice&page=1&pageSize=100", tenantToken, "tenant inbox");
        foreach (var item in inbox.Items())
        {
            using var target = await api.GetAsync($"api/v1/notifications/{item.Str("id")}/target", tenantToken);
            if (target.StatusCode == HttpStatusCode.OK)
            {
                targets.Add((await target.JsonAsync()).Str("objectId") ?? string.Empty);
            }
        }

        return targets;
    }

    /// <summary>Synthetic meter image from docs/testing/postman/fixtures/synthetic-meter.png (not a real meter photo).</summary>
    public static byte[] MeterImage { get; } = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAUAAAAB4CAIAAAAMrLyJAAAARHRFWHREZXNjcmlwdGlvbgBCSE9NRSBTWU5USEVUSUMgUE9TVE1BTiBGSVhUVVJFIC0gTk9UIEEgUkVBTCBNRVRFUiBQSE9UT+2i9TAAAAQtSURBVHic7dOBreQwDAPR7b/puw6C4COUOfK8BizK1O+fJKzf6QEk/Z0HLIF5wBKYByyBecASmAcsgXnAEpgHLIF5wBKYByyBecASmAcsgXnAEpgHLIF5wBKYByyBecASmAcsgXnAEpgHLIF5wBKYByyBecASmAcsgSEP+HdUbdjawRKGw9ZCLuKq6iwYLGE4bC3kIq6qzoLBEobD1kIu4qrqLBgsYThsLeQirqrOgsEShsPWQi7iquosGCxhOGwt5CKuqs6CwRKGw9ZCLuKq6iwYLGE4bC3kIq6qzoLBEobD1kIu4qrqLBgsYThsLeQirqrOgsEShsPWQi7iquosGCxhOGwt5CKuqs6CwRKGw9ZCLuKq6iwYLGE4bC3kIhLfPFydP5V2YrCzrgr7CeQiEt88XJ33zw0PdtZVYT+BXETim4er8/654cHOuirsJ5CLSHzzcHXePzc82FlXhf0EchGJbx6uzvvnhgc766qwn0AuIvHNw9V5/9zwYGddFfYTyEUkvnm4Ou+fGx7srKvCfgK5iMQ3D1fn/XPDg511VdhPIBeR+Obh6rx/bniws64K+wnkIhLfPFyd988ND3bWVWE/gVxE4puHq/P+ueHBzroq7CeQi0h883B13j83PNhZV4X9BHIRiW8ers7754YHO+uqsJ9ALiLxzcPVef/c8GBnXRX2E8hFJL65tjoLBksYDlsLuYjEN9dWZ8FgCcNhayEXkfjm2uosGCxhOGwt5CIS31xbnQWDJQyHrYVcROKba6uzYLCE4bC1kItIfHNtdRYMljActhZyEYlvrq3OgsEShsPWQi4i8c211VkwWMJw2FrIRSS+ubY6CwZLGA5bC7mIxDfXVmfBYAnDYWshF5H45trqLBgsYThsLeQiEt9cW50FgyUMh62FXETim2urs2CwhOGwtZCLSHxzbXUWDJYwHLYWchGJb66tjoPpAXK5ierU1tHB9AC53ER1auvoYHqAXG6iOrV1dDA9QC43UZ3aOjqYHiCXm6hObR0dTA+Qy01Up7aODqYHyOUmqlNbRwfTA+RyE9WpraOD6QFyuYnq1NbRwfQAudxEdWrr6GB6gFxuojq1dXQwPUAuN1Gd2jo6mB4gl5uoTm0dHUwPkMt9X50EI6yJsAByEQuqY4SGCAsgF7GgOkZoiLAAchELqmOEhggLIBexoDpGaIiwAHIRC6pjhIYICyAXsaA6RmiIsAByEQuqY4SGCAsgF7GgOkZoiLAAchELqmOEhggLIBexoDpGaIiwAHIRC6pjhIYICyAXsaA6RmiIsAByEQuqY4SGCAu4CAnMA5bAPGAJzAOWwDxgCcwDlsA8YAnMA5bAPGAJzAOWwDxgCcwDlsA8YAnMA5bAPGAJzAOWwDxgCcwDlsA8YAnMA5bAPGAJzAOWwDxgCcwDlsA8YAnsP8y1Z0wonewtAAAAAElFTkSuQmCC");
}
