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
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureRepository(BHomeDbContext db, CaptureScope scope, IIdentityProtection protection,
    IObjectStorage storage, UserManager<ApplicationUser> users, TimeProvider clock,
    ILocationAssignments locationAssignments,
    BHome.Application.PropertyManagement.IPropertyRepository properties) : ICaptureRepository
{
    private Guid Actor => scope.UserId;
    private void Audit(string action, string type, Guid id) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = Actor, Event = action, TargetType = type, TargetId = id, Succeeded = true, OccurredAt = clock.GetUtcNow() });
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
    public async Task<IReadOnlyList<NamedResource>> ChainsAsync(CancellationToken t) => await db.Set<Chain>().AsNoTracking()
        .OrderBy(c => c.Name).Take(100).Select(c => new NamedResource(c.Id, c.Name, null)).ToListAsync(t);
    public async Task<IReadOnlyList<NamedResource>> LocationsAsync(CancellationToken t) => await scope.VisibleLocations.AsNoTracking()
        .OrderBy(l => l.Name).Take(100).Select(l => new NamedResource(l.Id, l.Name, l.ChainId)).ToListAsync(t);
    public async Task<IReadOnlyList<NamedResource>> RoomsAsync(Guid id, CancellationToken t)
    {
        if (!await scope.VisibleLocations.AnyAsync(l => l.Id == id, t)) throw new OcrAccessException();
        return await scope.VisibleRooms.AsNoTracking().Where(r => r.LocationId == id).OrderBy(r => r.RoomNumber).Take(100)
            .Select(r => new NamedResource(r.Id, r.RoomNumber, r.LocationId)).ToListAsync(t);
    }
    public async Task<IReadOnlyList<NamedResource>> StaffAsync(CancellationToken t) => await db.Users.AsNoTracking()
        .Where(u => u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id &&
            db.Roles.Any(r => r.Id == ur.RoleId && r.Name == Roles.Staff))).OrderBy(u => u.UserName).Take(100)
        .Select(u => new NamedResource(u.Id, u.UserName!, null)).ToListAsync(t);
    public async Task<IdResult> CreateStaffAsync(StaffInput x, CancellationToken t)
    {
        Validate(x);
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var u = new ApplicationUser { UserName = x.UserName.Trim(), Email = x.Email.Trim(), LockoutEnabled = true };
        if (!(await users.CreateAsync(u, x.Password)).Succeeded) throw new CaptureValidationException("staff_account_not_created");
        if (!(await users.AddToRoleAsync(u, Roles.Staff)).Succeeded) throw new CaptureConflictException("staff_role_unavailable");
        Audit("StaffCreated", "User", u.Id); await Save(t); await tx.CommitAsync(t); return new(u.Id);
    }
    public async Task<IdResult> AssignStaffAsync(AssignmentInput x, CancellationToken t)
    {
        if (x.EffectiveFrom == default || x.EffectiveTo is null || x.EffectiveTo < x.EffectiveFrom)
            throw new CaptureValidationException("invalid_assignment_dates");
        var result = await locationAssignments.CreateAssignmentAsync(Actor, x.LocationId, x.StaffUserId,
            x.EffectiveFrom, x.EffectiveTo.Value, t);
        if (result.Status == CreateAssignmentStatus.DateRangeOverlaps) throw new CaptureConflictException("duplicate_or_conflicting_record");
        if (result.Status != CreateAssignmentStatus.Created || result.Assignment is null) throw new OcrAccessException();
        Audit("StaffAssigned", "Assignment", result.Assignment.Id); await Save(t); return new(result.Assignment.Id);
    }
    public async Task<IdResult> CreateResidentAsync(ResidentInput x, CancellationToken t)
    {
        Validate(x); if (!Enum.IsDefined(x.ResidentType) || string.IsNullOrWhiteSpace(x.DisplayLabel)) throw new CaptureValidationException("invalid_resident");
        var locationId = await scope.VisibleRooms.Where(r => r.Id == x.RoomId).Select(r => (Guid?)r.LocationId)
            .SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        return await properties.WithLocationLockAsync(locationId, async () =>
        {
            if (!await scope.VisibleRooms.AnyAsync(r => r.Id == x.RoomId && r.Location.IsActive &&
                    r.Status != RoomStatus.Unavailable && r.RoomTypeId != null && r.RoomType!.IsActive, t))
                throw new CaptureConflictException("room_unavailable");
            var resident = new Resident { RoomId = x.RoomId, DisplayLabel = x.DisplayLabel.Trim(), ResidentType = x.ResidentType, OwnerUserId = Actor };
            db.Add(resident); Audit("ResidentCreated", "Resident", resident.Id); return new IdResult(resident.Id);
        }, t);
    }
    public async Task<IReadOnlyList<ResidentSummary>> ResidentsAsync(Guid locationId, CancellationToken t)
    {
        if (!await scope.VisibleLocations.AnyAsync(l => l.Id == locationId, t)) throw new OcrAccessException();
        return await db.Set<Resident>().AsNoTracking().Where(r => r.Room.LocationId == locationId && scope.VisibleRooms.Any(room => room.Id == r.RoomId))
            .OrderByDescending(r => r.CreatedAt).Take(100).Select(r => new ResidentSummary(r.Id, r.RoomId, r.DisplayLabel, r.ResidentType, r.VerificationStatus, r.ConfirmedAt)).ToListAsync(t);
    }
    public async Task<IdentityConfirmationResult> ConfirmIdentityAsync(Guid id, IdentityConfirmation x, CancellationToken t)
    {
        Validate(x);
        if (!x.HumanConfirmed || string.IsNullOrWhiteSpace(x.FullName) || x.DateOfBirth == default || x.DateOfBirth > scope.Today || x.DateOfIssue > scope.Today)
            throw new CaptureValidationException("invalid_confirmed_identity");
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var identityOwner = await db.Set<Resident>().Where(r => r.Id == id && scope.VisibleRooms.Any(room => room.Id == r.RoomId)).Select(r => (Guid?)r.OwnerUserId).SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        // Serializes scoped duplicate checks, including the transition between HMAC key versions.
        await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {identityOwner} FOR UPDATE").SingleAsync(t);
        var resident = await db.Set<Resident>().FromSqlInterpolated($"SELECT * FROM \"Residents\" WHERE \"Id\" = {id} FOR UPDATE").SingleAsync(t);
        // Re-evaluate assignment after the lock, without trusting any incoming Location/Owner ID.
        if (!await scope.VisibleRooms.AnyAsync(r => r.Id == resident.RoomId, t)) throw new OcrAccessException();
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
                var digests = protection.CreateMatchIndexes(normalized.CitizenIdentityNumber, resident.OwnerUserId).Select(i => i.Digest).ToArray();
                if (await db.Set<Resident>().AnyAsync(r => r.OwnerUserId == resident.OwnerUserId && r.Id != resident.Id && r.IdentityHmac != null && digests.Contains(r.IdentityHmac), t))
                    throw new CaptureConflictException("duplicate_or_conflicting_record");
                resident.IdentityData = JsonSerializer.Serialize(protection.Encrypt(bytes, ps));
                resident.IdentityHmac = index.Digest; resident.HmacKeyVersion = index.KeyVersion;
                resident.VerificationStatus = IdentityVerificationStatus.Verified; resident.ConfirmedByUserId = Actor; resident.ConfirmedAt = clock.GetUtcNow();
                Audit("IdentityConfirmed", "Resident", resident.Id); await Save(t);
            }
            await tx.CommitAsync(t); return new(resident.Id, resident.VerificationStatus, resident.ConfirmedAt);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task<IdResult> CreateMeterAsync(MeterInput x, CancellationToken t)
    {
        Validate(x); if (!Enum.IsDefined(x.UtilityType) || !Enum.IsDefined(x.Display) || x.InstalledOn == default || string.IsNullOrWhiteSpace(x.Code)) throw new CaptureValidationException("invalid_meter");
        if (!await scope.VisibleRooms.AnyAsync(r => r.Id == x.RoomId, t)) throw new OcrAccessException();
        var m = new Meter { RoomId = x.RoomId, Code = x.Code.Trim(), UtilityType = x.UtilityType, Display = x.Display, DecimalPlaces = x.DecimalPlaces, InstalledOn = x.InstalledOn };
        db.Add(m); Audit("MeterCreated", "Meter", m.Id); await Save(t); return new(m.Id);
    }
    public async Task<IReadOnlyList<NamedResource>> MetersAsync(Guid id, CancellationToken t)
    {
        if (!await scope.VisibleLocations.AnyAsync(l => l.Id == id, t)) throw new OcrAccessException();
        return await db.Set<Meter>().AsNoTracking().Where(m => m.Room.LocationId == id && scope.VisibleRooms.Any(r => r.Id == m.RoomId))
            .OrderBy(m => m.Room.RoomNumber).Take(100).Select(m => new NamedResource(m.Id, m.Room.RoomNumber + " · " + m.Code, m.RoomId)).ToListAsync(t);
    }
    public async Task<IdResult> CreateTaskAsync(MeterTaskInput x, CancellationToken t)
    {
        if (!Enum.IsDefined(x.Purpose) || x.ReadingDate == default || (x.Purpose == ReadingPurpose.Periodic && (x.BillingPeriod is null || x.BillingPeriod.Value.Day != 1 || x.ReadingDate.Year != x.BillingPeriod.Value.Year || x.ReadingDate.Month != x.BillingPeriod.Value.Month)) || (x.Purpose == ReadingPurpose.Initial && x.BillingPeriod != null)) throw new CaptureValidationException("invalid_reading_period");
        var meter = await db.Set<Meter>().Where(m => m.Id == x.MeterId && m.IsActive && scope.VisibleRooms.Any(r => r.Id == m.RoomId))
            .Select(m => new { m.InstalledOn }).SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        if (x.ReadingDate < meter.InstalledOn) throw new CaptureValidationException("reading_before_installation");
        var task = new OperationalTask { MeterId = x.MeterId, Purpose = x.Purpose, ReadingDate = x.ReadingDate, BillingPeriod = x.BillingPeriod };
        db.Add(task); Audit("MeterTaskAssigned", "Task", task.Id); await Save(t); return new(task.Id);
    }
    public async Task<IReadOnlyList<MeterTaskSummary>> TasksAsync(CancellationToken t) => await scope.VisibleTasks.AsNoTracking()
        .OrderByDescending(x => x.ReadingDate).ThenBy(x => x.Id).Take(100)
        .Select(x => new MeterTaskSummary(x.Id, x.MeterId, x.Meter.Room.Location.Name, x.Meter.Room.RoomNumber, x.Meter.Code,
            x.Meter.UtilityType, x.Meter.Display, x.Meter.DecimalPlaces, x.Purpose, x.ReadingDate, x.BillingPeriod, x.Status,
            db.Set<MeterReading>().Where(r => r.MeterId == x.MeterId).OrderByDescending(r => r.ConfirmedAt).Select(r => (decimal?)r.ConfirmedValue).FirstOrDefault())).ToListAsync(t);

    public async Task<IdResult> UploadEvidenceAsync(Guid taskId, Stream input, CancellationToken t)
    {
        if (!await scope.VisibleTasks.AnyAsync(x => x.Id == taskId && x.Meter.IsActive && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled, t)) throw new OcrAccessException();
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
                ObjectKey = "meter-evidence/" + Guid.NewGuid().ToString("N"),
                CleanupAfter = clock.GetUtcNow().AddMinutes(30)
            };
            db.Add(evidence); await Save(t); // durable cleanup intent BEFORE the external write
            await using var transaction = await db.Database.BeginTransactionAsync(t);
            await db.Set<MeterEvidence>().FromSqlInterpolated($"SELECT * FROM \"MeterEvidence\" WHERE \"Id\" = {evidence.Id} FOR UPDATE").SingleAsync(t);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
            using var data = new MemoryStream(buffer, 0, length, false);
            await storage.PutAsync(evidence.ObjectKey, data, length, contentType, deadline.Token);
            evidence.IsUploaded = true; await Save(t); await transaction.CommitAsync(t); return new(evidence.Id);
        }
        finally { CryptographicOperations.ZeroMemory(buffer); }
    }

    public async Task<ConfirmedReading> ConfirmMeterAsync(Guid taskId, MeterConfirmation x, CancellationToken t)
    {
        if (!x.HumanConfirmed || x.ConfirmedValue < 0 || x.ConfirmedValue >= 100_000_000_000_000m) throw new CaptureValidationException("invalid_reading_value");
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var meterId = await scope.VisibleTasks.Where(task => task.Id == taskId).Select(task => (Guid?)task.MeterId).SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        var meter = await db.Set<Meter>().FromSqlInterpolated($"SELECT * FROM \"Meters\" WHERE \"Id\" = {meterId} FOR UPDATE").SingleAsync(t);
        var task = await db.Set<OperationalTask>().FromSqlInterpolated($"SELECT * FROM \"OperationalTasks\" WHERE \"Id\" = {taskId} FOR UPDATE").SingleAsync(t);
        if (!await scope.VisibleTasks.AnyAsync(a => a.Id == taskId, t)) throw new OcrAccessException();
        var existing = await db.Set<MeterReading>().SingleOrDefaultAsync(r => r.TaskId == taskId, t);
        if (existing is not null)
        {
            if (existing.ConfirmedValue != x.ConfirmedValue || existing.EvidenceId != x.EvidenceId) throw new CaptureConflictException("task_already_confirmed");
            await tx.CommitAsync(t); return Reading(existing);
        }
        if (!meter.IsActive || task.Status is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled) throw new CaptureConflictException("task_closed");
        if (task.ReadingDate > scope.Today || decimal.Round(x.ConfirmedValue, meter.DecimalPlaces) != x.ConfirmedValue) throw new CaptureValidationException("reading_date_or_precision");
        var evidence = await db.Set<MeterEvidence>().FromSqlInterpolated($"SELECT * FROM \"MeterEvidence\" WHERE \"Id\" = {x.EvidenceId} FOR UPDATE").SingleOrDefaultAsync(t);
        if (evidence is null || evidence.TaskId != taskId || evidence.UploadedByUserId != Actor || !evidence.IsUploaded || evidence.IsLinked || evidence.CleanupAfter <= clock.GetUtcNow()) throw new CaptureConflictException("evidence_not_available");
        var previous = await db.Set<MeterReading>().Where(r => r.MeterId == meter.Id).OrderByDescending(r => r.ConfirmedAt).FirstOrDefaultAsync(t);
        if (task.Purpose == ReadingPurpose.Initial && previous != null) throw new CaptureConflictException("baseline_already_confirmed");
        if (task.Purpose == ReadingPurpose.Periodic && previous is null) throw new CaptureConflictException("confirmed_baseline_required");
        if (previous is not null)
        {
            var previousTask = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(a => a.Id == previous.TaskId, t);
            if (task.ReadingDate <= previousTask.ReadingDate || (previousTask.BillingPeriod is not null && task.BillingPeriod <= previousTask.BillingPeriod)) throw new CaptureConflictException("reading_period_out_of_order");
            if (x.ConfirmedValue < previous.ConfirmedValue) throw new CaptureConflictException("meter_reset_or_rollover_requires_review");
        }
        // Verify the private object still exists before committing its reference.
        await storage.CopyToAsync(evidence.ObjectKey, Stream.Null, t);
        var proposed = task.OcrImageHash == evidence.ImageHash ? task.OcrProposedValue : null;
        var row = new MeterReading
        {
            TaskId = taskId,
            MeterId = meter.Id,
            EvidenceId = evidence.Id,
            PreviousValue = previous?.ConfirmedValue,
            ConfirmedValue = x.ConfirmedValue,
            OcrProposedValue = proposed,
            Consumption = previous is null ? null : x.ConfirmedValue - previous.ConfirmedValue,
            Status = proposed.HasValue && proposed != x.ConfirmedValue ? MeterReadingStatus.Corrected : MeterReadingStatus.Confirmed,
            ConfirmedByUserId = Actor,
            ConfirmedAt = clock.GetUtcNow()
        };
        db.Add(row); task.Status = MeterTaskStatus.Completed; task.CompletedAt = row.ConfirmedAt; evidence.IsLinked = true;
        Audit("MeterReadingConfirmed", "MeterReading", row.Id); await Save(t); await tx.CommitAsync(t); return Reading(row);
    }
    private static ConfirmedReading Reading(MeterReading r) => new(r.Id, r.TaskId, r.ConfirmedValue, r.PreviousValue, r.Consumption, r.Status, r.ConfirmedAt);
    public async Task CopyEvidenceAsync(Guid readingId, Stream output, CancellationToken t)
    {
        var evidence = await db.Set<MeterReading>().Where(r => r.Id == readingId && scope.VisibleTasks.Any(task => task.Id == r.TaskId))
            .Join(db.Set<MeterEvidence>(), r => r.EvidenceId, e => e.Id, (_, e) => e).AsNoTracking().SingleOrDefaultAsync(t) ?? throw new OcrAccessException();
        await storage.CopyToAsync(evidence.ObjectKey, output, t);
    }
}
