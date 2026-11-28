using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("staff_employments", Schema = "public")]
public sealed class StaffEmployment
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("staff_user_id", TypeName = "uuid")]
    public Guid StaffUserId { get; set; }

    [Column("contract_number", TypeName = "varchar(100)")]
    public string? ContractNumber { get; set; }

    [Column("start_date", TypeName = "date")]
    public DateOnly StartDate { get; set; }

    [Column("end_date", TypeName = "date")]
    public DateOnly? EndDate { get; set; }

    [Column("salary_type", TypeName = "varchar(20)")]
    public string? SalaryType { get; set; }

    [Column("base_rate", TypeName = "numeric(18,0)")]
    public decimal? BaseRate { get; set; }

    [Column("reward_penalty_policy", TypeName = "jsonb")]
    public JsonElement RewardPenaltyPolicy { get; set; }

    [Column("status", TypeName = "varchar(25)")]
    public string Status { get; set; } = null!;

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
