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
        return input with { ChargeCode = code, ReferenceRate = Money(input.ReferenceRate), Unit = Text(input.Unit, 80) };
    }
    private static SharedPolicyData Policy(SharedPolicyData input)
    {
        if (input.EffectiveFrom == default) throw new PropertyException(400, "effective_date_required");
        return input with { Content = Text(input.Content, 12000) };
    }
}
