
using LiteDB;

namespace MyTodoEase.Api.Models;

/// <summary>
/// One row per time a task was completed. Kept separately from tasks so that recurring
/// completions (which only roll the task forward) and tasks deleted afterwards still count
/// in history, the way commits stay in a Git log.
/// </summary>
public sealed class Completion
{
    [BsonId]
    public string Id { get; set; } = null!;
    public string TaskId { get; set; } = null!;
    public string Content { get; set; } = "";
    public string ProjectId { get; set; } = null!;
    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
}
