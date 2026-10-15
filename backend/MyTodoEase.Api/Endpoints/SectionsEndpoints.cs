using MongoDB.Driver;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class SectionsEndpoints
{
    public static IEndpointRouteBuilder MapSections(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sections").WithTags("Sections");

        group.MapGet("/", async (string? projectId, MongoContext db) =>
        {
            var filter = projectId is null
                ? Builders<Section>.Filter.Empty
                : Builders<Section>.Filter.Eq(s => s.ProjectId, projectId);
            return Results.Ok(await db.Sections.Find(filter).SortBy(s => s.Order).ThenBy(s => s.CreatedAt).ToListAsync());
        });

        group.MapPost("/", async (SectionWriteRequest req, MongoContext db) =>
        {
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var order = req.Order ?? await NextOrderAsync(db, req.ProjectId);
            var section = new Section { ProjectId = req.ProjectId, Name = req.Name.Trim(), Order = order };
            await db.Sections.InsertOneAsync(section);
            return Results.Created($"/api/sections/{section.Id}", section);
        });

        group.MapPut("/{id}", async (string id, SectionWriteRequest req, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var update = Builders<Section>.Update
                .Set(s => s.Name, req.Name.Trim())
                .Set(s => s.ProjectId, req.ProjectId);
            if (req.Order is int order) update = update.Set(s => s.Order, order);

            var section = await db.Sections.FindOneAndUpdateAsync(
                s => s.Id == id, update, new FindOneAndUpdateOptions<Section> { ReturnDocument = ReturnDocument.After });
            return section is null ? Results.NotFound() : Results.Ok(section);
        });

        group.MapDelete("/{id}", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var result = await db.Sections.DeleteOneAsync(s => s.Id == id);
            if (result.DeletedCount == 0) return Results.NotFound();

            // Tasks in the section are kept and moved to the project root rather than destroyed.
            await db.Tasks.UpdateManyAsync(t => t.SectionId == id, Builders<TodoTask>.Update.Set(t => t.SectionId, null));
            return Results.NoContent();
        });

        return app;
    }

    private static async Task<Dictionary<string, string[]>> ValidateAsync(SectionWriteRequest req, MongoContext db)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Name)) errors["name"] = ["Name is required."];
        if (!MongoContext.IsValidId(req.ProjectId) || !await db.Projects.Find(p => p.Id == req.ProjectId).AnyAsync())
            errors["projectId"] = ["Project does not exist."];
        return errors;
    }

    private static async Task<int> NextOrderAsync(MongoContext db, string projectId)
    {
        var last = await db.Sections.Find(s => s.ProjectId == projectId).SortByDescending(s => s.Order).Limit(1).FirstOrDefaultAsync();
        return last is null ? 0 : last.Order + 1;
    }
}
