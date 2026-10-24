using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Data;

/// <summary>
/// One collection of a user's data. The desktop API serves two stores behind this interface: the embedded
/// LiteDB file (local mode) and the user's Firestore tree (cloud mode, after signing in). Queries are kept
/// to whole-collection reads plus lookups by id; filtering happens in memory, which is fine for one person's
/// tasks and keeps both implementations trivially equivalent.
/// </summary>
public interface IRepository<T> where T : class
{
    Task<List<T>> AllAsync(CancellationToken ct = default);
    Task<T?> GetAsync(string id, CancellationToken ct = default);
    /// <summary>Insert or replace the whole row.</summary>
    Task UpsertAsync(T item, CancellationToken ct = default);
    Task UpsertManyAsync(IEnumerable<T> items, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
    Task DeleteManyAsync(IEnumerable<string> ids, CancellationToken ct = default);
}

public interface IDataStore
{
    /// <summary>Human-readable description shown in Settings (file path, or the cloud account).</summary>
    string Description { get; }
    /// <summary>True when rows live in Firestore under the signed-in Google account.</summary>
    bool IsCloud { get; }

    IRepository<Project> Projects { get; }
    IRepository<Section> Sections { get; }
    IRepository<Label> Labels { get; }
    IRepository<TodoTask> Tasks { get; }
    IRepository<Completion> Completions { get; }

    /// <summary>Swaps all user data for the given rows (backup import).</summary>
    Task ReplaceAllAsync(
        IEnumerable<Project> projects,
        IEnumerable<Section> sections,
        IEnumerable<Label> labels,
        IEnumerable<TodoTask> tasks,
        IEnumerable<Completion> completions,
        CancellationToken ct = default);
}

public static class DataStoreExtensions
{
    /// <summary>Guarantees exactly one Inbox project exists and returns all projects.</summary>
    public static async Task<List<Project>> ProjectsWithInboxAsync(this IDataStore store, CancellationToken ct = default)
    {
        var projects = await store.Projects.AllAsync(ct);
        if (projects.Any(p => p.IsInbox)) return projects;
        var inbox = new Project { Id = AppDb.NewId(), Name = "Inbox", Color = "grey", IsInbox = true, Order = -1 };
        await store.Projects.UpsertAsync(inbox, ct);
        projects.Insert(0, inbox);
        return projects;
    }
}
