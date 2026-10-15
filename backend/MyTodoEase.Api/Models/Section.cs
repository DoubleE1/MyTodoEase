
using LiteDB;

namespace MyTodoEase.Api.Models;

public sealed class Section
{
    [BsonId]
    public string Id { get; set; } = null!;
    public string ProjectId { get; set; } = null!;
    public string Name { get; set; } = "";
    public int Order { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
