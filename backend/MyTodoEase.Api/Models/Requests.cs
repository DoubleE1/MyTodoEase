namespace MyTodoEase.Api.Models;

public sealed record ProjectWriteRequest(string Name, string? Color, int? Order, bool? IsFavorite);

public sealed record SectionWriteRequest(string ProjectId, string Name, int? Order);

public sealed record LabelWriteRequest(string Name, string? Color, int? Order);

public sealed record TaskWriteRequest(
    string Content,
    string? Description,
    string ProjectId,
    string? SectionId,
    string? ParentId,
    List<string>? LabelIds,
    int? Priority,
    string? DueDate,
    string? DueTime,
    int? DurationMinutes,
    Recurrence? Recurrence,
    int? Order,
    // Multi-day start: null = leave unchanged (older clients do not send it), "" = clear, otherwise set.
    string? StartDate = null);

/// <summary>SectionId / ParentId: null = leave unchanged, "" = clear, otherwise set.</summary>
public sealed record ReorderItem(string Id, int Order, string? SectionId, string? ParentId);

public sealed record ReorderRequest(List<ReorderItem> Items);
