
using LiteDB;

namespace MyTodoEase.Api.Models;

public sealed class Label
{
    [BsonId]
    public string Id { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Color { get; set; } = "grey";
    public int Order { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
