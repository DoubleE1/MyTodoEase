using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Data;

public sealed class MongoContext
{
    public IMongoCollection<Project> Projects { get; }
    public IMongoCollection<Section> Sections { get; }
    public IMongoCollection<Label> Labels { get; }
    public IMongoCollection<TodoTask> Tasks { get; }

    public MongoContext(IOptions<MongoOptions> options)
    {
        var client = new MongoClient(options.Value.ConnectionString);
        var db = client.GetDatabase(options.Value.Database);
        Projects = db.GetCollection<Project>("projects");
        Sections = db.GetCollection<Section>("sections");
        Labels = db.GetCollection<Label>("labels");
        Tasks = db.GetCollection<TodoTask>("tasks");
    }

    /// <summary>Creates indexes and guarantees the Inbox project exists. Safe to run on every start.</summary>
    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await Tasks.Indexes.CreateManyAsync(
        [
            new CreateIndexModel<TodoTask>(Builders<TodoTask>.IndexKeys.Ascending(t => t.ProjectId).Ascending(t => t.IsCompleted)),
            new CreateIndexModel<TodoTask>(Builders<TodoTask>.IndexKeys.Ascending(t => t.IsCompleted).Ascending(t => t.DueDate)),
            new CreateIndexModel<TodoTask>(Builders<TodoTask>.IndexKeys.Ascending(t => t.ParentId)),
        ], ct);
        await Sections.Indexes.CreateOneAsync(
            new CreateIndexModel<Section>(Builders<Section>.IndexKeys.Ascending(s => s.ProjectId)), cancellationToken: ct);

        var inboxExists = await Projects.Find(p => p.IsInbox).AnyAsync(ct);
        if (!inboxExists)
        {
            await Projects.InsertOneAsync(new Project { Name = "Inbox", Color = "grey", IsInbox = true, Order = 0 }, cancellationToken: ct);
        }
    }

    public static bool IsValidId(string? id) => id is not null && ObjectId.TryParse(id, out _);
}
