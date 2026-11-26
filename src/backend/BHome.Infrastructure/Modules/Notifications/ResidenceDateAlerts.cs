namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class CompactNotificationEvents
{
    private async Task<int> ResidenceDateAlerts(CancellationToken t)
    {
        var rows = new List<(Guid Contract, Guid Resident, Guid Location, Guid Owner, Guid? Tenant, Guid? Representative, DateOnly? Expiry, DateOnly? Deadline, bool Completed)>();
        await using (var command = await sql.Command("""
            SELECT c.id,cr.resident_id,rm.location_id,c.owner_signer_id,r.user_id,c.tenant_user_id,
                (SELECT (h.value->>'registrationExpiresOn')::date FROM jsonb_array_elements(cr.history) WITH ORDINALITY h(value,n)
                    WHERE h.value ? 'registrationExpiresOn' ORDER BY h.n DESC LIMIT 1),
                (SELECT (h.value->>'registrationDeadline')::date FROM jsonb_array_elements(cr.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'action'='AccommodationConfirmed' AND h.value->>'actualResidenceFrom'=cr.actual_residence_from::text ORDER BY h.n DESC LIMIT 1),
                COALESCE(cr.registration_status,'Pending')='Completed' AND cr.owner_confirmed_at IS NOT NULL
            FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id JOIN rooms rm ON rm.id=c.room_id JOIN residents r ON r.id=cr.resident_id
            WHERE c.status=3 AND cr.actual_residence_from<=@today AND cr.actual_move_out_date IS NULL
                AND COALESCE((SELECT (h.value->>'registrationRequired')::boolean FROM jsonb_array_elements(cr.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'action'='TrackingConfigured' ORDER BY h.n DESC LIMIT 1),true)
            """, t, ("today", Today)))
        {
            await using var reader = await command.ExecuteReaderAsync(t);
            while (await reader.ReadAsync(t)) rows.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetGuid(4), reader.IsDBNull(5) ? null : reader.GetGuid(5),
                reader.IsDBNull(6) ? null : reader.GetFieldValue<DateOnly>(6), reader.IsDBNull(7) ? null : reader.GetFieldValue<DateOnly>(7), reader.GetBoolean(8)));
        }
        var count = 0;
        foreach (var row in rows)
        {
            var stage = row.Expiry is { } expiry && expiry <= Today.AddDays(15) ? expiry < Today ? "expired" : "expiring" :
                !row.Completed && row.Deadline < Today ? "overdue" : null;
            if (stage is null) continue;
            var date = stage == "overdue" ? row.Deadline : row.Expiry;
            var key = $"residence-date:{row.Contract}:{row.Resident}:{stage}:{date:yyyyMMdd}";
            if (await Done(key, t)) continue;
            var title = stage == "expired" ? "Tạm trú đã hết hạn" : stage == "expiring" ? "Tạm trú sắp hết hạn" : "Quá hạn cập nhật đăng ký tạm trú";
            foreach (var recipient in await Roles(new[] { row.Owner, row.Tenant ?? Guid.Empty, row.Representative ?? Guid.Empty }.Distinct(), t))
                if (recipient.Role == "Owner" && recipient.Id == row.Owner || recipient.Role == "Tenant" && (recipient.Id == row.Tenant || recipient.Id == row.Representative))
                    count += await sql.Emit(recipient.Id, recipient.Role, row.Location, key, "TEMPORARY_RESIDENCE_ACTION", "Residence", title,
                        $"Mở hồ sơ thành viên để kiểm tra và cập nhật kết quả. Ngày cần lưu ý: {date:dd/MM/yyyy}.", "Residence", row.Resident, t);
            await Mark(key, t);
        }
        return count;
    }
}
