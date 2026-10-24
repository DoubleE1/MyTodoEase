using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

/// <summary>
/// Whole-database export and import as one JSON document. Data lives only on this computer, so
/// this is the user's way to back up, move to another PC, or recover after a reinstall.
/// </summary>
public static class BackupEndpoints
{
    public const int CurrentVersion = 1;

    public sealed record BackupDocument(
        string App,
        int Version,
        DateTime ExportedAt,
        List<Project> Projects,
        List<Section> Sections,
        List<Label> Labels,
        List<TodoTask> Tasks,
        List<Completion> Completions);

    public sealed record ImportResult(int Projects, int Sections, int Labels, int Tasks, int Completions);

    public static IEndpointRouteBuilder MapBackup(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/backup").WithTags("Backup");

        group.MapGet("/", async (IDataStore store, CancellationToken ct) => Results.Ok(await ExportAsync(store, ct)));

        // The LiteDB file as it is on this PC, regardless of mode: lets a signed-in user move local data to the cloud.
        group.MapGet("/local", async (DataStoreProvider stores, CancellationToken ct) => Results.Ok(await ExportAsync(stores.Local, ct)));

        // Replaces everything. The client asks the user to confirm before calling this.
        group.MapPost("/import", async (BackupDocument? doc, IDataStore store, Services.CalendarSyncService sync, CancellationToken ct) =>
        {
            if (doc is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["Not a TodoEase backup."] });
            var errors = Validate(doc);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var projects = doc.Projects ?? [];
            var sections = doc.Sections ?? [];
            var labels = doc.Labels ?? [];
            var tasks = doc.Tasks ?? [];
            var completions = doc.Completions ?? [];

            // References to rows missing from the file are dropped rather than rejected, so a hand-edited
            // or partially damaged backup still imports what it can.
            var projectIds = projects.Select(p => p.Id).ToHashSet();
            var sectionIds = sections.Select(s => s.Id).ToHashSet();
            var labelIds = labels.Select(l => l.Id).ToHashSet();
            var taskIds = tasks.Select(t => t.Id).ToHashSet();
            sections = sections.Where(s => projectIds.Contains(s.ProjectId)).ToList();
            tasks = tasks.Where(t => projectIds.Contains(t.ProjectId)).ToList();
            foreach (var t in tasks)
            {
                if (t.SectionId is not null && !sectionIds.Contains(t.SectionId)) t.SectionId = null;
                if (t.ParentId is not null && !taskIds.Contains(t.ParentId)) t.ParentId = null;
                t.LabelIds = (t.LabelIds ?? []).Where(labelIds.Contains).Distinct().ToList();
                t.Content ??= "";
                t.Description ??= "";
                if (t.Priority is < 1 or > 4) t.Priority = 4;
            }
            foreach (var p in projects) { p.Name ??= ""; p.Color ??= "grey"; }
            foreach (var s in sections) s.Name ??= "";
            foreach (var l in labels) { l.Name ??= ""; l.Color ??= "grey"; }
            foreach (var c in completions) c.Content ??= "";

            // Exactly one Inbox: keep the first flagged one, or add one when the file has none.
            var inboxes = projects.Where(p => p.IsInbox).ToList();
            foreach (var extra in inboxes.Skip(1)) extra.IsInbox = false;
            if (inboxes.Count == 0)
                projects.Insert(0, new Project { Id = AppDb.NewId(), Name = "Inbox", Color = "grey", IsInbox = true, Order = -1 });

            await store.ReplaceAllAsync(projects, sections, labels, tasks, completions, ct);
            sync.EnqueueFull();
            return Results.Ok(new ImportResult(projects.Count, sections.Count, labels.Count, tasks.Count, completions.Count));
        });

        return app;
    }

    private static async Task<BackupDocument> ExportAsync(IDataStore store, CancellationToken ct) => new(
        "MyTodoEase",
        CurrentVersion,
        DateTime.UtcNow,
        await store.Projects.AllAsync(ct),
        await store.Sections.AllAsync(ct),
        await store.Labels.AllAsync(ct),
        await store.Tasks.AllAsync(ct),
        await store.Completions.AllAsync(ct));

    private static Dictionary<string, string[]> Validate(BackupDocument doc)
    {
        var errors = new Dictionary<string, string[]>();
        if (!string.Equals(doc.App, "MyTodoEase", StringComparison.OrdinalIgnoreCase))
            errors["file"] = ["Not a TodoEase backup."];
        if (doc.Version is < 1 or > CurrentVersion)
            errors["version"] = [$"Backup version {doc.Version} is not supported by this app."];

        var ids = new HashSet<string>();
        void CheckIds(string field, IEnumerable<string?> values)
        {
            foreach (var id in values)
            {
                if (!AppDb.IsValidId(id)) { errors[field] = ["Contains an invalid id."]; return; }
                if (!ids.Add(id!)) { errors[field] = [$"Duplicate id {id}."]; return; }
            }
        }
        CheckIds("projects", (doc.Projects ?? []).Select(p => p.Id));
        CheckIds("sections", (doc.Sections ?? []).Select(s => s.Id));
        CheckIds("labels", (doc.Labels ?? []).Select(l => l.Id));
        CheckIds("tasks", (doc.Tasks ?? []).Select(t => t.Id));
        CheckIds("completions", (doc.Completions ?? []).Select(c => c.Id));
        return errors;
    }
}
