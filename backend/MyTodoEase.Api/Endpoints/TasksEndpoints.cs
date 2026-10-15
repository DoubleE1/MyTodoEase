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
        group.MapGet("/", (bool? completed, int? limit, AppDb db) =>
        {
            if (completed == true)
            {
                var done = db.Tasks.Find(t => t.IsCompleted)
                    .OrderByDescending(t => t.CompletedAt)
                    .Take(Math.Clamp(limit ?? 200, 1, 1000))
                    .ToList();
                return Results.Ok(done);
            }
            var active = db.Tasks.Find(t => !t.IsCompleted).OrderBy(t => t.Order).ThenBy(t => t.CreatedAt).ToList();
            return Results.Ok(active);
        });

        group.MapGet("/{id}", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var task = db.Tasks.FindById(id);
            return task is null ? Results.NotFound() : Results.Ok(task);
        });

        group.MapPost("/", (TaskWriteRequest req, AppDb db) =>
        {
            var errors = Validate(req, db);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var task = new TodoTask { Id = AppDb.NewId(), Order = req.Order ?? NextOrder(db, req.ProjectId) };
            Apply(task, req);
            db.Tasks.Insert(task);
            return Results.Created($"/api/tasks/{task.Id}", task);
        });

        group.MapPut("/{id}", (string id, TaskWriteRequest req, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var errors = Validate(req, db);
            if (req.ParentId == id) errors["parentId"] = ["A task cannot be its own parent."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var task = db.Tasks.FindById(id);
            if (task is null) return Results.NotFound();

            Apply(task, req);
            if (req.Order is int order) task.Order = order;
            db.Tasks.Update(task);

            // Subtasks follow their parent when it moves to another project or section.
            foreach (var child in db.Tasks.Find(t => t.ParentId == id).ToList())
            {
                child.ProjectId = task.ProjectId;
                child.SectionId = task.SectionId;
                db.Tasks.Update(child);
            }
            return Results.Ok(task);
        });

        group.MapDelete("/{id}", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (!db.Tasks.Delete(id)) return Results.NotFound();
            db.Tasks.DeleteMany(t => t.ParentId == id);
            return Results.NoContent();
        });

        group.MapPost("/{id}/complete", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var task = db.Tasks.FindById(id);
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
                db.Completions.Insert(Log(task));
                task.DueDate = next.ToString(DateFormat, CultureInfo.InvariantCulture);
                task.UpdatedAt = now;
                db.Tasks.Update(task);
                return Results.Ok(task);
            }

            var openChildren = db.Tasks.Find(t => t.ParentId == id && !t.IsCompleted).ToList();
            var logs = new List<Completion> { Log(task) };
            logs.AddRange(openChildren.Select(Log));
            db.Completions.InsertBulk(logs);

            foreach (var t in openChildren.Prepend(task))
            {
                t.IsCompleted = true;
                t.CompletedAt = now;
                t.UpdatedAt = now;
                db.Tasks.Update(t);
            }
            return Results.Ok(task);
        });

        group.MapPost("/{id}/reopen", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var task = db.Tasks.FindById(id);
            if (task is null) return Results.NotFound();

            var now = DateTime.UtcNow;
            Reopen(task, now);
            db.Tasks.Update(task);

            // Undo the latest completion log entry so history matches what the user sees.
            var latest = db.Completions.Find(c => c.TaskId == id).MaxBy(c => c.CompletedAt);
            if (latest is not null) db.Completions.Delete(latest.Id);

            // A reopened subtask needs its parent visible again.
            if (task.ParentId is not null && db.Tasks.FindById(task.ParentId) is { } parent)
            {
                Reopen(parent, now);
                db.Tasks.Update(parent);
            }
            return Results.Ok(task);
        });

        group.MapPost("/reorder", (ReorderRequest req, AppDb db) =>
        {
            if (req.Items is null || req.Items.Count == 0) return Results.NoContent();
            var now = DateTime.UtcNow;
            foreach (var item in req.Items)
            {
                if (!AppDb.IsValidId(item.Id)) continue;
                var task = db.Tasks.FindById(item.Id);
                if (task is null) continue;
                task.Order = item.Order;
                task.UpdatedAt = now;
                if (item.SectionId is not null) task.SectionId = item.SectionId == "" ? null : item.SectionId;
                if (item.ParentId is not null) task.ParentId = item.ParentId == "" ? null : item.ParentId;
                db.Tasks.Update(task);
            }
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
        task.Recurrence = task.DueDate is null ? Recurrence.None : req.Recurrence ?? Recurrence.None;
        task.UpdatedAt = DateTime.UtcNow;
    }

    private static Dictionary<string, string[]> Validate(TaskWriteRequest req, AppDb db)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Content)) errors["content"] = ["Content is required."];
        if (req.Priority is < 1 or > 4) errors["priority"] = ["Priority must be between 1 and 4."];
        if (!string.IsNullOrEmpty(req.DueDate) && !TryParseDate(req.DueDate, out _)) errors["dueDate"] = ["Due date must be yyyy-MM-dd."];
        if (!string.IsNullOrEmpty(req.DueTime) &&
            !TimeOnly.TryParseExact(req.DueTime, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            errors["dueTime"] = ["Due time must be HH:mm."];

        if (!AppDb.IsValidId(req.ProjectId) || db.Projects.FindById(req.ProjectId) is null)
            errors["projectId"] = ["Project does not exist."];
        if (!string.IsNullOrEmpty(req.SectionId) &&
            (!AppDb.IsValidId(req.SectionId) || db.Sections.FindById(req.SectionId) is null))
            errors["sectionId"] = ["Section does not exist."];
        if (!string.IsNullOrEmpty(req.ParentId) &&
            (!AppDb.IsValidId(req.ParentId) || db.Tasks.FindById(req.ParentId) is null))
            errors["parentId"] = ["Parent task does not exist."];
        return errors;
    }

    private static bool TryParseDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static int NextOrder(AppDb db, string projectId)
    {
        var last = db.Tasks.Find(t => t.ProjectId == projectId).MaxBy(t => t.Order);
        return last is null ? 0 : last.Order + 1;
    }
}
