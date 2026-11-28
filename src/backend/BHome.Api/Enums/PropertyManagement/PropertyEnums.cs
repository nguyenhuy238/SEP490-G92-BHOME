using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

public enum RoomStatus { Available, OnHold, Occupied, Unavailable }
public enum RoomTransitionSource { Configuration, ContractActivation, ContractTermination, HoldingActivation, HoldingRelease }
public enum AssetStatus { Active, NeedsRepair, UnderRepair, Retired }
public enum ChargeCategory { Rent, Electricity, Water, ServiceFee }
public enum ChargingMethod { FixedPerRoomPerMonth, Metered, FixedPerPersonPerMonth }
