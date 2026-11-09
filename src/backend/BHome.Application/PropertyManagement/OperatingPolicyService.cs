using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.PropertyManagement;

public sealed class OperatingPolicyService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access, TimeProvider clock)
    : SetupWorkspaceService(store, user, access), IOperatingPolicyWorkflow
{
    public Task<SetupDocument> SaveAsync(Guid? id, OperatingPolicyWrite input, CancellationToken t)
    {
        Owner(); Text(input.Title, 150); Text(input.Content, 12000);
        if (input.EffectiveFrom == default) throw new PropertyException(400, "effective_date_required");
        return Store.TransactionAsync(input.LocationId, async () =>
        {
            if (id is { } existing && (await Document(existing, "OperatingPolicy", true, t)).Status != "Draft")
                throw new PropertyException(409, "published_policy_immutable");
            return await Store.SaveAsync(id ?? Guid.NewGuid(), input.LocationId, "OperatingPolicy", "Draft", input, input.ExpectedVersion, Actor, t);
        }, t);
    }
    public async Task<SetupDocument> PublishAsync(Guid id, int version, CancellationToken t)
    {
        var initial = await Document(id, "OperatingPolicy", true, t);
        return await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var doc = await Document(id, "OperatingPolicy", true, t);
            if (doc.Status == "Published" && doc.Version == version + 1) return doc;
            if (doc.Status != "Draft") throw new PropertyException(409, "published_policy_immutable");
            var input = Read<OperatingPolicyWrite>(doc);
            if ((await Store.ListAsync(doc.LocationId, "OperatingPolicy", t)).Any(d => d.Status == "Published" && Read<OperatingPolicyWrite>(d).EffectiveFrom == input.EffectiveFrom))
                throw new PropertyException(409, "policy_effective_date_conflict");
            var published = await Store.SaveAsync(id, doc.LocationId, doc.Kind, "Published", input, version, Actor, t);
            await Store.NotifyPolicyPublicationAsync(doc.LocationId, id, t); return published;
        }, t);
    }
    public async Task<IReadOnlyList<SetupDocument>> ReadPoliciesAsync(Guid location, CancellationToken t) =>
        (await ListAsync(location, "OperatingPolicy", t)).Where(d => User.IsInRole(Roles.Owner) || d.Status == "Published").ToArray();
    public async Task<SetupDocument> ReadPolicyAsync(Guid id, CancellationToken t)
    {
        var doc = await Document(id, "OperatingPolicy", false, t);
        if (doc.Status != "Published" && !User.IsInRole(Roles.Owner)) throw new PropertyException(404, "resource_not_found");
        return doc;
    }
    public async Task<IReadOnlyList<SetupDocument>> RevisionsAsync(Guid id, CancellationToken t)
    {
        _ = await ReadPolicyAsync(id, t);
        var revisions = await Store.HistoryAsync(id, "OperatingPolicy", t);
        return revisions.Where(d => d.Id == id && (User.IsInRole(Roles.Owner) || d.Status == "Published"))
            .OrderBy(d => d.Version).ToArray();
    }
    private static OperatingPolicyBinding Binding(SetupDocument doc)
    {
        var p = Read<OperatingPolicyWrite>(doc); return new(doc.Id, doc.Version, Hash(new { p.Title, p.Content, p.EffectiveFrom }), p.Title, p.Content);
    }
    public async Task BindDraftAsync(Contract contract, CancellationToken t)
    {
        if (contract.OperatingPolicySnapshot.Length > 0) return;
        var location = await Store.RoomLocationAsync(contract.RoomId, t) ?? throw new PropertyException(404, "room_not_found");
        var doc = (await Store.ListAsync(location, "OperatingPolicy", t)).Where(d => d.Status == "Published" && Read<OperatingPolicyWrite>(d).EffectiveFrom <= contract.StartDate)
            .OrderByDescending(d => Read<OperatingPolicyWrite>(d).EffectiveFrom).FirstOrDefault();
        if (doc is null) return;
        var binding = Binding(doc); contract.OperatingPolicySnapshot = JsonSerializer.Serialize(binding, Json);
        contract.Terms += $"\nNỘI QUY ĐƯỢC THỎA THUẬN {binding.PolicyId} / phiên bản {binding.Version} / SHA256 {binding.ContentHash}\n{binding.Title}\n{binding.Content}";
        if (contract.Terms.Length > 12000) throw new PropertyException(400, "contract_and_policy_terms_too_long");
    }
    private async Task<Contract> ContractScope(Guid id, CancellationToken t)
    {
        var c = await Store.ContractAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
        if (!await Access.CanAccessAsync(new(c.Room.LocationId, c.TenantUserId), [Roles.Owner, Roles.Staff, Roles.Tenant], t))
            throw new PropertyException(404, "resource_not_found");
        return c;
    }
    public async Task<AgreedOperatingPolicy> AgreedAsync(Guid contractId, CancellationToken t)
    {
        var c = await ContractScope(contractId, t);
        var accepted = (await Store.ListAsync(c.Room.LocationId, "PolicyAcceptance", t)).Where(d => d.Data.GetProperty("contractId").GetGuid() == contractId &&
            d.Data.GetProperty("effectiveFrom").Deserialize<DateOnly>() <= DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime))
            .OrderByDescending(d => d.Data.GetProperty("effectiveFrom").Deserialize<DateOnly>()).FirstOrDefault();
        if (accepted is not null) return new(contractId, "Accepted", accepted.Data.GetProperty("policy").Deserialize<OperatingPolicyBinding>(Json), accepted.Data.GetProperty("amendmentId").GetGuid());
        if (c.OperatingPolicySnapshot.Length == 0) return new(contractId, "NotRecorded", null, null);
        var binding = JsonSerializer.Deserialize<OperatingPolicyBinding>(c.OperatingPolicySnapshot, Json);
        if (binding is null || !c.Terms.Contains(binding.ContentHash, StringComparison.Ordinal) || !c.Terms.Contains(binding.Content, StringComparison.Ordinal))
            return new(contractId, "NeedsReview", null, null);
        var signed = new[] { c.OwnerSignerId, c.TenantUserId }.All(id => c.Signatures.Any(s => s.SignerUserId == id && s.SnapshotHash == c.SnapshotHash &&
            s.SignedAt != null && (s.Status == SignatureStatus.Signed || c.IsDevelopmentDemo && s.Status == SignatureStatus.Simulated)));
        return new(contractId, signed ? "Accepted" : "PendingSignatures", binding, null);
    }
    public async Task<Guid> AmendAsync(Guid contractId, PolicyAmendmentInput input, Guid key, CancellationToken t)
    {
        Owner(); Text(input.Reason, 2000); if (key == Guid.Empty) throw new PropertyException(400, "idempotency_key_required");
        var initial = await ContractScope(contractId, t);
        return await Store.TransactionAsync(initial.Room.LocationId, async () =>
        {
            var c = await ContractScope(contractId, t); var doc = await Document(input.PolicyId, "OperatingPolicy", true, t);
            if (c.Status != ContractStatus.Active || c.Kind == ContractKind.Addendum || doc.Status != "Published" || doc.LocationId != c.Room.LocationId ||
                input.EffectiveFrom < c.StartDate || input.EffectiveFrom >= c.EndDate || input.EffectiveFrom < Read<OperatingPolicyWrite>(doc).EffectiveFrom)
                throw new PropertyException(409, "policy_amendment_not_eligible");
            var operationId = Key($"policy-amendment:{Actor}:{key}");
            if (await Store.GetAsync(operationId, "PolicyAmendmentCommand", t) is { } prior)
            {
                if (prior.Data.GetProperty("fingerprint").GetString() != Hash(new { contractId, input })) throw new PropertyException(409, "idempotency_conflict");
                return prior.Data.GetProperty("amendmentId").GetGuid();
            }
            var duplicates = (await Store.ListAsync(c.Room.LocationId, "PolicyAmendmentCommand", t)).Where(d =>
                d.Data.TryGetProperty("contractId", out var parentId) && parentId.GetGuid() == contractId &&
                d.Data.GetProperty("policyId").GetGuid() == input.PolicyId && d.Data.GetProperty("effectiveFrom").Deserialize<DateOnly>() == input.EffectiveFrom);
            foreach (var duplicate in duplicates)
            {
                var existingAmendment = await Store.ContractAsync(duplicate.Data.GetProperty("amendmentId").GetGuid(), t);
                if (existingAmendment?.Status == ContractStatus.Cancelled) continue;
                if (duplicate.Data.GetProperty("fingerprint").GetString() != Hash(new { contractId, input })) throw new PropertyException(409, "policy_amendment_already_prepared");
                return duplicate.Data.GetProperty("amendmentId").GetGuid();
            }
            var binding = Binding(doc);
            var amendment = new Contract
            {
                RoomId = c.RoomId,
                ParentContractId = c.Id,
                OwnerSignerId = c.OwnerSignerId,
                TenantUserId = c.TenantUserId,
                RepresentativeResidentId = c.RepresentativeResidentId,
                Kind = ContractKind.Addendum,
                StartDate = input.EffectiveFrom,
                EndDate = c.EndDate,
                MonthlyRent = c.MonthlyRent,
                RequiredDeposit = 0,
                IsDevelopmentDemo = c.IsDevelopmentDemo,
                OperatingPolicySnapshot = JsonSerializer.Serialize(binding, Json),
                Terms = $"PHỤ LỤC THAY ĐỔI NỘI QUY CỦA HỢP ĐỒNG {c.Id}\nNgày hiệu lực: {input.EffectiveFrom:yyyy-MM-dd}\nLý do: {input.Reason.Trim()}\nNội quy {binding.PolicyId} phiên bản {binding.Version} SHA256 {binding.ContentHash}\n{binding.Title}\n{binding.Content}\nPhụ lục này chỉ thay đổi nội quy nêu trên; các điều khoản khác của hợp đồng gốc được giữ nguyên.",
                Residents = c.Residents.Select(r => new ContractResident { ResidentId = r.ResidentId, Role = r.Role, ResidenceFrom = input.EffectiveFrom }).ToList()
            };
            amendment.SnapshotHash = ContractDocumentSnapshot.Hash(new(amendment.Id, amendment.RoomId, amendment.OwnerSignerId, amendment.TenantUserId!.Value,
                amendment.RepresentativeResidentId, amendment.Residents.Select(r => r.ResidentId).Order().ToArray(), amendment.StartDate, amendment.EndDate,
                amendment.MonthlyRent, 0, null, 0, amendment.Terms, ""));
            if (amendment.Terms.Length > 12000) throw new PropertyException(400, "contract_and_policy_terms_too_long");
            await Store.SaveContractAsync(amendment, Actor, "OperatingPolicyAmendmentPrepared", t);
            await Store.SaveAsync(operationId, c.Room.LocationId, "PolicyAmendmentCommand", "Completed", new { contractId, policyId = input.PolicyId, effectiveFrom = input.EffectiveFrom, amendmentId = amendment.Id, fingerprint = Hash(new { contractId, input }) }, 0, Actor, t);
            return amendment.Id;
        }, t);
    }
    public async Task ApplyAmendmentAsync(Contract amendment, CancellationToken t)
    {
        Owner(); var parent = await ContractScope(amendment.ParentContractId ?? throw new PropertyException(409, "amendment_parent_required"), t);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        if (parent.Status != ContractStatus.Active || parent.RoomId != amendment.RoomId || parent.TenantUserId != amendment.TenantUserId ||
            today < amendment.StartDate || today > amendment.EndDate || amendment.OperatingPolicySnapshot.Length == 0) throw new PropertyException(409, "amendment_not_effective");
        var id = Key($"policy-acceptance:{amendment.Id}");
        if (await Store.GetAsync(id, "PolicyAcceptance", t) is not null) return;
        if ((await Store.ListAsync(parent.Room.LocationId, "PolicyAcceptance", t)).Any(d => d.Data.GetProperty("contractId").GetGuid() == parent.Id &&
            d.Data.GetProperty("effectiveFrom").Deserialize<DateOnly>() == amendment.StartDate)) throw new PropertyException(409, "policy_amendment_effective_date_conflict");
        await Store.SaveAsync(id, parent.Room.LocationId, "PolicyAcceptance", "Accepted", new
        {
            contractId = parent.Id,
            amendmentId = amendment.Id,
            effectiveFrom = amendment.StartDate,
            policy = JsonSerializer.Deserialize<OperatingPolicyBinding>(amendment.OperatingPolicySnapshot, Json),
            signedDocumentHash = amendment.SnapshotHash,
            signerEvidence = amendment.Signatures.Select(s => new { s.Id, s.SignerUserId, s.SignedAt, s.SignedHash, s.ProviderReference })
        }, 0, Actor, t);
    }
}
