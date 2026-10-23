using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class ProjectsEndpoints
{
    public static IEndpointRouteBuilder MapProjects(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/projects").WithTags("Projects");

        group.MapGet("/", (AppDb db) =>
            Results.Ok(db.Projects.FindAll().OrderBy(p => p.Order).ThenBy(p => p.CreatedAt).ToList()));

        group.MapGet("/{id}", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var project = db.Projects.FindById(id);
            return project is null ? Results.NotFound() : Results.Ok(project);
        });

        group.MapPost("/", (ProjectWriteRequest req, AppDb db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var project = new Project
            {
                Id = AppDb.NewId(),
                Name = req.Name.Trim(),
                Color = req.Color ?? "grey",
                Order = req.Order ?? NextOrder(db),
                IsFavorite = req.IsFavorite ?? false,
            };
            db.Projects.Insert(project);
            return Results.Created($"/api/projects/{project.Id}", project);
        });

        group.MapPut("/{id}", (string id, ProjectWriteRequest req, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var project = db.Projects.FindById(id);
            if (project is null) return Results.NotFound();

            project.Name = req.Name.Trim();
            project.Color = req.Color ?? "grey";
            project.IsFavorite = req.IsFavorite ?? false;
            if (req.Order is int order) project.Order = order;
            db.Projects.Update(project);
            return Results.Ok(project);
        });

        group.MapDelete("/{id}", (string id, AppDb db, Services.CalendarSyncService sync) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var project = db.Projects.FindById(id);
            if (project is null) return Results.NotFound();
            if (project.IsInbox) return Results.Problem("The Inbox project cannot be deleted.", statusCode: StatusCodes.Status400BadRequest);

            // Cascade: a project owns its sections and tasks.
            db.Tasks.DeleteMany(t => t.ProjectId == id);
            db.Sections.DeleteMany(s => s.ProjectId == id);
            db.Projects.Delete(id);
            sync.EnqueueFull();
            return Results.NoContent();
        });

        return app;
    }

    private static int NextOrder(AppDb db)
    {
        var last = db.Projects.FindAll().MaxBy(p => p.Order);
        return last is null ? 0 : last.Order + 1;
    }
}
