using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class ProjectsEndpoints
{
    public static IEndpointRouteBuilder MapProjects(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/projects").WithTags("Projects");

        group.MapGet("/", async (IDataStore store, CancellationToken ct) =>
            Results.Ok((await store.ProjectsWithInboxAsync(ct)).OrderBy(p => p.Order).ThenBy(p => p.CreatedAt).ToList()));

        group.MapGet("/{id}", async (string id, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var project = await store.Projects.GetAsync(id, ct);
            return project is null ? Results.NotFound() : Results.Ok(project);
        });

        group.MapPost("/", async (ProjectWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var project = new Project
            {
                Id = AppDb.NewId(),
                Name = req.Name.Trim(),
                Color = req.Color ?? "grey",
                Order = req.Order ?? await NextOrderAsync(store, ct),
                IsFavorite = req.IsFavorite ?? false,
            };
            await store.Projects.UpsertAsync(project, ct);
            return Results.Created($"/api/projects/{project.Id}", project);
        });

        group.MapPut("/{id}", async (string id, ProjectWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var project = await store.Projects.GetAsync(id, ct);
            if (project is null) return Results.NotFound();

            project.Name = req.Name.Trim();
            project.Color = req.Color ?? "grey";
            project.IsFavorite = req.IsFavorite ?? false;
            if (req.Order is int order) project.Order = order;
            await store.Projects.UpsertAsync(project, ct);
            return Results.Ok(project);
        });

        group.MapDelete("/{id}", async (string id, IDataStore store, Services.CalendarSyncService sync, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var project = await store.Projects.GetAsync(id, ct);
            if (project is null) return Results.NotFound();
            if (project.IsInbox) return Results.Problem("The Inbox project cannot be deleted.", statusCode: StatusCodes.Status400BadRequest);

            // Cascade: a project owns its sections and tasks.
            var taskIds = (await store.Tasks.AllAsync(ct)).Where(t => t.ProjectId == id).Select(t => t.Id).ToList();
            var sectionIds = (await store.Sections.AllAsync(ct)).Where(s => s.ProjectId == id).Select(s => s.Id).ToList();
            await store.Tasks.DeleteManyAsync(taskIds, ct);
            await store.Sections.DeleteManyAsync(sectionIds, ct);
            await store.Projects.DeleteAsync(id, ct);
            sync.EnqueueFull();
            return Results.NoContent();
        });

        return app;
    }

    private static async Task<int> NextOrderAsync(IDataStore store, CancellationToken ct)
    {
        var last = (await store.Projects.AllAsync(ct)).MaxBy(p => p.Order);
        return last is null ? 0 : last.Order + 1;
    }
}
