using LiteDB;

namespace MyTodoEase.Api.Models;

/// <summary>Which Google Calendar event mirrors a task, so pushes can update instead of duplicate.</summary>
public sealed class CalendarLink
{
    /// <summary>The task id.</summary>
    [BsonId]
    public string Id { get; set; } = null!;
    public string CalendarId { get; set; } = null!;
    public string EventId { get; set; } = null!;
    /// <summary>Hash of the pushed fields; an unchanged task is not pushed again.</summary>
    public string Hash { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
