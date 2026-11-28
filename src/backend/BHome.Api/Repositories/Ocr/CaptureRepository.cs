using BHome.Application.Common;
using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OpenCvSharp;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureRepository(BHomePersistenceContext db, CaptureScope scope, IIdentityProtection protection,
    IObjectStorage storage, UserManager<ApplicationUser> users, TimeProvider clock,
    ILocationAssignments locationAssignments,
    BHome.Application.PropertyManagement.IPropertyRepository properties,
    BHome.Application.Contracts.IContractRepository contracts) : ICaptureRepository
{
    private Guid Actor => scope.UserId;
    private Task<Guid> IdentityOwnerAsync(CancellationToken t) => db.Users.Where(u => u.IsActive &&
        db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Owner)))
        .Select(u => u.Id).SingleAsync(t);
    private async Task Audit(string action, string type, Guid id, CancellationToken t)
    {
        var record = new SecurityAuditRecord { UserId = Actor, Event = action, TargetType = type, TargetId = id, Succeeded = true, OccurredAt = clock.GetUtcNow() };
        if (db is Compact24DbContext compact)
        {
            await using var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(t) : null;
            await NativeCaptureWrites.AuditAsync(compact, record, t);
            if (own is not null) await own.CommitAsync(t);
        }
        else db.SecurityAudit.Add(record);
    }
    private static void Validate(object input)
    {
        if (!Validator.TryValidateObject(input, new ValidationContext(input), [], true)) throw new CaptureValidationException("invalid_input");
    }
    private async Task Save(CancellationToken t)
    {
        try { await db.SaveChangesAsync(t); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        { throw new CaptureConflictException("duplicate_or_conflicting_record"); }
    }
    public async Task<IReadOnlyList<NamedResource>> LocationsAsync(CancellationToken t) => db is Compact24DbContext
        ? await scope.NativeLocations.OrderBy(l => l.Name).Take(100).Select(l => new NamedResource(l.Id, l.Name, null, null, null, null)).ToListAsync(t)
        : await scope.VisibleLocations.AsNoTracking().OrderBy(l => l.Name).Take(100).Select(l => new NamedResource(l.Id, l.Name, null, null, null, null)).ToListAsync(t);
    public async Task<IReadOnlyList<NamedResource>> RoomsAsync(Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext compact) return await NativeRoomsAsync(compact, id, t);
        if (!await scope.VisibleLocations.AnyAsync(l => l.Id == id, t)) throw new OcrAccessException();
        var rooms = await scope.VisibleRooms.AsNoTracking().Where(r => r.LocationId == id).OrderBy(r => r.RoomNumber).Take(100).ToArrayAsync(t);
        var ids = rooms.Select(r => r.Id).ToArray();
        var waitingForOwner = await contracts.RoomsAwaitingMainOwnerSignatureAsync(ids, Guid.Empty, t);
        var today = scope.Today;
        var occupants = await db.Set<Contract>().AsNoTracking().Where(c => ids.Contains(c.RoomId) &&
            c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.StartDate <= today && c.EndDate >= today)
            .SelectMany(c => c.Residents.Select(person => new { c.RoomId, person.ResidentId })).Distinct().ToArrayAsync(t);
        var currentTenants = await db.Set<Contract>().AsNoTracking()
            .Where(c => ids.Contains(c.RoomId) && c.Kind != ContractKind.Holding &&
                c.Status == ContractStatus.Active && c.StartDate <= today && c.EndDate >= today)
            .Join(db.Set<Resident>(), c => c.RepresentativeResidentId, r => r.Id,
                (c, r) => new { c.RoomId, ResidentId = r.Id, r.OwnerUserId, r.IdentityData })
            .Distinct().ToArrayAsync(t);
        var tenantNames = currentTenants.ToLookup(p => p.RoomId,
            p => CurrentTenantName(p.ResidentId, p.OwnerUserId, p.IdentityData));
        return rooms.Select(r => new NamedResource(r.Id, r.RoomNumber, r.LocationId, r.Status.ToString(), r.Capacity,
            Math.Max(0, r.Capacity - occupants.Count(p => p.RoomId == r.Id)))
        {
            CurrentTenantLabels = tenantNames[r.Id].OrderBy(label => label, StringComparer.CurrentCulture).ToArray(),
            WaitingForOwnerSignature = waitingForOwner.Contains(r.Id)
        }).ToArray();
    }
    private async Task<IReadOnlyList<NamedResource>> NativeRoomsAsync(Compact24DbContext compact, Guid id, CancellationToken t)
    {
        if (!await scope.LocationVisibleAsync(id, t)) throw new OcrAccessException();
        var rooms = await scope.NativeRooms.Where(r => r.LocationId == id).OrderBy(r => r.RoomNumber).Take(100).ToArrayAsync(t);
        var ids = rooms.Select(r => r.Id).ToArray();
        var waitingForOwner = await contracts.RoomsAwaitingMainOwnerSignatureAsync(ids, Guid.Empty, t);
        var today = scope.Today;
        var active = compact.Set<Native.Contract>().AsNoTracking().Where(c => ids.Contains(c.RoomId) && c.ContractType != "HOLDING" &&
            c.Status == (short)ContractStatus.Active && c.StartDate <= today && c.EndDate >= today);
        var occupants = await (from c in active join p in compact.Set<Native.ContractResident>() on c.Id equals p.ContractId
            select new { c.RoomId, p.ResidentId }).Distinct().ToArrayAsync(t);
        var current = await (from c in active join r in compact.Set<Native.Resident>() on c.RepresentativeResidentId equals r.Id
            select new { c.RoomId, r.Id, r.IdentityOwnerScopeId, r.IdentityData }).Distinct().ToArrayAsync(t);
        var labels = current.ToLookup(r => r.RoomId, r => CurrentTenantName(r.Id, r.IdentityOwnerScopeId, r.IdentityData.GetRawText()));
        return rooms.Select(r => new NamedResource(r.Id, r.RoomNumber, r.LocationId, ((RoomStatus)r.Status).ToString(), r.Capacity,
            Math.Max(0, r.Capacity - occupants.Count(p => p.RoomId == r.Id)))
        { CurrentTenantLabels = labels[r.Id].OrderBy(label => label, StringComparer.CurrentCulture).ToArray(), WaitingForOwnerSignature = waitingForOwner.Contains(r.Id) }).ToArray();
    }
    private string CurrentTenantName(Guid residentId, Guid ownerId, string encryptedIdentity)
    {
        if (string.IsNullOrWhiteSpace(encryptedIdentity) || encryptedIdentity == "{}")
            return "Chưa có tên xác minh";
        try
        {
            var identity = JsonSerializer.Deserialize<EncryptedIdentity>(encryptedIdentity);
            if (identity is null) return "Chưa có tên xác minh";
            var bytes = protection.Decrypt(identity, new(ownerId, residentId));
            try
            {
                var name = JsonSerializer.Deserialize<IdentityConfirmation>(bytes)?.FullName;
                return string.IsNullOrWhiteSpace(name) ? "Chưa có tên xác minh" : name;
            }
            finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        catch (Exception e) when (e is JsonException or CryptographicException or InvalidOperationException)
        {
            return "Chưa có tên xác minh";
        }
    }
    public async Task<IReadOnlyList<NamedResource>> StaffAsync(CancellationToken t) => await db.Users.AsNoTracking()
        .Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id &&
            db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))).OrderBy(u => u.UserName).Take(100)
        .Select(u => new NamedResource(u.Id, u.UserName!, null, null, null, null)).ToListAsync(t);
    public async Task<IdResult> CreateStaffAsync(StaffInput x, CancellationToken t)
    {
        Validate(x);
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var u = new ApplicationUser { UserName = x.UserName.Trim(), Email = x.Email.Trim(), LockoutEnabled = true };
        db.PrepareUserRole(u, Roles.Staff);
        var identityResult = await users.CreateAsync(u, x.Password);
        if (!identityResult.Succeeded)
            throw AccountValidationFailure(identityResult.Errors.Select(e => e.Code));
        if (!await users.IsInRoleAsync(u, Roles.Staff) && !(await users.AddToRoleAsync(u, Roles.Staff)).Succeeded) throw new CaptureConflictException("staff_role_unavailable");
        await Audit("StaffCreated", "User", u.Id, t); await Save(t); await tx.CommitAsync(t); return new(u.Id);
    }

    // Identity descriptions can embed the submitted username/email or provider text.
    // Only known categories determine a field; neither descriptions nor unknown codes
    // are part of the public API error contract.
    internal static Exception AccountValidationFailure(IEnumerable<string> codes)
    {
        var errors = new Dictionary<string, List<string>>();
        foreach (var code in codes)
        {
            var (field, message) = code switch
            {
                "DuplicateUserName" => ("userName", "Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác."),
                "InvalidUserName" => ("userName", "Tên đăng nhập không đúng định dạng. Vui lòng kiểm tra lại."),
                "DuplicateEmail" => ("email", "Email đã được sử dụng. Kiểm tra lại hoặc chọn email khác."),
                "InvalidEmail" => ("email", "Email không đúng định dạng. Ví dụ: ten@gmail.com"),
                "PasswordTooShort" or "PasswordRequiresNonAlphanumeric" or "PasswordRequiresDigit" or
                "PasswordRequiresLower" or "PasswordRequiresUpper" or "PasswordRequiresUniqueChars" =>
                    ("password", "Mật khẩu chưa đáp ứng yêu cầu bảo mật. Vui lòng chọn mật khẩu khác."),
                _ => (null, null)
            };
            if (field is null) return new CaptureValidationException("staff_account_invalid");
            if (!errors.TryGetValue(field, out var values)) errors[field] = values = [];
            if (!values.Contains(message!)) values.Add(message!);
        }
        return errors.Count == 0 ? new CaptureValidationException("staff_account_invalid") :
            new BHome.Application.Common.InputValidationException(errors.ToDictionary(x => x.Key, x => x.Value.ToArray()));
    }
    public async Task<IdResult> AssignStaffAsync(AssignmentInput x, CancellationToken t)
    {
        if (x.EffectiveFrom == default || x.EffectiveTo is null || x.EffectiveTo < x.EffectiveFrom)
            throw new CaptureValidationException("invalid_assignment_dates");
        var result = await locationAssignments.CreateAssignmentAsync(Actor, x.LocationId, x.StaffUserId,
            x.EffectiveFrom, x.EffectiveTo.Value, t);
        if (result.Status == CreateAssignmentStatus.DateRangeOverlaps) throw new CaptureConflictException("duplicate_or_conflicting_record");
        if (result.Status != CreateAssignmentStatus.Created || result.Assignment is null) throw new OcrAccessException();
        await Audit("StaffAssigned", "Assignment", result.Assignment.Id, t); await Save(t); return new(result.Assignment.Id);
    }
    public async Task<IdResult> CreateResidentAsync(ResidentInput x, CancellationToken t)
    {
        Validate(x); if (!Enum.IsDefined(x.ResidentType) || string.IsNullOrWhiteSpace(x.DisplayLabel)) throw new CaptureValidationException("invalid_resident");
        var locationId = (db is Compact24DbContext
            ? await scope.NativeRooms.Where(r => r.Id == x.RoomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t)
            : await scope.VisibleRooms.Where(r => r.Id == x.RoomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t)) ?? throw new OcrAccessException();
        return await properties.WithLocationLockAsync(locationId, async () =>
        {
            if (!(db is Compact24DbContext
                    ? await scope.NativeRooms.AnyAsync(r => r.Id == x.RoomId && r.Status != (short)RoomStatus.Unavailable, t)
                    : await scope.VisibleRooms.AnyAsync(r => r.Id == x.RoomId && r.Location.IsActive && r.Status != RoomStatus.Unavailable, t)))
                throw new CaptureConflictException("room_unavailable");
            var resident = new Resident
            {
                RoomId = x.RoomId,
                DisplayLabel = x.DisplayLabel.Trim(),
                ResidentType = x.ResidentType,
                // Onboarding is not an email/account reservation. Contact is collected by signing invitations.
                ContactEmail = null,
                OwnerUserId = await IdentityOwnerAsync(t)
            };
            if (db is Compact24DbContext compact) await NativeCaptureWrites.ResidentAsync(compact, resident, true, t);
            else db.Add(resident);
            await Audit("ResidentCreated", "Resident", resident.Id, t); return new IdResult(resident.Id);
        }, t);
    }
    public async Task<IReadOnlyList<ResidentSummary>> ResidentsAsync(Guid locationId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            if (!await scope.LocationVisibleAsync(locationId, t)) throw new OcrAccessException();
            var rows = await compact.Set<Native.Resident>().FromSqlInterpolated($"""
                SELECT r.* FROM residents r JOIN rooms room ON room.id=r.current_room_id WHERE room.location_id={locationId}
                ORDER BY (SELECT (h->'state'->>'createdAt')::timestamptz FROM jsonb_array_elements(r.history) WITH ORDINALITY a(h,n)
                    WHERE h->>'recordType'='Resident' ORDER BY n DESC LIMIT 1) DESC NULLS LAST LIMIT 100
                """).AsNoTracking().Where(r => scope.NativeRooms.Any(room => room.Id == r.CurrentRoomId)).ToArrayAsync(t);
            return rows.Select(NativeResidentPersistence.Read).Select(r => new ResidentSummary(r.Id, r.RoomId!.Value, r.DisplayLabel,
                r.ResidentType, r.VerificationStatus, r.ConfirmedAt, r.ContactEmail)).ToArray();
        }
        if (!await scope.VisibleLocations.AnyAsync(l => l.Id == locationId, t)) throw new OcrAccessException();
        return await db.Set<Resident>().AsNoTracking().Where(r => r.Room.LocationId == locationId && scope.VisibleRooms.Any(room => room.Id == r.RoomId))
            .OrderByDescending(r => r.CreatedAt).Take(100).Select(r => new ResidentSummary(r.Id, r.RoomId!.Value, r.DisplayLabel, r.ResidentType, r.VerificationStatus, r.ConfirmedAt,
                db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? r.ContactEmail : null)).ToListAsync(t);
    }
    public async Task<IdentityConfirmationResult> ConfirmIdentityAsync(Guid id, IdentityConfirmation x, CancellationToken t)
    {
        Validate(x);
        if (!x.HumanConfirmed || string.IsNullOrWhiteSpace(x.FullName) || x.DateOfBirth == default || x.DateOfBirth > scope.Today || x.DateOfIssue > scope.Today)
            throw new CaptureValidationException("invalid_confirmed_identity");
        await using var tx = await db.Database.BeginTransactionAsync(t);
        if (!(db is Compact24DbContext physicalDb
            ? await physicalDb.Set<Native.Resident>().AnyAsync(r => r.Id == id && scope.NativeRooms.Any(room => room.Id == r.CurrentRoomId), t)
            : await db.Set<Resident>().AnyAsync(r => r.Id == id && scope.VisibleRooms.Any(room => room.Id == r.RoomId), t))) throw new OcrAccessException();
        var identityOwner = await IdentityOwnerAsync(t);
        // One authoritative chain lock serializes all creators, including legacy Staff-scoped records.
        await db.Locked<ApplicationUser>(identityOwner).SingleAsync(t);
        Resident resident;
        if (db is Compact24DbContext compact)
        {
            var physical = await compact.Set<Native.Resident>().FromSqlInterpolated($"SELECT * FROM residents WHERE id={id} FOR UPDATE").AsNoTracking().SingleAsync(t);
            resident = NativeResidentPersistence.Read(physical);
        }
        else resident = await db.Locked<Resident>(id).SingleAsync(t);
        // Re-evaluate assignment after the lock, without trusting any incoming Location/Owner ID.
        if (!await scope.RoomVisibleAsync(resident.RoomId, t)) throw new OcrAccessException();
        // Unverified legacy rows have no encrypted identity to rebind. Verified envelopes retain their AAD.
        if (resident.VerificationStatus == IdentityVerificationStatus.Pending) resident.OwnerUserId = identityOwner;
        var normalized = x with { FullName = x.FullName.Trim().Normalize(), CitizenIdentityNumber = x.CitizenIdentityNumber.Trim(), ResidentialAddress = x.ResidentialAddress?.Trim().Normalize() };
        IdentityMatchIndex index;
        try { index = protection.CreateMatchIndex(normalized.CitizenIdentityNumber, resident.OwnerUserId); }
        catch (ArgumentException) { throw new CaptureValidationException("invalid_citizen_number"); }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(normalized);
        try
        {
            var ps = new IdentityProtectionScope(resident.OwnerUserId, resident.Id);
            if (resident.VerificationStatus == IdentityVerificationStatus.Verified)
            {
                var original = protection.Decrypt(JsonSerializer.Deserialize<EncryptedIdentity>(resident.IdentityData)!, ps);
                try { if (!original.AsSpan().SequenceEqual(bytes)) throw new CaptureConflictException("identity_already_confirmed"); }
                finally { CryptographicOperations.ZeroMemory(original); }
            }
            else
            {
                if (resident.VerificationStatus != IdentityVerificationStatus.Pending) throw new CaptureConflictException("identity_not_pending");
                var legacyScopes = db is Compact24DbContext native
                    ? await native.Set<Native.Resident>().Where(r => r.IdentityHmac != null).Select(r => r.IdentityOwnerScopeId).Distinct().ToArrayAsync(t)
                    : await db.Set<Resident>().Where(r => r.IdentityHmac != null).Select(r => r.OwnerUserId).Distinct().ToArrayAsync(t);
                var digests = legacyScopes.Append(identityOwner).Distinct()
                    .SelectMany(owner => protection.CreateMatchIndexes(normalized.CitizenIdentityNumber, owner)).Select(i => i.Digest).ToArray();
                if (db is Compact24DbContext residentDb
                    ? await residentDb.Set<Native.Resident>().AnyAsync(r => r.Id != resident.Id && r.IdentityHmac != null && digests.Contains(r.IdentityHmac), t)
                    : await db.Set<Resident>().AnyAsync(r => r.Id != resident.Id && r.IdentityHmac != null && digests.Contains(r.IdentityHmac), t))
                    throw new CaptureConflictException("duplicate_or_conflicting_record");
                resident.IdentityData = JsonSerializer.Serialize(protection.Encrypt(bytes, ps));
                resident.IdentityHmac = index.Digest; resident.HmacKeyVersion = index.KeyVersion;
                resident.VerificationStatus = IdentityVerificationStatus.Verified; resident.ConfirmedByUserId = Actor; resident.ConfirmedAt = clock.GetUtcNow();
                if (db is Compact24DbContext physicalContext)
                    await NativeCaptureWrites.ResidentAsync(physicalContext, resident, false, t);
                await Audit("IdentityConfirmed", "Resident", resident.Id, t); await Save(t);
            }
            await tx.CommitAsync(t); return new(resident.Id, resident.VerificationStatus, resident.ConfirmedAt);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task<IdResult> CreateMeterAsync(MeterInput x, CancellationToken t)
    {
        Validate(x); if (!Enum.IsDefined(x.UtilityType) || !Enum.IsDefined(x.Display) || x.InstalledOn == default || string.IsNullOrWhiteSpace(x.Code)) throw new CaptureValidationException("invalid_meter");
        if (!await scope.RoomVisibleAsync(x.RoomId, t)) throw new OcrAccessException();
        var m = new Meter { RoomId = x.RoomId, Code = x.Code.Trim(), UtilityType = x.UtilityType, Display = x.Display, DecimalPlaces = x.DecimalPlaces, InstalledOn = x.InstalledOn };
        if (db is Compact24DbContext compact)
        {
            await using var tx = await db.Database.BeginTransactionAsync(t);
            await NativeCaptureWrites.MeterAsync(compact, m, t);
            await Audit("MeterCreated", "Meter", m.Id, t);
            await tx.CommitAsync(t);
        }
        else { db.Add(m); await Audit("MeterCreated", "Meter", m.Id, t); await Save(t); }
        return new(m.Id);
    }
    public Task<Guid?> ActiveMeterLocationAsync(Guid meterId, CancellationToken t) => db is Compact24DbContext compact
        ? (from m in compact.Set<Native.Meter>() join r in scope.NativeRooms on m.RoomId equals r.Id where m.Id == meterId && m.IsActive select (Guid?)r.LocationId).SingleOrDefaultAsync(t)
        : db.Set<Meter>().AsNoTracking()
        .Where(m => m.Id == meterId && m.IsActive && scope.VisibleRooms.Any(r => r.Id == m.RoomId))
        .Select(m => (Guid?)m.Room.LocationId).SingleOrDefaultAsync(t);
    public async Task<IReadOnlyList<NamedResource>> MetersAsync(Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            if (!await scope.LocationVisibleAsync(id, t)) throw new OcrAccessException();
            return await (from m in compact.Set<Native.Meter>() join r in scope.NativeRooms on m.RoomId equals r.Id
                where r.LocationId == id orderby r.RoomNumber select new NamedResource(m.Id, r.RoomNumber + " · " + m.MeterCode, m.RoomId, null, null, null)
                { InstalledOn = m.InstalledOn, IsActive = m.IsActive }).Take(100).ToListAsync(t);
        }
        if (!await scope.VisibleLocations.AnyAsync(l => l.Id == id, t)) throw new OcrAccessException();
        return await db.Set<Meter>().AsNoTracking().Where(m => m.Room.LocationId == id && scope.VisibleRooms.Any(r => r.Id == m.RoomId))
            .OrderBy(m => m.Room.RoomNumber).Take(100).Select(m => new NamedResource(m.Id, m.Room.RoomNumber + " · " + m.Code, m.RoomId, null, null, null)
            { InstalledOn = m.InstalledOn, IsActive = m.IsActive }).ToListAsync(t);
    }
    public async Task<IdResult> CreateTaskAsync(MeterTaskInput x, CancellationToken t)
    {
        if (!Enum.IsDefined(x.Purpose) || x.ReadingDate == default || (x.Purpose == ReadingPurpose.Periodic && (x.BillingPeriod is null || x.BillingPeriod.Value.Day != 1 || x.ReadingDate.Year != x.BillingPeriod.Value.Year || x.ReadingDate.Month != x.BillingPeriod.Value.Month)) || (x.Purpose != ReadingPurpose.Periodic && x.BillingPeriod != null)) throw new CaptureValidationException("invalid_reading_period");
        var meter = (db is Compact24DbContext native
            ? await (from m in native.Set<Native.Meter>() join r in scope.NativeRooms on m.RoomId equals r.Id
                where m.Id == x.MeterId && m.IsActive select new { m.InstalledOn, m.RoomId, r.LocationId }).SingleOrDefaultAsync(t)
            : await db.Set<Meter>().Where(m => m.Id == x.MeterId && m.IsActive && scope.VisibleRooms.Any(r => r.Id == m.RoomId))
                .Select(m => new { m.InstalledOn, m.RoomId, m.Room.LocationId }).SingleOrDefaultAsync(t)) ?? throw new OcrAccessException();
        if (x.ReadingDate < meter.InstalledOn) throw new CaptureValidationException("reading_before_installation");
        if (x.Purpose == ReadingPurpose.Final)
        {
            if (x.ContractId is null || !(db is Compact24DbContext
                ? await db.Database.SqlQuery<bool>($"""
                    SELECT EXISTS(SELECT 1 FROM contracts WHERE id={x.ContractId} AND room_id={meter.RoomId} AND status=3
                        AND (move_out->'current'->>'status')::int=1 AND (move_out->'current'->>'proposedDate')::date<={x.ReadingDate}) AS "Value"
                    """).SingleAsync(t)
                : await db.Set<Contract>().AnyAsync(c => c.Id == x.ContractId && c.RoomId == meter.RoomId && c.Status == ContractStatus.Active &&
                    db.Set<ContractMoveOut>().Any(m => m.ContractId == c.Id && m.Status == MoveOutStatus.Approved && m.ProposedDate <= x.ReadingDate), t)))
                throw new CaptureConflictException("approved_contract_move_out_required");
        }
        else if (x.ContractId is not null)
        {
            // A confirmed initial reading belongs to the new tenancy, not the
            // physical meter's lifetime. The Owner may retry/backfill only for
            // an active Main contract of this very room.
            if (x.Purpose != ReadingPurpose.Initial) throw new CaptureValidationException("initial_or_final_contract_reference_only");
            if (!await InitialContractActiveAsync(x.ContractId, meter.RoomId, x.ReadingDate, t))
                throw new CaptureConflictException("active_contract_initial_required");
        }
        var task = new OperationalTask { LocationId = meter.LocationId, Title = "Meter reading", MeterId = x.MeterId, Purpose = x.Purpose, ReadingDate = x.ReadingDate, BillingPeriod = x.BillingPeriod, ContractId = x.ContractId };
        if (db is Compact24DbContext compact)
        {
            await using var tx = await db.Database.BeginTransactionAsync(t);
            await NativeCaptureWrites.TaskAsync(compact, task, true, task.Version, t);
            await Audit("MeterTaskAssigned", "Task", task.Id, t);
            await tx.CommitAsync(t);
        }
        else { db.Add(task); await Audit("MeterTaskAssigned", "Task", task.Id, t); await Save(t); }
        return new(task.Id);
    }
    private Task<bool> InitialContractActiveAsync(Guid? contractId, Guid roomId, DateOnly date, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Set<Native.Contract>().AnyAsync(c => c.Id == contractId && c.RoomId == roomId && c.ContractType == "MAIN" &&
            c.PreviousContractId == null && c.Status == (short)ContractStatus.Active && c.StartDate <= date, t)
        : db.Set<Contract>().AnyAsync(c => c.Id == contractId && c.RoomId == roomId && c.Kind == ContractKind.Main &&
            c.PreviousContractId == null && c.Status == ContractStatus.Active && c.StartDate <= date, t);

    private IQueryable<MeterTaskSummary> NativeTaskSummaries()
    {
        var now = clock.BusinessUtcNow();
        var today = scope.Today;
        return db.Database.SqlQuery<MeterTaskSummary>($"""
            SELECT t.id AS "Id",m.id AS "MeterId",l.name AS "Location",r.room_number AS "Room",m.meter_code AS "MeterCode",
                m.utility_type::int AS "UtilityType",m.display_type::int AS "Display",m.decimal_places::int AS "DecimalPlaces",
                (t.task_data->'state'->>'purpose')::int AS "Purpose",(t.task_data->'state'->>'readingDate')::date AS "ReadingDate",
                t.billing_period AS "BillingPeriod",t.status::int AS "Status",
                CASE WHEN t.status='2' THEN confirmed.previous_value ELSE
                    (SELECT previous.confirmed_value FROM meter_readings previous JOIN operational_tasks pt ON pt.id=previous.operational_task_id
                     WHERE previous.meter_id=m.id AND (
                       (pt.task_data->'state'->>'readingDate')::date < (t.task_data->'state'->>'readingDate')::date OR
                       ((pt.task_data->'state'->>'readingDate')::date=(t.task_data->'state'->>'readingDate')::date AND (
                         ((t.task_data->'state'->>'purpose')::int=0 AND t.contract_id IS NOT NULL AND pt.contract_id IS DISTINCT FROM t.contract_id) OR
                         ((t.task_data->'state'->>'purpose')::int=1 AND (pt.task_data->'state'->>'purpose')::int=0) OR
                         ((t.task_data->'state'->>'purpose')::int=2 AND ((pt.task_data->'state'->>'purpose')::int<>2 OR pt.contract_id IS DISTINCT FROM t.contract_id)))))
                     ORDER BY previous.confirmed_at DESC,previous.id LIMIT 1) END AS "PreviousValue",
                t.contract_id AS "ContractId",confirmed.id AS "ConfirmedReadingId",t.due_at AS "DueAt",
                CASE WHEN (t.task_data->'state'->>'purpose')::int=1 AND t.status NOT IN ('2','3') THEN
                    (SELECT u.id FROM jsonb_array_elements(l.staff_assignments) a JOIN users u ON u.id=(a->>'staffUserId')::uuid
                     WHERE (a->>'startDate')::date<={today} AND (a->>'endDate')::date>={today} AND u.is_active AND 'Staff'=ANY(u.roles)
                       AND (NOT EXISTS(SELECT 1 FROM staff_employments e WHERE e.staff_user_id=u.id) OR
                         ((SELECT count(*) FROM staff_employments e WHERE e.staff_user_id=u.id AND e.start_date<={today} AND (e.end_date IS NULL OR e.end_date>={today}))=1
                           AND EXISTS(SELECT 1 FROM staff_employments e WHERE e.staff_user_id=u.id AND e.start_date<={today} AND (e.end_date IS NULL OR e.end_date>={today}) AND lower(btrim(e.status))='active'))) LIMIT 1)
                    ELSE t.assigned_user_id END AS "AssignedStaffUserId",
                (t.task_data->'state'->>'automationPlanId')::uuid AS "AutomationPlanId",t.version AS "Version",t.location_id AS "LocationId",m.room_id AS "RoomId",
                ((t.task_data->'state'->>'purpose')::int=1 AND t.billing_period IS NOT NULL AND t.due_at IS NOT NULL AND t.due_at<{now} AND t.status NOT IN ('2','3')) AS "IsOverdue",
                false AS "CanCorrect"
            FROM operational_tasks t JOIN meters m ON m.id=t.meter_id JOIN rooms r ON r.id=m.room_id JOIN locations l ON l.id=r.location_id
            LEFT JOIN meter_readings confirmed ON confirmed.operational_task_id=t.id WHERE t.task_type='METER_READ'
            """).Where(x => scope.NativeTasks.Any(task => task.Id == x.Id));
    }
    private IQueryable<MeterTaskSummary> TaskSummaries(IQueryable<OperationalTask> tasks)
    {
        var now = clock.BusinessUtcNow();
        return tasks
        .Select(x => new MeterTaskSummary(x.Id, x.MeterId!.Value, x.Meter.Room.Location.Name, x.Meter.Room.RoomNumber, x.Meter.Code,
            x.Meter.UtilityType, x.Meter.Display, x.Meter.DecimalPlaces, x.Purpose, x.ReadingDate, x.BillingPeriod, x.Status,
            x.Status == MeterTaskStatus.Completed
                ? db.Set<MeterReading>().Where(r => r.TaskId == x.Id).Select(r => r.PreviousValue).FirstOrDefault()
                : db.Set<MeterReading>().Where(r => r.MeterId == x.MeterId &&
                    db.Set<OperationalTask>().Any(previous => previous.Id == r.TaskId &&
                        (previous.ReadingDate < x.ReadingDate ||
                         (x.Purpose == ReadingPurpose.Initial && x.ContractId != null && previous.ReadingDate == x.ReadingDate && previous.ContractId != x.ContractId) ||
                         (x.Purpose == ReadingPurpose.Periodic && previous.Purpose == ReadingPurpose.Initial && previous.ReadingDate == x.ReadingDate) ||
                        (x.Purpose == ReadingPurpose.Final && previous.ReadingDate == x.ReadingDate &&
                            (previous.Purpose != ReadingPurpose.Final || previous.ContractId != x.ContractId)))))
                    .OrderByDescending(r => r.ConfirmedAt).ThenBy(r => r.Id).Select(r => (decimal?)r.ConfirmedValue).FirstOrDefault(),
            x.ContractId, db.Set<MeterReading>().Where(r => r.TaskId == x.Id).Select(r => (Guid?)r.Id).FirstOrDefault(), x.DueAt,
            x.Purpose == ReadingPurpose.Periodic && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled
                ? db.StaffLocationAssignments.Where(a => a.LocationId == x.LocationId && a.StartDate <= scope.Today && a.EndDate >= scope.Today && scope.EligibleStaff.Contains(a.StaffUserId))
                    .Select(a => (Guid?)a.StaffUserId).FirstOrDefault()
                : x.AssignedStaffUserId,
            x.AutomationPlanId, x.Version, x.LocationId, x.Meter.RoomId,
            x.Purpose == ReadingPurpose.Periodic && x.BillingPeriod != null && x.DueAt.HasValue && x.DueAt.Value < now && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled, false));
    }
    public async Task<IReadOnlyList<MeterTaskSummary>> TasksAsync(CancellationToken t, MeterTaskQuery? q = null)
    {
        if (db is Compact24DbContext)
        {
            var native = NativeTaskSummaries();
            if (q?.LocationId is { } loc) native = native.Where(x => x.LocationId == loc);
            if (q?.RoomId is { } roomId) native = native.Where(x => x.RoomId == roomId);
            if (q?.Status is { } state) native = native.Where(x => x.Status == state);
            if (q?.DueDate is { } day)
            {
                var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
                var start = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), zone));
                var end = start.AddDays(1); native = native.Where(x => x.DueAt >= start && x.DueAt < end);
            }
            return await native.OrderByDescending(x => x.ReadingDate).ThenBy(x => x.Id).Skip(((q?.Page ?? 1) - 1) * 100).Take(100).ToListAsync(t);
        }
        var rows = scope.VisibleTasks.AsNoTracking();
        if (q?.LocationId is { } location) rows = rows.Where(x => x.LocationId == location);
        if (q?.RoomId is { } room) rows = rows.Where(x => x.Meter.RoomId == room);
        if (q?.Status is { } status) rows = rows.Where(x => x.Status == status);
        if (q?.DueDate is { } date)
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
            var start = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), zone));
            var end = start.AddDays(1); rows = rows.Where(x => x.DueAt >= start && x.DueAt < end);
        }
        return await TaskSummaries(rows.OrderByDescending(x => x.ReadingDate).ThenBy(x => x.Id).Skip(((q?.Page ?? 1) - 1) * 100).Take(100)).ToListAsync(t);
    }
    public async Task<MeterTaskSummary> TaskAsync(Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var native = await NativeTaskSummaries().SingleOrDefaultAsync(x => x.Id == id, t) ?? throw new OcrAccessException();
            if (native.ConfirmedReadingId is null) return native;
            var current = await scope.ReadTaskAsync(id, t) ?? throw new OcrAccessException();
            var previous = await scope.TaskReadingAsync(id, t) ?? throw new OcrAccessException();
            var device = await scope.MeterAsync(current.MeterId, t);
            return native with { CanCorrect = await scope.CanCorrectAsync(current, device, previous, t) };
        }
        var summary = await TaskSummaries(scope.VisibleTasks.AsNoTracking().Where(x => x.Id == id)).SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        if (summary.ConfirmedReadingId is null) return summary;
        var task = await scope.VisibleTasks.AsNoTracking().SingleAsync(x => x.Id == id, t);
        var reading = await db.Set<MeterReading>().AsNoTracking().SingleAsync(r => r.TaskId == id, t);
        var meter = await db.Set<Meter>().AsNoTracking().SingleAsync(m => m.Id == task.MeterId, t);
        return summary with { CanCorrect = await scope.CanCorrectAsync(task, meter, reading, t) };
    }

    public async Task<ConfirmedReading> ReadingAsync(Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var physical = await compact.Set<Native.MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id &&
                scope.NativeTasks.Any(task => task.Id == r.OperationalTaskId), t) ?? throw new OcrAccessException();
            return Reading(NativeCaptureReads.Reading(physical));
        }
        var row = await db.Set<MeterReading>().AsNoTracking()
            .SingleOrDefaultAsync(r => r.Id == id && scope.VisibleTasks.Any(task => task.Id == r.TaskId), t)
            ?? throw new OcrAccessException();
        return Reading(row);
    }

    public async Task<IdResult> UploadEvidenceAsync(Guid taskId, Stream input, CancellationToken t)
    {
        var target = (db is Compact24DbContext nativeDb
            ? await (from task in scope.NativeTasks join meter in nativeDb.Set<Native.Meter>() on task.MeterId equals (Guid?)meter.Id
                where task.Id == taskId && meter.IsActive && task.Status != "3" select new { LocationId = task.LocationId!.Value, meter.RoomId }).SingleOrDefaultAsync(t)
            : await scope.VisibleTasks.Where(x => x.Id == taskId && x.Meter.IsActive && x.Status != MeterTaskStatus.Cancelled)
                .Select(x => new { x.LocationId, x.Meter.RoomId }).SingleOrDefaultAsync(t)) ?? throw new OcrAccessException();
        var buffer = new byte[5 * 1024 * 1024 + 1]; var length = 0;
        try
        {
            while (length < buffer.Length) { var read = await input.ReadAsync(buffer.AsMemory(length), t); if (read == 0) break; length += read; }
            ImagePreprocessor.ValidateHeader(buffer.AsSpan(0, length), 5 * 1024 * 1024, 12_000_000);
            using (var decoded = Cv2.ImDecode(buffer.AsSpan(0, length), ImreadModes.Color)) if (decoded.Empty()) throw new OcrInputException("corrupted_image");
            var contentType = buffer[0] == 137 ? "image/png" : "image/jpeg";
            var evidence = new MeterEvidence
            {
                TaskId = taskId,
                UploadedByUserId = Actor,
                ImageHash = Convert.ToHexString(SHA256.HashData(buffer.AsSpan(0, length))),
                ContentType = contentType,
                Length = length,
                ObjectKey = PrivateImageKeys.Evidence(target.LocationId, target.RoomId, "meters", taskId, Guid.NewGuid()),
                CleanupAfter = clock.GetUtcNow().AddMinutes(30)
            };
            // Serialize the durable upload intent with room-cycle deduplication.
            // No object is written until the intent has committed.
            await using (var intent = await db.Database.BeginTransactionAsync(t))
            {
                var locationId = await scope.TaskLocationAsync(taskId, t) ?? throw new OcrAccessException();
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
                var task = await scope.ReadTaskAsync(taskId, t) ?? throw new OcrAccessException();
                var meter = await scope.MeterAsync(task.MeterId, t);
                if (!meter.IsActive || task.Status == MeterTaskStatus.Cancelled) throw new OcrAccessException();
                if (task.Status == MeterTaskStatus.Completed)
                {
                    var reading = await scope.TaskReadingAsync(task.Id, t);
                    if (reading is null || !await scope.CanCorrectAsync(task, meter, reading, t))
                        throw new CaptureConflictException("reading_correction_not_allowed");
                }
                if (db is Compact24DbContext compact) await NativeCaptureWrites.EvidenceAsync(compact, evidence, true, t);
                else { db.Add(evidence); await Save(t); }
                await intent.CommitAsync(t);
            }
            await using var transaction = await db.Database.BeginTransactionAsync(t);
            _ = await scope.LockEvidenceAsync(evidence.Id, t) ?? throw new OcrAccessException();
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
            using var data = new MemoryStream(buffer, 0, length, false);
            await storage.PutAsync(evidence.ObjectKey, data, length, contentType, deadline.Token);
            evidence.IsUploaded = true;
            if (db is Compact24DbContext physical) await NativeCaptureWrites.EvidenceAsync(physical, evidence, false, t);
            else await Save(t);
            await transaction.CommitAsync(t); return new(evidence.Id);
        }
        finally { CryptographicOperations.ZeroMemory(buffer); }
    }

    public async Task<ConfirmedReading> ConfirmMeterAsync(Guid taskId, MeterConfirmation x, CancellationToken t)
    {
        if (!x.HumanConfirmed || x.ConfirmedValue < 0 || x.ConfirmedValue >= 100_000_000_000_000m) throw new CaptureValidationException("invalid_reading_value");
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var locationId = await scope.TaskLocationAsync(taskId, t) ?? throw new OcrAccessException();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
        var meterId = await scope.TaskMeterAsync(taskId, t) ?? throw new OcrAccessException();
        var meter = await scope.MeterAsync(meterId, t, locked: true);
        var task = await scope.LockTaskAsync(taskId, t) ?? throw new OcrAccessException();
        if (await scope.TaskLocationAsync(taskId, t) is null) throw new OcrAccessException();
        var existing = await scope.TaskReadingAsync(taskId, t);
        if (existing is not null)
        {
            if (x.ExpectedVersion is { } version)
            {
                if (existing.ConfirmedValue == x.ConfirmedValue && existing.EvidenceId == x.EvidenceId && task.Version == version + 1)
                { await tx.CommitAsync(t); return Reading(existing); }
                if (task.Version != version) throw new CaptureConflictException("task_version_changed");
                if (!await scope.CanCorrectAsync(task, meter, existing, t)) throw new CaptureConflictException("reading_correction_not_allowed");
                if (decimal.Truncate(x.ConfirmedValue) != x.ConfirmedValue) throw new CaptureValidationException("reading_integer_required");
                if (existing.PreviousValue is { } prior && x.ConfirmedValue < prior) throw new CaptureConflictException("meter_reset_or_rollover_requires_review");
                var proof = await scope.LockEvidenceAsync(x.EvidenceId, t);
                if (proof is null || proof.TaskId != taskId || proof.UploadedByUserId != Actor || !proof.IsUploaded || proof.IsLinked || proof.CleanupAfter <= clock.GetUtcNow())
                    throw new CaptureConflictException("evidence_not_available");
                await storage.CopyToAsync(proof.ObjectKey, Stream.Null, t);
                var now = clock.GetUtcNow();
                proof.IsLinked = true;
                // Persist the new evidence envelope before the reading snapshot references it.
                if (db is Compact24DbContext compact) await NativeCaptureWrites.EvidenceAsync(compact, proof, false, t);
                else await Save(t);
                existing.EvidenceId = proof.Id;
                existing.OcrProposedValue = null;
                existing.ConfirmedValue = x.ConfirmedValue;
                existing.Consumption = task.Purpose == ReadingPurpose.Initial || existing.PreviousValue is null ? null : x.ConfirmedValue - existing.PreviousValue;
                existing.Status = MeterReadingStatus.Corrected;
                existing.ConfirmedByUserId = Actor;
                existing.ConfirmedAt = now.AddTicks(-(now.Ticks % 10));
                task.Version++;
                if (db is Compact24DbContext native)
                {
                    await NativeCaptureWrites.TaskAsync(native, task, false, version, t);
                    await NativeCaptureWrites.ReadingAsync(native, existing, task, false, t);
                }
                await Audit("MeterReadingCorrected", "MeterReading", existing.Id, t);
                await Save(t); await tx.CommitAsync(t); return Reading(existing);
            }
            if (existing.ConfirmedValue != x.ConfirmedValue || existing.EvidenceId != x.EvidenceId) throw new CaptureConflictException("task_already_confirmed");
            await tx.CommitAsync(t); return Reading(existing);
        }
        if (x.ExpectedVersion is not null) throw new CaptureConflictException("reading_correction_not_allowed");
        if (!meter.IsActive || task.Status is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled) throw new CaptureConflictException("task_closed");
        if (decimal.Truncate(x.ConfirmedValue) != x.ConfirmedValue) throw new CaptureValidationException("reading_integer_required");
        if (task.ReadingDate > scope.Today) throw new CaptureValidationException("reading_date_in_future");
        var evidence = await scope.LockEvidenceAsync(x.EvidenceId, t);
        if (evidence is null || evidence.TaskId != taskId || evidence.UploadedByUserId != Actor || !evidence.IsUploaded || evidence.IsLinked || evidence.CleanupAfter <= clock.GetUtcNow()) throw new CaptureConflictException("evidence_not_available");
        var previous = await scope.LatestReadingAsync(meter.Id, t);
        var tenancyOpening = task.Purpose == ReadingPurpose.Initial && task.ContractId is not null;
        if (tenancyOpening && !await InitialContractActiveAsync(task.ContractId, meter.RoomId, task.ReadingDate, t))
            throw new CaptureConflictException("active_contract_initial_required");
        if (task.Purpose == ReadingPurpose.Initial && previous != null && !tenancyOpening)
            throw new CaptureConflictException("baseline_already_confirmed");
        // Move-out is a physical inspection independent of a signed move-in
        // record. A missing earlier meter reading must not prevent photographing
        // and confirming today's Final value; consumption remains unknown until
        // billing has a separately verified opening point. Periodic readings
        // still require an established meter baseline.
        if (task.Purpose == ReadingPurpose.Periodic && previous is null)
            throw new CaptureConflictException("confirmed_baseline_required");
        if (previous is not null)
        {
            var previousTask = db is Compact24DbContext native
                ? NativeCaptureReads.Task(await native.Set<Native.OperationalTask>().AsNoTracking().SingleAsync(a => a.Id == previous.TaskId, t))
                : await db.Set<OperationalTask>().AsNoTracking().SingleAsync(a => a.Id == previous.TaskId, t);
            // Individually recorded Room contracts may finish on the same day.
            // Distinct Owner-approved final tasks still use this locked meter's
            // latest confirmed value; they never create another financial effect.
            var finalOnSameDay = task.Purpose == ReadingPurpose.Final && task.ReadingDate == previousTask.ReadingDate &&
                (previousTask.Purpose != ReadingPurpose.Final || previousTask.ContractId != task.ContractId);
            // An initial baseline confirmed earlier today is valid for a later periodic
            // reading on the same calendar date. Other same-day periodic readings
            // remain out of order; the meter still must not roll backwards.
            var periodicAfterInitialOnSameDay = task.Purpose == ReadingPurpose.Periodic && previousTask.Purpose == ReadingPurpose.Initial &&
                task.ReadingDate == previousTask.ReadingDate;
            // Two distinct contracts can hand over the same physical meter on
            // the same day. They still need separate images/confirmations and
            // must not roll the meter backwards.
            var tenancyOpeningOnSameDay = tenancyOpening && previousTask.ContractId != task.ContractId &&
                task.ReadingDate == previousTask.ReadingDate;
            if ((!finalOnSameDay && !periodicAfterInitialOnSameDay && !tenancyOpeningOnSameDay && task.ReadingDate <= previousTask.ReadingDate) ||
                (previousTask.BillingPeriod is not null && task.BillingPeriod <= previousTask.BillingPeriod))
                throw new CaptureConflictException("reading_period_out_of_order");
            if (x.ConfirmedValue < previous.ConfirmedValue) throw new CaptureConflictException("meter_reset_or_rollover_requires_review");
        }
        // Verify the private object still exists before committing its reference.
        await storage.CopyToAsync(evidence.ObjectKey, Stream.Null, t);
        var proposed = task.OcrImageHash == evidence.ImageHash ? task.OcrProposedValue : null;
        // PostgreSQL timestamptz stores microseconds. Match it before returning the first response.
        var confirmedAt = clock.GetUtcNow();
        confirmedAt = confirmedAt.AddTicks(-(confirmedAt.Ticks % 10));
        var row = new MeterReading
        {
            TaskId = taskId,
            MeterId = meter.Id,
            EvidenceId = evidence.Id,
            PreviousValue = previous?.ConfirmedValue,
            ConfirmedValue = x.ConfirmedValue,
            OcrProposedValue = proposed,
            // A tenancy's opening reading is a baseline, not billable usage
            // since the physical meter's previous (possibly other-tenant) value.
            Consumption = task.Purpose == ReadingPurpose.Initial || previous is null ? null : x.ConfirmedValue - previous.ConfirmedValue,
            Status = proposed.HasValue && proposed != x.ConfirmedValue ? MeterReadingStatus.Corrected : MeterReadingStatus.Confirmed,
            ConfirmedByUserId = Actor,
            ConfirmedAt = confirmedAt
        };
        task.Status = MeterTaskStatus.Completed; task.CompletedAt = row.ConfirmedAt; evidence.IsLinked = true;
        if (db is Compact24DbContext physicalDb)
        {
            await NativeCaptureWrites.EvidenceAsync(physicalDb, evidence, false, t);
            await NativeCaptureWrites.TaskAsync(physicalDb, task, false, task.Version, t);
            await NativeCaptureWrites.ReadingAsync(physicalDb, row, task, true, t);
        }
        else db.Add(row);
        await Audit("MeterReadingConfirmed", "MeterReading", row.Id, t); await Save(t); await tx.CommitAsync(t); return Reading(row);
    }
    private static ConfirmedReading Reading(MeterReading r) => new(r.Id, r.TaskId, r.ConfirmedValue, r.PreviousValue, r.Consumption, r.Status, r.ConfirmedAt);
    public async Task CopyEvidenceAsync(Guid readingId, Stream output, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var row = await compact.Set<Native.MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == readingId &&
                scope.NativeTasks.Any(task => task.Id == r.OperationalTaskId), t) ?? throw new OcrAccessException();
            var task = await scope.NativeTasks.SingleOrDefaultAsync(x => x.Id == row.OperationalTaskId, t) ?? throw new OcrAccessException();
            var proof = NativeCaptureReads.Evidence(task, NativeCaptureReads.Reading(row).EvidenceId) ?? throw new OcrAccessException();
            await storage.CopyToAsync(proof.ObjectKey, output, t);
            return;
        }
        var evidence = await db.Set<MeterReading>().Where(r => r.Id == readingId && scope.VisibleTasks.Any(task => task.Id == r.TaskId))
            .Join(db.Set<MeterEvidence>(), r => r.EvidenceId, e => e.Id, (_, e) => e).AsNoTracking().SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        await storage.CopyToAsync(evidence.ObjectKey, output, t);
    }
}
