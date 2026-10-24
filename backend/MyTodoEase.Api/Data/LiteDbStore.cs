using LiteDB;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Data;

/// <summary>Local mode: rows in the embedded LiteDB file.</summary>
public sealed class LiteDbStore : IDataStore
{
    private readonly AppDb _db;

    public LiteDbStore(AppDb db)
    {
        _db = db;
        Projects = new Repo<Project>(db.Projects);
        Sections = new Repo<Section>(db.Sections);
        Labels = new Repo<Label>(db.Labels);
        Tasks = new Repo<TodoTask>(db.Tasks);
        Completions = new Repo<Completion>(db.Completions);
    }

    public string Description => _db.FilePath;
    public bool IsCloud => false;
    public IRepository<Project> Projects { get; }
    public IRepository<Section> Sections { get; }
    public IRepository<Label> Labels { get; }
    public IRepository<TodoTask> Tasks { get; }
    public IRepository<Completion> Completions { get; }

    public Task ReplaceAllAsync(
        IEnumerable<Project> projects,
        IEnumerable<Section> sections,
        IEnumerable<Label> labels,
        IEnumerable<TodoTask> tasks,
        IEnumerable<Completion> completions,
        CancellationToken ct = default)
    {
        _db.ReplaceAll(projects, sections, labels, tasks, completions);
        return Task.CompletedTask;
    }

    private sealed class Repo<T>(ILiteCollection<T> collection) : IRepository<T> where T : class
    {
        public Task<List<T>> AllAsync(CancellationToken ct = default) => Task.FromResult(collection.FindAll().ToList());

        public Task<T?> GetAsync(string id, CancellationToken ct = default) =>
            Task.FromResult<T?>(AppDb.IsValidId(id) ? collection.FindById(id) : null);

        public Task UpsertAsync(T item, CancellationToken ct = default)
        {
            collection.Upsert(item);
            return Task.CompletedTask;
        }

        public Task UpsertManyAsync(IEnumerable<T> items, CancellationToken ct = default)
        {
            collection.Upsert(items);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(string id, CancellationToken ct = default)
        {
            collection.Delete(id);
            return Task.CompletedTask;
        }

        public Task DeleteManyAsync(IEnumerable<string> ids, CancellationToken ct = default)
        {
            foreach (var id in ids) collection.Delete(id);
            return Task.CompletedTask;
        }
    }
}
