using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("expenses", Schema = "public")]
public sealed class Expense
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid LocationId { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid? RoomId { get; set; }

    [Column("asset_id", TypeName = "uuid")]
    public Guid? AssetId { get; set; }

    [Column("incident_report_id", TypeName = "uuid")]
    public Guid? IncidentReportId { get; set; }

    [Column("task_id", TypeName = "uuid")]
    public Guid? TaskId { get; set; }

    [Column("expense_type", TypeName = "varchar(20)")]
    public string ExpenseType { get; set; } = null!;

    [Column("category", TypeName = "varchar(60)")]
    public string Category { get; set; } = null!;

    [Column("amount", TypeName = "numeric(18,0)")]
    public decimal Amount { get; set; }

    [Column("occurred_on", TypeName = "date")]
    public DateOnly OccurredOn { get; set; }

    [Column("note", TypeName = "text")]
    public string Note { get; set; } = null!;

    [Column("evidence", TypeName = "jsonb")]
    public JsonElement Evidence { get; set; }

    [Column("source_key", TypeName = "varchar(250)")]
    public string? SourceKey { get; set; }

    [Column("recorded_by_user_id", TypeName = "uuid")]
    public Guid RecordedByUserId { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
