
using LiteDB;

namespace MyTodoEase.Api.Models;

public enum Recurrence
{
    None,
    Daily,
    Weekdays,
    Weekly,
    /// <summary>Every two weeks: sprint-cadence tasks such as a release day.</summary>
    Biweekly,
    Monthly,
    Yearly,
}

/// <summary>
/// A task. Named TodoTask to avoid clashing with System.Threading.Tasks.Task.
/// Due dates are stored as plain strings ("yyyy-MM-dd" and "HH:mm") on purpose:
/// they represent the user's local calendar date, not an instant, so time zones never shift them.
/// </summary>
public sealed class TodoTask
{
    [BsonId]
    public string Id { get; set; } = null!;
    public string Content { get; set; } = "";
    public string Description { get; set; } = "";
    public string ProjectId { get; set; } = null!;
    public string? SectionId { get; set; }
    public string? ParentId { get; set; }
    public List<string> LabelIds { get; set; } = [];
    /// <summary>1 = P1 (highest) .. 4 = P4 (none), matching the Todoist UI.</summary>
    public int Priority { get; set; } = 4;
    public string? DueDate { get; set; }
    public string? DueTime { get; set; }
    public Recurrence Recurrence { get; set; } = Recurrence.None;
    public bool IsCompleted { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int Order { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
