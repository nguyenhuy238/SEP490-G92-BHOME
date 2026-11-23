using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private bool DemoEnabled => workflowMode?.SimulatedSigningEnabled == true;
    private string? ConfiguredPaymentMode(Guid locationId, Guid ownerId) => paymentOptions?.Enabled == true &&
        paymentOptions.Bound(locationId, ownerId) &&
        (paymentOptions.Mode == "Live" || holdingTestScope?.Allows(locationId) == true || holdingTestScope?.AllowsExternalDatabase == true)
        ? paymentOptions.Mode : null;
    private IContractWorkflowRepository Workflow => workflowRepository ?? throw new ContractException(503, "contract_workflow_unavailable");
    private IContractDocumentRenderer Renderer => renderer ?? throw new ContractException(503, "contract_template_not_configured");
    private bool CompleteSignature(ContractSignature signature, Contract contract) => contract.IsDevelopmentDemo
        ? DemoEnabled && signature.Status == SignatureStatus.Simulated : signature.Status == SignatureStatus.Signed;
    private void RequireSigningMode(Contract contract)
    {
        if (contract.SigningMode == ContractSigningModes.Internal)
        {
            if (Actor != contract.OwnerSignerId || !user.IsInRole(Roles.Owner))
                throw new ContractException(403, "contract_signer_required");
            if (contract.IsDevelopmentDemo || MainSandboxAcceptance.Read(contract) is not null)
                throw ContractException.Conflict("signing_mode_mismatch");
            if (!AnonymousContractSigningService.AllowsEitherSigningOrder(contract) && AnonymousContractSigningService.AcceptedEvidence(contract) is null)
                throw ContractException.Conflict("tenant_acceptance_required");
            return;
        }
        if (contract.IsDevelopmentDemo != DemoEnabled) throw ContractException.Conflict("signing_mode_mismatch");
    }

    public async Task<ContractWorkflowConfiguration> ConfigurationAsync(CancellationToken t)
    {
        Role(Roles.Owner, Roles.Staff, Roles.Tenant);
        return new(await Renderer.ConfigurationAsync(t), DemoEnabled ? "Simulated" : "External",
            null, "financial_ledger_and_deposit_policy");
    }

    public Task<ContractPreparation> PreparationAsync(Guid? locationId, CancellationToken t)
    {
        Role(Roles.Owner, Roles.Staff);
        if (locationId == Guid.Empty) throw ContractException.Invalid("invalid_location");
        return Workflow.PreparationAsync(new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Staff), false, Today), locationId, t);
    }

    public Task<IReadOnlyList<ContractChoice>> TenantAccountsAsync(CancellationToken t)
    { Role(Roles.Owner); return Workflow.TenantAccountsAsync(t); }

    public Task LinkTenantAccountAsync(Guid residentId, TenantAccountLink input, CancellationToken t)
    {
        Role(Roles.Owner);
        if (residentId == Guid.Empty || input.TenantUserId == Guid.Empty) throw ContractException.Invalid("invalid_account_link");
        return Workflow.LinkTenantAsync(residentId, input.TenantUserId, Actor, clock.GetUtcNow(), t);
    }

    private static ContractDocumentView DocumentView(ContractDocumentFile f) => new(f.Id, f.ContractId, f.Kind.ToString(),
        f.SnapshotHash, f.TemplateId, f.TemplateVersion, f.DevelopmentOnly, f.RecordedAt);

    public Task<ContractDocumentView> GeneratePreviewAsync(Guid id, Guid key, CancellationToken t) =>
        Mutate(id, [Roles.Owner, Roles.Staff, Roles.Tenant], async c =>
        {
            RequirePreviewAccess(c);
            if (!Intact(c)) throw ContractException.Conflict("signed_terms_changed");
            if (await Replay(key, "preview", id, t) is { } prior)
                return DocumentView(await Workflow.FileAsync(id, prior, t) ?? throw ContractException.Missing());
            if (c.Kind == ContractKind.Main && c.DraftMetadata != "{}")
            {
                var reviewed = (await Workflow.FilesAsync(id, ContractFileKind.Preview, t)).SingleOrDefault(f => f.SnapshotHash == c.SnapshotHash && f.TemplateId == "main-tenancy-docx-v1")
                    ?? throw ContractException.Conflict("signing_source_document_required");
                await CopyVerifiedFile(reviewed, Stream.Null, t);
                Remember(key, "preview", id, reviewed.Id); return DocumentView(reviewed);
            }
            if (c.Kind is ContractKind.Main or ContractKind.Holding && signingDocuments is not null &&
                await signingDocuments.ReadAsync(Document(c), t) is { } canonical)
            {
                var hash = FileHash(canonical);
                var sourceFile = (await Workflow.FilesAsync(id, ContractFileKind.Preview, t)).FirstOrDefault(f => f.SnapshotHash == c.SnapshotHash &&
                    f.FileHash == hash);
                if (sourceFile is not null)
                {
                    Remember(key, "preview", id, sourceFile.Id); return DocumentView(sourceFile);
                }
                // Legacy Holding invitations may have the only copy of the reviewed PDF.
                // Do not render a new preview from the snapshot once consent is tied to a file hash.
                if (c.Kind == ContractKind.Main) throw ContractException.Conflict("signing_source_document_required");
                var legacy = new ContractDocumentFile
                {
                    ContractId = id,
                    Kind = ContractFileKind.Preview,
                    SnapshotHash = c.SnapshotHash,
                    FileHash = hash,
                    ContentType = "application/pdf",
                    Length = canonical.Length,
                    RecordedByUserId = Actor,
                    RecordedAt = clock.GetUtcNow()
                };
                legacy.ObjectKey = $"contracts/{id:N}/preview/{legacy.Id:N}.pdf";
                await files.PutAsync(c.RoomId, legacy.ObjectKey, canonical, legacy.ContentType, t);
                repository.Add(legacy);
                Remember(key, "preview", id, legacy.Id);
                Audit("ContractPreviewGenerated", id);
                return DocumentView(legacy);
            }
            var template = await Renderer.ConfigurationAsync(t);
            await Renderer.ValidateAsync(Document(c), t);
            var existing = await Workflow.PreviewAsync(id, c.SnapshotHash, template.Id, template.Version, t);
            if (existing is not null)
            {
                Remember(key, "preview", id, existing.Id);
                return DocumentView(existing);
            }
            var bytes = await Renderer.RenderAsync(Document(c), t);
            var file = new ContractDocumentFile
            {
                ContractId = id,
                Kind = ContractFileKind.Preview,
                SnapshotHash = c.SnapshotHash,
                TemplateId = template.Id,
                TemplateVersion = template.Version,
                DevelopmentOnly = template.DevelopmentOnly,
                FileHash = FileHash(bytes),
                ContentType = "application/pdf",
                Length = bytes.Length,
                RecordedByUserId = Actor,
                RecordedAt = clock.GetUtcNow()
            };
            file.ObjectKey = $"contracts/{id:N}/preview/{file.Id:N}.pdf";
            await files.PutAsync(c.RoomId, file.ObjectKey, bytes, file.ContentType, t);
            repository.Add(file); Remember(key, "preview", id, file.Id); Audit("ContractPreviewGenerated", id);
            return DocumentView(file);
        }, t);

    public async Task<IReadOnlyList<ContractDocumentView>> PreviewDocumentsAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        RequirePreviewAccess(c);
        return (await Workflow.FilesAsync(id, ContractFileKind.Preview, t))
            .Where(f => !StaffPreviewOnly(c) || f.SnapshotHash == c.SnapshotHash).Select(DocumentView).ToArray();
    }

    public async Task CopyPreviewAsync(Guid id, Guid fileId, Stream output, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        RequirePreviewAccess(c);
        var file = await Workflow.FileAsync(id, fileId, t) ?? throw ContractException.Missing();
        if (file.Kind != ContractFileKind.Preview) throw ContractException.Missing();
        if (StaffPreviewOnly(c) && file.SnapshotHash != c.SnapshotHash)
            throw ContractException.Conflict("signed_terms_changed");
        await CopyVerifiedFile(file, output, t);
    }

    private bool StaffPreviewOnly(Contract c) => user.IsInRole(Roles.Staff) &&
        !(user.IsInRole(Roles.Owner) && c.OwnerSignerId == Actor) &&
        !(user.IsInRole(Roles.Tenant) && c.TenantUserId == Actor);

    private void RequirePreviewAccess(Contract c)
    {
        if (StaffPreviewOnly(c) && (c.Kind != ContractKind.Main ||
            c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning)))
            throw new ContractException(403, "contract_role_forbidden");
    }

    private async Task CopyVerifiedFile(ContractDocumentFile file, Stream output, CancellationToken t)
    {
        using var buffer = new MemoryStream();
        await storage.CopyToAsync(file.ObjectKey, buffer, t);
        if (buffer.Length != file.Length || FileHash(buffer) != file.FileHash)
            throw ContractException.Conflict("contract_document_integrity_failed");
        buffer.Position = 0; await buffer.CopyToAsync(output, t);
    }

    public async Task<IReadOnlyList<ContractHistoryView>> HistoryAsync(Guid id, CancellationToken t)
    { await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t); return await Workflow.HistoryAsync(id, t); }
    public async Task<IReadOnlyList<DepositVerificationView>> DepositsAsync(Guid id, CancellationToken t)
    { await Load(id, [Roles.Owner, Roles.Tenant], t); return await Workflow.DepositsAsync(id, t); }
}
