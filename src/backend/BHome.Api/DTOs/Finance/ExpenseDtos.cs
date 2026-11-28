using System.Text.Json.Serialization;

namespace BHome.Application.Finance;

public sealed record ExpenseInput(Guid LocationId, Guid? RoomId, string ExpenseType, string Category,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly OccurredOn, string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? AssetId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? TaskId = null);
public sealed record ExpenseUpdate(ExpenseInput Expense, int ExpectedVersion, string Reason);
public sealed record BulkInvestmentItem(string Category,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Note);
public sealed record BulkInvestmentInput(Guid LocationId, DateOnly OccurredOn, BulkInvestmentItem[] Items);
public sealed record ExpenseFilter(Guid? LocationId = null, DateOnly? From = null, DateOnly? To = null,
    string? ExpenseType = null, string? Category = null, int Page = 1, int PageSize = 25,
    bool OnlyOtherInvestments = false, Guid? RoomId = null, bool IncludeTotalAmount = false);
public sealed record ExpenseView(Guid Id, Guid LocationId, Guid? RoomId, string ExpenseType, string Category,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly OccurredOn, string Note, int Version, bool CanEdit, Guid? AssetId = null, Guid? TaskId = null,
    string? AssetName = null, string? TaskTitle = null);
public sealed record ExpensePage(IReadOnlyList<ExpenseView> Items, long Total, int Page, int PageSize, string? TotalAmount = null);
public sealed record ExpenseReference(Guid Id, string Label, Guid? RoomId = null, Guid? AssetId = null);
public sealed record ExpenseReferences(IReadOnlyList<ExpenseReference> Rooms, IReadOnlyList<ExpenseReference> Assets,
    IReadOnlyList<ExpenseReference> WorkOrders, bool Truncated);
