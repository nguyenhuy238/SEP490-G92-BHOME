using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Billing;
internal sealed partial class BillingAutomationEngine
{
    // Delegated identity is internal, taken only from the persisted Owner authorization. InvoiceService
    // revalidates that Owner and the effective plan under its normal financial transaction lock.
    private sealed class AuthorizedOwner(Guid id):ICurrentUser{public Guid? UserId=>id;public bool IsInRole(string role)=>role==Roles.Owner;}
    private InvoiceService Invoices(BillingAutomationPlan plan)
    {
        var actor=new AuthorizedOwner(plan.AuthorizedByUserId);var permissions=new PermissionAccess(actor,new ResourceAccess(actor,staffAccess));
        return new(invoiceRepository,new PropertyService(propertyRepository,actor,permissions,clock),actor,clock,schedules);
    }
    private async Task<int> GenerateDraft(BillingAutomationPlan p,DateOnly period,Guid room,List<object> errors,CancellationToken t)
    {
        db.ChangeTracker.Clear();var existing=await db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i=>i.RoomId==room&&i.BillingPeriod==period,t);
        try
        {
            InvoiceView invoice;
            if(existing is not null)invoice=await Invoices(p).GetAsync(existing.Id,t);
            else
            {
                var selection=await schedules.RepresentativeAsync(room,period,t);
                var occupants=await invoiceRepository.OccupanciesAsync(room,period,period.AddMonths(1).AddDays(-1),t);
                var representative=selection?.ContractId??(occupants.Count==1?occupants[0].Contract.Id:(Guid?)null);
                if(representative is null){errors.Add(new{roomId=room,code="representative_selection_required"});return 0;}
                invoice=await Invoices(p).GenerateAsync(new(room,period,representative.Value),t,p.Id);
            }
            if(invoice.Status=="Draft"&&invoice.MissingInputs.Count>0)errors.Add(new{roomId=room,invoiceId=invoice.Id,code="draft_missing_inputs",missingInputs=invoice.MissingInputs});
            return existing is null?0:1;
        }
        catch(InvoiceException ex)when(ex.Status is 400 or 404 or 409){errors.Add(new{roomId=room,code=ex.Code});return 0;}
    }
}
