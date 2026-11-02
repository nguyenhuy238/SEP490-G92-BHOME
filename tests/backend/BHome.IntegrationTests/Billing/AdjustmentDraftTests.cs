using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Billing;

public sealed partial class InvoiceApiTests
{
    private static async Task<HttpResponseMessage> AdjustmentPost(HttpClient client, string route, object body, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await client.SendAsync(request);
    }
    private async Task<InvoiceView> Ready(Workspace w)
    {
        var draft = await Draft(w); await ConfirmUtilities(w);
        return await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/refresh", new InvoiceFinalizeInput(draft.Version)));
    }
    private static async Task<AdjustmentView> Request(Workspace w, InvoiceView draft) => await Success<AdjustmentView>(await AdjustmentPost(w.Tenant.Client,
        $"/api/v1/invoices/{draft.Id}/adjustment-requests", new AdjustmentSubmit(draft.Lines.Single(l => l.ChargeCode == "RENT").Id, 2990000, "Sai khoản thuê tổng hợp", [], draft.Version)));
    [Fact]
    public async Task ApprovedDraftCorrectionSurvivesRefreshAndFinalizationWithOriginalSourceTrace()
    {
        var w = await Setup(); var draft = await Ready(w); var request = await Request(w, draft); var path = $"/api/v1/invoice-adjustments/{request.Id}";
        var input = new AdjustmentDecisionInput(1, draft.Version, 0, 2990000, "RENT", "Owner kiểm tra dữ liệu tổng hợp", true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await AdjustmentPost(w.Staff.Client, path + "/approve", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await AdjustmentPost(w.Owner.Client, path + "/approve", input with { ExpectedInvoiceVersion = 1 })).StatusCode);
        var approved = await Success<AdjustmentView>(await AdjustmentPost(w.Owner.Client, path + "/approve", input, key)); Assert.Equal("Approved", approved.Status);
        Assert.Equal(-10000, approved.Decision!.Delta); Assert.Equal(3109250, approved.CurrentInvoice!.Total);
        Assert.Equal(approved.Id, (await Success<AdjustmentView>(await AdjustmentPost(w.Owner.Client, path + "/approve", input, key))).Id);
        var refresh = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/refresh", new InvoiceFinalizeInput(approved.CurrentInvoice.Version)));
        Assert.Empty(refresh.MissingInputs); var rent = refresh.Lines.Single(l => l.ChargeCode == "RENT"); Assert.Equal(3000000, rent.CalculatedAmount); Assert.Equal(2990000, rent.Amount); Assert.Equal(request.Id, rent.CorrectionRequestId);
        var final = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(refresh.Version)));
        Assert.Equal("Final", final.Status); Assert.Equal(3109250, final.Total);
    }
    [Fact]
    public async Task SourceChangeMakesDraftCorrectionExplicitlyPendingAndPreventsFinalization()
    {
        var w = await Setup(); var draft = await Ready(w); var request = await Request(w, draft);
        var approved = await Success<AdjustmentView>(await AdjustmentPost(w.Owner.Client, $"/api/v1/invoice-adjustments/{request.Id}/approve",
            new AdjustmentDecisionInput(1, draft.Version, 0, 2990000, "RENT", "Approved synthetic correction", true)));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            db.Add(new BillingPolicy { LocationId = w.Location, RoomId = w.Room, Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Changed synthetic source", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 4000000, EffectiveFrom = w.Period }); await db.SaveChangesAsync();
        }
        var refresh = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/refresh", new InvoiceFinalizeInput(approved.CurrentInvoice!.Version)));
        Assert.Contains("draft_correction_source_changed", refresh.MissingInputs);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(refresh.Version))).StatusCode);
    }
    [Fact]
    public async Task OwnerApproveRejectRacePersistsExactlyOneDecisionAndOneResult()
    {
        var w = await Setup(); var draft = await Ready(w); var request = await Request(w, draft);
        var input = new AdjustmentDecisionInput(1, draft.Version, 0, 2990000, "RENT", "Synthetic Owner decision", true);
        var replies = await Task.WhenAll(new[] { "approve", "reject" }.Select(action => AdjustmentPost(w.Owner.Client, $"/api/v1/invoice-adjustments/{request.Id}/{action}", input)));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        var decision = await w.Owner.Client.GetFromJsonAsync<AdjustmentView>($"/api/v1/invoice-adjustments/{request.Id}");
        var invoice = await w.Tenant.Client.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}");
        Assert.Equal(decision!.Status == "Approved" ? 3109250 : 3119250, invoice!.Total);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<InvoiceAdjustmentDecision>().CountAsync(d => d.RequestId == request.Id));
    }
}
