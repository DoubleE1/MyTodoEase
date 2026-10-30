using System.Globalization;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;
using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Endpoints;

public static class TasksEndpoints
{
    private const string DateFormat = "yyyy-MM-dd";
    private const string TimeFormat = "HH:mm";

    public static IEndpointRouteBuilder MapTasks(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/tasks").WithTags("Tasks");

        // Active tasks by default. The client filters views (Today, Upcoming, project, label) locally,
        // which keeps the API simple for a single-user app. completed=true returns the completed log, newest first.
        group.MapGet("/", async (bool? completed, int? limit, IDataStore store, CancellationToken ct) =>
        {
            var all = await store.Tasks.AllAsync(ct);
            if (completed == true)
            {
                var done = all.Where(t => t.IsCompleted)
                    .OrderByDescending(t => t.CompletedAt)
                    .Take(Math.Clamp(limit ?? 200, 1, 1000))
                    .ToList();
                return Results.Ok(done);
            }
            var active = all.Where(t => !t.IsCompleted).OrderBy(t => t.Order).ThenBy(t => t.CreatedAt).ToList();
            return Results.Ok(active);
        });

        group.MapGet("/{id}", async (string id, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var task = await store.Tasks.GetAsync(id, ct);
            return task is null ? Results.NotFound() : Results.Ok(task);
        });

        group.MapPost("/", async (TaskWriteRequest req, IDataStore store, CalendarSyncService sync, CancellationToken ct) =>
        {
            var errors = await ValidateAsync(req, store, ct);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var task = new TodoTask { Id = AppDb.NewId(), Order = req.Order ?? await NextOrderAsync(store, req.ProjectId, ct) };
            Apply(task, req);
            await store.Tasks.UpsertAsync(task, ct);
            sync.Enqueue(task.Id);
            return Results.Created($"/api/tasks/{task.Id}", task);
        });

        group.MapPut("/{id}", async (string id, TaskWriteRequest req, IDataStore store, CalendarSyncService sync, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var errors = await ValidateAsync(req, store, ct);
            if (req.ParentId == id) errors["parentId"] = ["A task cannot be its own parent."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var task = await store.Tasks.GetAsync(id, ct);
            if (task is null) return Results.NotFound();

            Apply(task, req);
            if (req.Order is int order) task.Order = order;

            // Subtasks follow their parent when it moves to another project or section.
            var children = (await store.Tasks.AllAsync(ct)).Where(t => t.ParentId == id).ToList();
            foreach (var child in children)
            {
                child.ProjectId = task.ProjectId;
                child.SectionId = task.SectionId;
            }
            await store.Tasks.UpsertManyAsync(children.Prepend(task), ct);
            sync.Enqueue(task.Id);
            return Results.Ok(task);
        });

        group.MapDelete("/{id}", async (string id, IDataStore store, CalendarSyncService sync, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (await store.Tasks.GetAsync(id, ct) is null) return Results.NotFound();
            var childIds = (await store.Tasks.AllAsync(ct)).Where(t => t.ParentId == id).Select(t => t.Id).ToList();
            await store.Tasks.DeleteManyAsync(childIds.Prepend(id), ct);
            sync.Enqueue(id);
            foreach (var childId in childIds) sync.Enqueue(childId);
            return Results.NoContent();
        });

        group.MapPost("/{id}/complete", async (string id, IDataStore store, CalendarSyncService sync, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var task = await store.Tasks.GetAsync(id, ct);
            if (task is null) return Results.NotFound();

            var now = DateTime.UtcNow;
            Completion Log(TodoTask t) => new()
            {
                Id = AppDb.NewId(),
                TaskId = t.Id,
                Content = t.Content,
                ProjectId = t.ProjectId,
                CompletedAt = now,
            };

            // Recurring tasks are not closed; they roll forward to the next occurrence, but the completion still counts.
            if (task.Recurrence != Recurrence.None && TryParseDate(task.DueDate, out var due))
            {
                var next = RecurrenceService.Next(due, task.Recurrence, DateOnly.FromDateTime(DateTime.Now));
                await store.Completions.UpsertAsync(Log(task), ct);
                task.DueDate = next.ToString(DateFormat, CultureInfo.InvariantCulture);
                // A multi-day task keeps its length: the start moves by as many days as the due date.
                if (TryParseDate(task.StartDate, out var start))
                    task.StartDate = start.AddDays(next.DayNumber - due.DayNumber).ToString(DateFormat, CultureInfo.InvariantCulture);
                task.UpdatedAt = now;
                await store.Tasks.UpsertAsync(task, ct);
                sync.Enqueue(task.Id);
                return Results.Ok(task);
            }

            var openChildren = (await store.Tasks.AllAsync(ct)).Where(t => t.ParentId == id && !t.IsCompleted).ToList();
            var closing = openChildren.Prepend(task).ToList();
            await store.Completions.UpsertManyAsync(closing.Select(Log), ct);
            foreach (var t in closing)
            {
                t.IsCompleted = true;
                t.CompletedAt = now;
                t.UpdatedAt = now;
            }
            await store.Tasks.UpsertManyAsync(closing, ct);
            foreach (var t in closing) sync.Enqueue(t.Id);
            return Results.Ok(task);
        });

        group.MapPost("/{id}/reopen", async (string id, IDataStore store, CalendarSyncService sync, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var task = await store.Tasks.GetAsync(id, ct);
            if (task is null) return Results.NotFound();

            var now = DateTime.UtcNow;
            Reopen(task, now);
            var updates = new List<TodoTask> { task };

            // A reopened subtask needs its parent visible again.
            if (task.ParentId is not null && await store.Tasks.GetAsync(task.ParentId, ct) is { } parent)
            {
                Reopen(parent, now);
                updates.Add(parent);
            }
            await store.Tasks.UpsertManyAsync(updates, ct);
            foreach (var t in updates) sync.Enqueue(t.Id);

            // Undo the latest completion log entry so history matches what the user sees.
            var latest = (await store.Completions.AllAsync(ct)).Where(c => c.TaskId == id).MaxBy(c => c.CompletedAt);
            if (latest is not null) await store.Completions.DeleteAsync(latest.Id, ct);
            return Results.Ok(task);
        });

        group.MapPost("/reorder", async (ReorderRequest req, IDataStore store, CalendarSyncService sync, CancellationToken ct) =>
        {
            if (req.Items is null || req.Items.Count == 0) return Results.NoContent();
            var now = DateTime.UtcNow;
            var updates = new List<TodoTask>();
            foreach (var item in req.Items)
            {
                if (!AppDb.IsValidId(item.Id)) continue;
                var task = await store.Tasks.GetAsync(item.Id, ct);
                if (task is null) continue;
                task.Order = item.Order;
                task.UpdatedAt = now;
                if (item.SectionId is not null) task.SectionId = item.SectionId == "" ? null : item.SectionId;
                if (item.ParentId is not null) task.ParentId = item.ParentId == "" ? null : item.ParentId;
                updates.Add(task);
            }
            await store.Tasks.UpsertManyAsync(updates, ct);
            foreach (var task in updates) sync.Enqueue(task.Id);
            return Results.NoContent();
        });

        return app;
    }

    private static void Reopen(TodoTask task, DateTime now)
    {
        task.IsCompleted = false;
        task.CompletedAt = null;
        task.UpdatedAt = now;
    }

    private static void Apply(TodoTask task, TaskWriteRequest req)
    {
        task.Content = req.Content.Trim();
        task.Description = req.Description?.Trim() ?? "";
        task.ProjectId = req.ProjectId;
        task.SectionId = string.IsNullOrEmpty(req.SectionId) ? null : req.SectionId;
        task.ParentId = string.IsNullOrEmpty(req.ParentId) ? null : req.ParentId;
        task.LabelIds = req.LabelIds?.Distinct().ToList() ?? [];
        task.Priority = req.Priority ?? 4;
        task.DueDate = string.IsNullOrEmpty(req.DueDate) ? null : req.DueDate;
        task.DueTime = task.DueDate is null || string.IsNullOrEmpty(req.DueTime) ? null : req.DueTime;
        if (req.StartDate is not null) task.StartDate = req.StartDate == "" ? null : req.StartDate;
        // A start only makes sense strictly before the due date; anything else is a one-day task again.
        if (task.DueDate is null || task.StartDate is null || string.CompareOrdinal(task.StartDate, task.DueDate) >= 0)
            task.StartDate = null;
        task.DurationMinutes = req.DurationMinutes;
        task.Recurrence = task.DueDate is null ? Recurrence.None : req.Recurrence ?? Recurrence.None;
        task.UpdatedAt = DateTime.UtcNow;
    }

    private static async Task<Dictionary<string, string[]>> ValidateAsync(TaskWriteRequest req, IDataStore store, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Content)) errors["content"] = ["Content is required."];
        if (req.Priority is < 1 or > 4) errors["priority"] = ["Priority must be between 1 and 4."];
        if (req.DurationMinutes is < 5 or > 1440) errors["durationMinutes"] = ["Duration must be between 5 and 1440 minutes."];
        if (!string.IsNullOrEmpty(req.DueDate) && !TryParseDate(req.DueDate, out _)) errors["dueDate"] = ["Due date must be yyyy-MM-dd."];
        if (!string.IsNullOrEmpty(req.StartDate) && !TryParseDate(req.StartDate, out _)) errors["startDate"] = ["Start date must be yyyy-MM-dd."];
        if (!string.IsNullOrEmpty(req.DueTime) &&
            !TimeOnly.TryParseExact(req.DueTime, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            errors["dueTime"] = ["Due time must be HH:mm."];

        if (!AppDb.IsValidId(req.ProjectId) || await store.Projects.GetAsync(req.ProjectId, ct) is null)
            errors["projectId"] = ["Project does not exist."];
        if (!string.IsNullOrEmpty(req.SectionId) &&
            (!AppDb.IsValidId(req.SectionId) || await store.Sections.GetAsync(req.SectionId, ct) is null))
            errors["sectionId"] = ["Section does not exist."];
        if (!string.IsNullOrEmpty(req.ParentId) &&
            (!AppDb.IsValidId(req.ParentId) || await store.Tasks.GetAsync(req.ParentId, ct) is null))
            errors["parentId"] = ["Parent task does not exist."];
        return errors;
    }

    private static bool TryParseDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static async Task<int> NextOrderAsync(IDataStore store, string projectId, CancellationToken ct)
    {
        var last = (await store.Tasks.AllAsync(ct)).Where(t => t.ProjectId == projectId).MaxBy(t => t.Order);
        return last is null ? 0 : last.Order + 1;
    }
}
