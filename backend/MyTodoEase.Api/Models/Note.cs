using LiteDB;

namespace MyTodoEase.Api.Models;

/// <summary>
/// A sticky note on the Notes board: free text the user jots down before it becomes (one or more) tasks.
/// TaskIds remembers the tasks created from it; a converted note is usually archived.
/// </summary>
public sealed class Note
{
    public static readonly string[] Colors = ["yellow", "green", "blue", "pink", "purple", "orange", "grey"];
    public const int MaxTextLength = 20000;

    [BsonId]
    public string Id { get; set; } = null!;
    public string Text { get; set; } = "";
    public string Color { get; set; } = "yellow";
    /// <summary>Stacking order on the board: higher is drawn on top (the last note moved or created).</summary>
    public int Order { get; set; }
    /// <summary>Top-left corner on the board in CSS pixels; null until the note is first placed.</summary>
    public double? X { get; set; }
    public double? Y { get; set; }
    public bool IsArchived { get; set; }
    public List<string> TaskIds { get; set; } = [];
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
