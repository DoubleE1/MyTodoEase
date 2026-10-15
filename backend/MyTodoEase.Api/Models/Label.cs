using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace MyTodoEase.Api.Models;

public sealed class Label
{
    [BsonId, BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Color { get; set; } = "grey";
    public int Order { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
