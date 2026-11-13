using System.Text.Json.Serialization;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedFeeData([property: JsonRequired] ChargeCategory Category, string ChargeCode,
    [property: JsonRequired] ChargingMethod Method, [property: JsonRequired] decimal ReferenceRate, string Unit, string Scope,
    DateOnly EffectiveFrom, DateOnly? EffectiveTo);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedPolicyData(string Content, DateOnly EffectiveFrom);

public sealed partial class SharedDataValidator
{
    private static SharedFeeData Fee(SharedFeeData input)
    {
        var code = Text(input.ChargeCode, 80).ToUpperInvariant();
        if (!Enum.IsDefined(input.Category) || !Enum.IsDefined(input.Method) || !PropertyRules.ValidCharge(input.Category, input.Method, code) ||
            code.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')) || input.Scope is not ("Location" or "Room") || input.EffectiveFrom == default || input.EffectiveTo < input.EffectiveFrom)
            throw new PropertyException(400, "invalid_shared_fee");
        return input with { ChargeCode = code, ReferenceRate = Money(input.ReferenceRate), Unit = FeeUnit(input.Category, input.Method, input.Unit) };
    }
    private static string FeeUnit(ChargeCategory category, ChargingMethod method, string unit)
    {
        var value = Text(unit, 80).Replace(" ", "").ToLowerInvariant();
        // Accept legacy display labels while storing one canonical unit per supported charge.
        return category switch
        {
            ChargeCategory.Electricity when value is "kwh" or "vnd/kwh" => "kWh",
            ChargeCategory.Water when value is "m3" or "m\u00b3" or "vnd/m3" or "vnd/m\u00b3" => "m\u00b3",
            ChargeCategory.ServiceFee when method == ChargingMethod.FixedPerPersonPerMonth && value is "vnd/person/month" or "vnd/ng\u01b0\u1eddi/th\u00e1ng" => "VND/person/month",
            ChargeCategory.Rent or ChargeCategory.ServiceFee when method == ChargingMethod.FixedPerRoomPerMonth && value is "vnd/month" or "vnd/th\u00e1ng" or "vnd/ph\u00f2ng/th\u00e1ng" => "VND/month",
            _ => throw new PropertyException(400, "invalid_shared_fee_unit")
        };
    }
    private static SharedPolicyData Policy(SharedPolicyData input)
    {
        if (input.EffectiveFrom == default) throw new PropertyException(400, "effective_date_required");
        return input with { Content = Text(input.Content, 12000) };
    }
}
