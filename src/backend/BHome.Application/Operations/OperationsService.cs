using System.ComponentModel.DataAnnotations;
using System.Reflection;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

public sealed class OperationsService(IOperationsRepository repository, IOperationsFiles files,
    ICurrentUser user, PermissionAccess permissions, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new OperationsException(401, "authentication_required");
    private DateTimeOffset Now => clock.GetUtcNow();
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now,
        TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);

    private void Require(string permission)
    {
        _ = Actor;
        if (!permissions.HasPermission(permission)) throw OperationsException.Forbidden();
    }

    private static void Validate(object input)
    {
        if (!Validator.TryValidateObject(input, new ValidationContext(input), [], true))
            throw OperationsException.Invalid("invalid_operations_input");
        foreach (var parameter in input.GetType().GetConstructors().OrderByDescending(x => x.GetParameters().Length)
                     .FirstOrDefault()?.GetParameters() ?? [])
        {
            var value = input.GetType().GetProperty(parameter.Name!, BindingFlags.Public | BindingFlags.Instance |
                BindingFlags.IgnoreCase)?.GetValue(input);
            if (parameter.GetCustomAttributes<ValidationAttribute>().Any(a => !a.IsValid(value)))
                throw OperationsException.Invalid("invalid_operations_input");
        }
    }

    private static void Page(int page, int size)
    {
        if (page < 1 || size is < 1 or > 100 || (long)(page - 1) * size > int.MaxValue)
            throw OperationsException.Invalid("invalid_pagination");
    }

    public async Task<ProfileView> ProfileAsync(CancellationToken t)
    {
        Require(Permissions.Account.ViewOwn);
        return await repository.ProfileAsync(Actor, t) ?? throw OperationsException.Missing();
    }

    public async Task<ProfileView> UpdateProfileAsync(ProfileUpdate input, CancellationToken t)
    {
        Require(Permissions.Account.UpdateOwn); Validate(input);
        if (string.IsNullOrWhiteSpace(input.FullName) || string.IsNullOrWhiteSpace(input.Email))
            throw OperationsException.Invalid("profile_fields_required");
        return await repository.UpdateProfileAsync(Actor, input with
        {
            FullName = input.FullName.Trim(),
            Email = input.Email.Trim(),
            Phone = Phone(input.Phone)
        }, Now, t);
    }

    public async Task<OperationsPage<StaffView>> StaffAsync(StaffQuery query, CancellationToken t)
    {
        Require(Permissions.StaffAccounts.Manage); Validate(query); Page(query.Page, query.PageSize);
        return await repository.StaffAsync(query, t);
    }

    public async Task<StaffView> StaffAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.StaffAccounts.Manage);
        return await repository.StaffAsync(id, t) ?? throw OperationsException.Missing();
    }

    public async Task<StaffView> CreateStaffAsync(StaffCreate input, CancellationToken t)
    {
        Require(Permissions.StaffAccounts.Manage); Validate(input); Validate(input.Employment);
        ValidateEmployment(input.Employment);
        return await repository.CreateStaffAsync(Actor, input with
        {
            Email = input.Email.Trim(),
            FullName = input.FullName.Trim(),
            Phone = Phone(input.Phone),
            Employment = Normalize(input.Employment)
        }, Now, t);
    }

    public async Task<StaffView> UpdateStaffAsync(Guid id, StaffUpdate input, CancellationToken t)
    {
        Require(Permissions.StaffAccounts.Manage); Validate(input); Validate(input.Employment);
        ValidateEmployment(input.Employment);
        if (string.IsNullOrWhiteSpace(input.Reason)) throw OperationsException.Invalid("reason_required");
        return await repository.UpdateStaffAsync(Actor, id, input with
        {
            Email = input.Email.Trim(),
            FullName = input.FullName.Trim(),
            Phone = Phone(input.Phone),
            Employment = Normalize(input.Employment),
            Reason = input.Reason.Trim()
        }, Now, t);
    }

    public async Task<OperationsPage<ResidenceTaskView>> ResidenceAsync(ResidenceQuery query, CancellationToken t)
    {
        Validate(query); Page(query.Page, query.PageSize);
        if (query.LocationId == Guid.Empty || query.Status is not (null or "Pending" or "InProgress" or "Completed"))
            throw OperationsException.Invalid("invalid_residence_filter");
        if (user.IsInRole(Roles.Owner)) return await repository.ResidenceAsync(query, null, t);
        if (user.IsInRole(Roles.Tenant)) return await repository.ResidenceAsync(query, Actor, t);
        throw OperationsException.Forbidden();
    }

    public async Task<ResidenceTaskView> ResidenceAsync(Guid contractId, Guid residentId, CancellationToken t)
    {
        Guid? tenant = user.IsInRole(Roles.Owner) ? null : user.IsInRole(Roles.Tenant) ? Actor : throw OperationsException.Forbidden();
        return await repository.ResidenceAsync(contractId, residentId, tenant, t) ?? throw OperationsException.Missing();
    }

    public async Task<ResidenceTaskView> UpdateResidenceAsync(Guid contractId, Guid residentId,
        ResidenceUpdate input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Tenant)) throw OperationsException.Forbidden();
        Validate(input);
        if (input.ActualResidenceFrom == default || input.ResultAt is { } result && result > Now.AddMinutes(5) ||
            input.Status == "Completed" && input.ResultAt is null)
            throw OperationsException.Invalid("invalid_residence_state");
        _ = await repository.ResidenceAsync(contractId, residentId, Actor, t) ?? throw OperationsException.Missing();
        return await repository.UpdateResidenceAsync(Actor, contractId, residentId,
            input with { Note = Clean(input.Note) }, Now, t);
    }

    public async Task<ResidenceTaskView> ConfirmResidenceAsync(Guid contractId, Guid residentId,
        ResidenceOwnerConfirmation input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden();
        Validate(input);
        if (string.IsNullOrWhiteSpace(input.Note)) throw OperationsException.Invalid("confirmation_note_required");
        return await repository.ConfirmResidenceAsync(Actor, contractId, residentId,
            input with { Note = input.Note.Trim() }, Now, t);
    }

    public async Task<ResidenceTaskView> UploadResidenceEvidenceAsync(Guid contractId, Guid residentId,
        Stream input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Tenant)) throw OperationsException.Forbidden();
        _ = await repository.ResidenceAsync(contractId, residentId, Actor, t) ?? throw OperationsException.Missing();
        var previous = await repository.ResidenceEvidenceAsync(contractId, residentId, Actor, t);
        var content = await ReadImageAsync(input, t);
        var type = files.ValidateImage(content);
        var key = $"residence/{contractId:N}/{residentId:N}/{Guid.NewGuid():N}";
        await files.PutAsync(key, content, type, t);
        try
        {
            var result = await repository.AttachResidenceEvidenceAsync(Actor, contractId, residentId,
                new(key, type, content.LongLength), Now, t);
            if (previous is not null) await files.DeleteAsync(previous.ObjectKey, t);
            return result;
        }
        catch
        {
            await files.DeleteAsync(key, CancellationToken.None);
            throw;
        }
    }

    public async Task<string> CopyResidenceEvidenceAsync(Guid contractId, Guid residentId, Stream output, CancellationToken t)
    {
        Guid? tenant = user.IsInRole(Roles.Owner) ? null : user.IsInRole(Roles.Tenant) ? Actor : throw OperationsException.Forbidden();
        var file = await repository.ResidenceEvidenceAsync(contractId, residentId, tenant, t) ?? throw OperationsException.Missing();
        await files.CopyAsync(file.ObjectKey, output, t); return file.ContentType;
    }

    public async Task<OperationsPage<RoomOccupancyView>> OccupancyAsync(OccupancyQuery query, CancellationToken t)
    {
        Require(Permissions.Property.View); Validate(query); Page(query.Page, query.PageSize);
        if (query.LocationId == Guid.Empty || query.RoomStatus is not (null or "Available" or "OnHold" or "Occupied" or "Unavailable"))
            throw OperationsException.Invalid("invalid_occupancy_filter");
        return await repository.OccupancyAsync(query, user.IsInRole(Roles.Owner) ? null : Actor, Today, t);
    }

    public async Task<RoomOccupancyHistory> OccupancyHistoryAsync(Guid roomId, CancellationToken t)
    {
        Require(Permissions.Property.View);
        return await repository.OccupancyHistoryAsync(roomId, user.IsInRole(Roles.Owner) ? null : Actor, Today, t)
            ?? throw OperationsException.Missing();
    }

    public async Task<LocationPublicContent> LocationContentAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        return await repository.LocationContentAsync(id, false, t) ?? throw OperationsException.Missing();
    }

    public async Task<RoomPublicContent> RoomContentAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        return await repository.RoomContentAsync(id, false, t) ?? throw OperationsException.Missing();
    }

    public async Task<LocationPublicContent> UpdateLocationContentAsync(Guid id, LocationPublicContentWrite input, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish); Validate(input); ValidateAmenities(input.Amenities);
        return await repository.UpdateLocationContentAsync(Actor, id, input with
        {
            Summary = input.Summary.Trim(),
            Amenities = NormalizeAmenities(input.Amenities),
            ContactPhone = Clean(input.ContactPhone),
            ContactEmail = Clean(input.ContactEmail)
        }, Now, t);
    }

    public async Task<RoomPublicContent> UpdateRoomContentAsync(Guid id, RoomPublicContentWrite input, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish); Validate(input); ValidateAmenities(input.Amenities);
        return await repository.UpdateRoomContentAsync(Actor, id, input with
        { Description = input.Description.Trim(), Amenities = NormalizeAmenities(input.Amenities) }, Now, t);
    }

    public async Task<LocationPublicContent> PublishLocationAsync(Guid id, bool publish, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        return await repository.PublishLocationAsync(Actor, id, publish, Now, t);
    }

    public async Task<RoomPublicContent> PublishRoomAsync(Guid id, bool publish, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        return await repository.PublishRoomAsync(Actor, id, publish, Now, t);
    }

    public async Task<LocationPublicContent> UploadLocationPhotoAsync(Guid id, Stream input, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        return await UploadPublicPhotoAsync("location", id, input,
            (file, token) => repository.AttachLocationPhotoAsync(Actor, id, file, Now, token), t);
    }

    public async Task<RoomPublicContent> UploadRoomPhotoAsync(Guid id, Stream input, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        return await UploadPublicPhotoAsync("room", id, input,
            (file, token) => repository.AttachRoomPhotoAsync(Actor, id, file, Now, token), t);
    }

    public async Task RemovePublicPhotoAsync(string target, Guid id, int index, CancellationToken t)
    {
        Require(Permissions.PublicContent.Publish);
        if (target is not ("location" or "room") || index < 0) throw OperationsException.Invalid("invalid_public_photo");
        var file = target == "location"
            ? await repository.RemoveLocationPhotoAsync(Actor, id, index, Now, t)
            : await repository.RemoveRoomPhotoAsync(Actor, id, index, Now, t);
        if (file is null) throw OperationsException.Missing();
        await files.DeleteAsync(file.ObjectKey, t);
    }

    private async Task<T> UploadPublicPhotoAsync<T>(string target, Guid id, Stream input,
        Func<OperationsFile, CancellationToken, Task<T>> attach, CancellationToken t)
    {
        var content = await ReadImageAsync(input, t); var type = files.ValidateImage(content);
        var key = $"public/{target}/{id:N}/{Guid.NewGuid():N}";
        await files.PutAsync(key, content, type, t);
        try { return await attach(new(key, type, content.LongLength), t); }
        catch { await files.DeleteAsync(key, CancellationToken.None); throw; }
    }

    public Task<IReadOnlyList<LocationPublicContent>> PublishedLocationsAsync(CancellationToken t) =>
        repository.PublishedLocationsAsync(t);
    public Task<IReadOnlyList<RoomPublicContent>> PublishedRoomsAsync(Guid locationId, CancellationToken t)
    {
        if (locationId == Guid.Empty) throw OperationsException.Missing();
        return repository.PublishedRoomsAsync(locationId, t);
    }
    public async Task<LocationPublicContent> PublishedLocationAsync(Guid id, CancellationToken t) =>
        await repository.LocationContentAsync(id, true, t) ?? throw OperationsException.Missing();
    public async Task<RoomPublicContent> PublishedRoomAsync(Guid id, CancellationToken t) =>
        await repository.RoomContentAsync(id, true, t) ?? throw OperationsException.Missing();

    public async Task<string> CopyPublicPhotoAsync(string targetType, Guid id, int index, Stream output, CancellationToken t)
    {
        if (targetType is not ("location" or "room") || index < 0) throw OperationsException.Missing();
        var file = await repository.PublicPhotoAsync(targetType, id, index, true, t) ?? throw OperationsException.Missing();
        await files.CopyAsync(file.ObjectKey, output, t); return file.ContentType;
    }

    public async Task<IReadOnlyList<RecurringTaskTemplateView>> TemplatesAsync(Guid locationId, CancellationToken t)
    {
        Require(Permissions.OperationalTasks.Manage);
        if (locationId == Guid.Empty) throw OperationsException.Invalid("location_required");
        return await repository.TemplatesAsync(locationId, t);
    }

    public async Task<RecurringTaskTemplateView> SaveTemplateAsync(Guid? id,
        RecurringTaskTemplateWrite input, CancellationToken t)
    {
        Require(Permissions.OperationalTasks.Manage); Validate(input);
        if (input.LocationId == Guid.Empty || input.NextRunAt == default || string.IsNullOrWhiteSpace(input.Title) ||
            string.IsNullOrWhiteSpace(input.Requirements)) throw OperationsException.Invalid("invalid_recurring_task_template");
        return await repository.SaveTemplateAsync(Actor, id, input with
        {
            Title = input.Title.Trim(),
            Requirements = input.Requirements.Trim(),
            NextRunAt = input.NextRunAt.ToUniversalTime()
        }, Now, t);
    }

    public async Task RemoveTemplateAsync(Guid locationId, Guid id, int version, CancellationToken t)
    {
        Require(Permissions.OperationalTasks.Manage);
        if (locationId == Guid.Empty || id == Guid.Empty || version < 1) throw OperationsException.Invalid("invalid_recurring_task_template");
        await repository.RemoveTemplateAsync(Actor, locationId, id, version, Now, t);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string? Phone(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return LoginIdentifier.NormalizePhone(value) ?? throw OperationsException.Invalid("invalid_phone_number");
    }
    private static EmploymentWrite Normalize(EmploymentWrite input) => input with
    {
        ContractNumber = Clean(input.ContractNumber),
        EmploymentType = input.EmploymentType.Trim(),
        SalaryType = Clean(input.SalaryType),
        Status = input.Status.Trim()
    };
    private static void ValidateEmployment(EmploymentWrite input)
    {
        if (input.StartDate == default || input.EndDate < input.StartDate || string.IsNullOrWhiteSpace(input.EmploymentType) ||
            input.Status == "Ended" && input.EndDate is null)
            throw OperationsException.Invalid("invalid_employment");
    }
    private static string[] NormalizeAmenities(IEnumerable<string> values) => values.Select(x => x.Trim())
        .Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToArray();
    private static void ValidateAmenities(string[]? values)
    {
        if (values is null || values.Length > 50 || values.Any(x => x.Length > 100))
            throw OperationsException.Invalid("invalid_public_amenities");
    }
    private static async Task<byte[]> ReadImageAsync(Stream input, CancellationToken t)
    {
        const int maximum = 5 * 1024 * 1024;
        var bytes = new byte[maximum + 1]; var length = 0;
        while (length < bytes.Length)
        {
            var read = await input.ReadAsync(bytes.AsMemory(length), t); if (read == 0) break; length += read;
        }
        if (length > maximum) throw new OperationsException(413, "operations_image_too_large");
        if (length == 0) throw OperationsException.Invalid("invalid_operations_image");
        return bytes.AsSpan(0, length).ToArray();
    }
}
