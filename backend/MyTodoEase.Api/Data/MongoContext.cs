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
    public IMongoCollection<Completion> Completions { get; }

    public MongoContext(IOptions<MongoOptions> options)
    {
        var client = new MongoClient(options.Value.ConnectionString);
        var db = client.GetDatabase(options.Value.Database);
        Projects = db.GetCollection<Project>("projects");
        Sections = db.GetCollection<Section>("sections");
        Labels = db.GetCollection<Label>("labels");
        Tasks = db.GetCollection<TodoTask>("tasks");
        Completions = db.GetCollection<Completion>("completions");
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
        await Completions.Indexes.CreateManyAsync(
        [
            new CreateIndexModel<Completion>(Builders<Completion>.IndexKeys.Descending(c => c.CompletedAt)),
            new CreateIndexModel<Completion>(Builders<Completion>.IndexKeys.Ascending(c => c.TaskId).Descending(c => c.CompletedAt)),
        ], ct);

        var inboxExists = await Projects.Find(p => p.IsInbox).AnyAsync(ct);
        if (!inboxExists)
        {
            await Projects.InsertOneAsync(new Project { Name = "Inbox", Color = "grey", IsInbox = true, Order = 0 }, cancellationToken: ct);
        }

        await BackfillCompletionsAsync(ct);
    }

    /// <summary>One-time migration: tasks completed before the completion log existed get a log row.</summary>
    private async Task BackfillCompletionsAsync(CancellationToken ct)
    {
        if (await Completions.Find(_ => true).AnyAsync(ct)) return;
        var completed = await Tasks.Find(t => t.IsCompleted && t.CompletedAt != null).ToListAsync(ct);
        if (completed.Count == 0) return;
        await Completions.InsertManyAsync(
            completed.Select(t => new Completion
            {
                TaskId = t.Id,
                Content = t.Content,
                ProjectId = t.ProjectId,
                CompletedAt = t.CompletedAt!.Value,
            }),
            cancellationToken: ct);
    }

    public static bool IsValidId(string? id) => id is not null && ObjectId.TryParse(id, out _);
}
