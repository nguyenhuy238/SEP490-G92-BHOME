using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

public static class PropertyRules
{
    public static string Normalize(string value) => value.Trim().ToUpperInvariant();

    public static bool CanManuallyChange(RoomStatus current, RoomStatus requested, bool hasResidents) =>
        requested is RoomStatus.Available or RoomStatus.Unavailable &&
        CanChangeRoomStatus(current, requested, RoomTransitionSource.Configuration, hasResidents);

    public static bool CanChangeRoomStatus(RoomStatus current, RoomStatus requested,
        RoomTransitionSource source, bool hasObligations = false, bool hasOtherActiveContracts = false) =>
        Enum.IsDefined(current) && Enum.IsDefined(requested) && source switch
        {
            RoomTransitionSource.Configuration => current == requested ||
                current is RoomStatus.Available or RoomStatus.Unavailable &&
                requested is RoomStatus.Available or RoomStatus.Unavailable && !hasObligations,
            RoomTransitionSource.ContractActivation =>
                current is RoomStatus.Available or RoomStatus.OnHold or RoomStatus.Occupied && requested == RoomStatus.Occupied,
            RoomTransitionSource.ContractTermination => hasOtherActiveContracts
                ? requested == RoomStatus.Occupied
                : current == RoomStatus.Occupied ? requested is RoomStatus.Available or RoomStatus.Unavailable : requested == current,
            RoomTransitionSource.HoldingActivation => current == RoomStatus.Available && requested == RoomStatus.OnHold,
            RoomTransitionSource.HoldingRelease => current == RoomStatus.OnHold && requested == RoomStatus.Available,
            _ => false
        };

    public static bool ValidCharge(ChargeCategory category, ChargingMethod method, string code) =>
        category switch
        {
            ChargeCategory.Rent => method == ChargingMethod.FixedPerRoomPerMonth && code == "RENT",
            ChargeCategory.Electricity => method == ChargingMethod.Metered && code == "ELECTRICITY",
            ChargeCategory.Water => method == ChargingMethod.Metered && code == "WATER",
            ChargeCategory.ServiceFee => method is ChargingMethod.FixedPerRoomPerMonth or ChargingMethod.FixedPerPersonPerMonth &&
                code is not ("RENT" or "ELECTRICITY" or "WATER"),
            _ => false
        };
}
