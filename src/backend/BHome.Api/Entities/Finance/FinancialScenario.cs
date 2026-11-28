using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("financial_scenarios", Schema = "public")]
public sealed class FinancialScenario
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid? LocationId { get; set; }

    [Column("name", TypeName = "varchar(150)")]
    public string Name { get; set; } = null!;

    [Column("baseline_from", TypeName = "date")]
    public DateOnly BaselineFrom { get; set; }

    [Column("baseline_to", TypeName = "date")]
    public DateOnly BaselineTo { get; set; }

    [Column("forecast_months", TypeName = "smallint")]
    public short ForecastMonths { get; set; }

    [Column("assumptions", TypeName = "jsonb")]
    public JsonElement Assumptions { get; set; }

    [Column("baseline_snapshot", TypeName = "jsonb")]
    public JsonElement BaselineSnapshot { get; set; }

    [Column("result_snapshot", TypeName = "jsonb")]
    public JsonElement ResultSnapshot { get; set; }

    [Column("calculation_version", TypeName = "varchar(40)")]
    public string CalculationVersion { get; set; } = null!;

    [Column("created_by_user_id", TypeName = "uuid")]
    public Guid CreatedByUserId { get; set; }

    [Column("calculated_at", TypeName = "timestamptz")]
    public DateTimeOffset CalculatedAt { get; set; }
}
