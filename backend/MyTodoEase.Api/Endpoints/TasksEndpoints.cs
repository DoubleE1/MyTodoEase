using System.Globalization;
using MongoDB.Driver;
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
        group.MapGet("/", async (bool? completed, int? limit, MongoContext db) =>
        {
            if (completed == true)
            {
                var done = await db.Tasks.Find(t => t.IsCompleted)
                    .SortByDescending(t => t.CompletedAt)
                    .Limit(Math.Clamp(limit ?? 200, 1, 1000))
                    .ToListAsync();
                return Results.Ok(done);
            }
            var active = await db.Tasks.Find(t => !t.IsCompleted).SortBy(t => t.Order).ThenBy(t => t.CreatedAt).ToListAsync();
            return Results.Ok(active);
        });

        group.MapGet("/{id}", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var task = await db.Tasks.Find(t => t.Id == id).FirstOrDefaultAsync();
            return task is null ? Results.NotFound() : Results.Ok(task);
        });

        group.MapPost("/", async (TaskWriteRequest req, MongoContext db) =>
        {
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var order = req.Order ?? await NextOrderAsync(db, req.ProjectId);
            var task = new TodoTask { Order = order };
            Apply(task, req);
            await db.Tasks.InsertOneAsync(task);
            return Results.Created($"/api/tasks/{task.Id}", task);
        });

        group.MapPut("/{id}", async (string id, TaskWriteRequest req, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var errors = await ValidateAsync(req, db);
            if (req.ParentId == id) errors["parentId"] = ["A task cannot be its own parent."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var task = await db.Tasks.Find(t => t.Id == id).FirstOrDefaultAsync();
            if (task is null) return Results.NotFound();

            Apply(task, req);
            if (req.Order is int order) task.Order = order;
            await db.Tasks.ReplaceOneAsync(t => t.Id == id, task);

            // Subtasks follow their parent when it moves to another project or section.
            await db.Tasks.UpdateManyAsync(t => t.ParentId == id,
                Builders<TodoTask>.Update.Set(t => t.ProjectId, task.ProjectId).Set(t => t.SectionId, task.SectionId));
            return Results.Ok(task);
        });

        group.MapDelete("/{id}", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var result = await db.Tasks.DeleteOneAsync(t => t.Id == id);
            if (result.DeletedCount == 0) return Results.NotFound();
            await db.Tasks.DeleteManyAsync(t => t.ParentId == id);
            return Results.NoContent();
        });

        group.MapPost("/{id}/complete", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var task = await db.Tasks.Find(t => t.Id == id).FirstOrDefaultAsync();
            if (task is null) return Results.NotFound();

            var now = DateTime.UtcNow;

            // Recurring tasks are not closed; they roll forward to the next occurrence.
            if (task.Recurrence != Recurrence.None && TryParseDate(task.DueDate, out var due))
            {
                var next = RecurrenceService.Next(due, task.Recurrence, DateOnly.FromDateTime(DateTime.Now));
                var rolled = await db.Tasks.FindOneAndUpdateAsync(
                    t => t.Id == id,
                    Builders<TodoTask>.Update
                        .Set(t => t.DueDate, next.ToString(DateFormat, CultureInfo.InvariantCulture))
                        .Set(t => t.UpdatedAt, now),
                    new FindOneAndUpdateOptions<TodoTask> { ReturnDocument = ReturnDocument.After });
                return Results.Ok(rolled);
            }

            var update = Builders<TodoTask>.Update
                .Set(t => t.IsCompleted, true)
                .Set(t => t.CompletedAt, now)
                .Set(t => t.UpdatedAt, now);
            await db.Tasks.UpdateManyAsync(t => t.Id == id || t.ParentId == id, update);
            return Results.Ok(await db.Tasks.Find(t => t.Id == id).FirstOrDefaultAsync());
        });

        group.MapPost("/{id}/reopen", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var update = Builders<TodoTask>.Update
                .Set(t => t.IsCompleted, false)
                .Set(t => t.CompletedAt, null)
                .Set(t => t.UpdatedAt, DateTime.UtcNow);
            var task = await db.Tasks.FindOneAndUpdateAsync(
                t => t.Id == id, update, new FindOneAndUpdateOptions<TodoTask> { ReturnDocument = ReturnDocument.After });
            if (task is null) return Results.NotFound();

            // A reopened subtask needs its parent visible again.
            if (task.ParentId is not null)
                await db.Tasks.UpdateOneAsync(t => t.Id == task.ParentId, update);
            return Results.Ok(task);
        });

        group.MapPost("/reorder", async (ReorderRequest req, MongoContext db) =>
        {
            if (req.Items is null || req.Items.Count == 0) return Results.NoContent();
            var now = DateTime.UtcNow;
            var writes = req.Items
                .Where(i => MongoContext.IsValidId(i.Id))
                .Select(i =>
                {
                    var update = Builders<TodoTask>.Update.Set(t => t.Order, i.Order).Set(t => t.UpdatedAt, now);
                    if (i.SectionId is not null) update = update.Set(t => t.SectionId, i.SectionId == "" ? null : i.SectionId);
                    if (i.ParentId is not null) update = update.Set(t => t.ParentId, i.ParentId == "" ? null : i.ParentId);
                    return (WriteModel<TodoTask>)new UpdateOneModel<TodoTask>(Builders<TodoTask>.Filter.Eq(t => t.Id, i.Id), update);
                })
                .ToList();
            if (writes.Count > 0) await db.Tasks.BulkWriteAsync(writes);
            return Results.NoContent();
        });

        return app;
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

    private static async Task<Dictionary<string, string[]>> ValidateAsync(TaskWriteRequest req, MongoContext db)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Content)) errors["content"] = ["Content is required."];
        if (req.Priority is < 1 or > 4) errors["priority"] = ["Priority must be between 1 and 4."];
        if (!string.IsNullOrEmpty(req.DueDate) && !TryParseDate(req.DueDate, out _)) errors["dueDate"] = ["Due date must be yyyy-MM-dd."];
        if (!string.IsNullOrEmpty(req.DueTime) &&
            !TimeOnly.TryParseExact(req.DueTime, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            errors["dueTime"] = ["Due time must be HH:mm."];

        if (!MongoContext.IsValidId(req.ProjectId) || !await db.Projects.Find(p => p.Id == req.ProjectId).AnyAsync())
            errors["projectId"] = ["Project does not exist."];
        if (!string.IsNullOrEmpty(req.SectionId) &&
            (!MongoContext.IsValidId(req.SectionId) || !await db.Sections.Find(s => s.Id == req.SectionId).AnyAsync()))
            errors["sectionId"] = ["Section does not exist."];
        if (!string.IsNullOrEmpty(req.ParentId) &&
            (!MongoContext.IsValidId(req.ParentId) || !await db.Tasks.Find(t => t.Id == req.ParentId).AnyAsync()))
            errors["parentId"] = ["Parent task does not exist."];
        return errors;
    }

    private static bool TryParseDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static async Task<int> NextOrderAsync(MongoContext db, string projectId)
    {
        var last = await db.Tasks.Find(t => t.ProjectId == projectId).SortByDescending(t => t.Order).Limit(1).FirstOrDefaultAsync();
        return last is null ? 0 : last.Order + 1;
    }
}
