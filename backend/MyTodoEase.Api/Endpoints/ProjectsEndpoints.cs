using MongoDB.Driver;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class ProjectsEndpoints
{
    public static IEndpointRouteBuilder MapProjects(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/projects").WithTags("Projects");

        group.MapGet("/", async (MongoContext db) =>
            Results.Ok(await db.Projects.Find(_ => true).SortBy(p => p.Order).ThenBy(p => p.CreatedAt).ToListAsync()));

        group.MapGet("/{id}", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var project = await db.Projects.Find(p => p.Id == id).FirstOrDefaultAsync();
            return project is null ? Results.NotFound() : Results.Ok(project);
        });

        group.MapPost("/", async (ProjectWriteRequest req, MongoContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var order = req.Order ?? await NextOrderAsync(db);
            var project = new Project
            {
                Name = req.Name.Trim(),
                Color = req.Color ?? "grey",
                Order = order,
                IsFavorite = req.IsFavorite ?? false,
            };
            await db.Projects.InsertOneAsync(project);
            return Results.Created($"/api/projects/{project.Id}", project);
        });

        group.MapPut("/{id}", async (string id, ProjectWriteRequest req, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var update = Builders<Project>.Update
                .Set(p => p.Name, req.Name.Trim())
                .Set(p => p.Color, req.Color ?? "grey")
                .Set(p => p.IsFavorite, req.IsFavorite ?? false);
            if (req.Order is int order) update = update.Set(p => p.Order, order);

            var project = await db.Projects.FindOneAndUpdateAsync(
                p => p.Id == id, update, new FindOneAndUpdateOptions<Project> { ReturnDocument = ReturnDocument.After });
            return project is null ? Results.NotFound() : Results.Ok(project);
        });

        group.MapDelete("/{id}", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var project = await db.Projects.Find(p => p.Id == id).FirstOrDefaultAsync();
            if (project is null) return Results.NotFound();
            if (project.IsInbox) return Results.Problem("The Inbox project cannot be deleted.", statusCode: StatusCodes.Status400BadRequest);

            // Cascade: a project owns its sections and tasks.
            await db.Tasks.DeleteManyAsync(t => t.ProjectId == id);
            await db.Sections.DeleteManyAsync(s => s.ProjectId == id);
            await db.Projects.DeleteOneAsync(p => p.Id == id);
            return Results.NoContent();
        });

        return app;
    }

    private static async Task<int> NextOrderAsync(MongoContext db)
    {
        var last = await db.Projects.Find(_ => true).SortByDescending(p => p.Order).Limit(1).FirstOrDefaultAsync();
        return last is null ? 0 : last.Order + 1;
    }
}
