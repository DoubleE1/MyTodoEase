using MongoDB.Driver;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class LabelsEndpoints
{
    public static IEndpointRouteBuilder MapLabels(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/labels").WithTags("Labels");

        group.MapGet("/", async (MongoContext db) =>
            Results.Ok(await db.Labels.Find(_ => true).SortBy(l => l.Order).ThenBy(l => l.Name).ToListAsync()));

        group.MapPost("/", async (LabelWriteRequest req, MongoContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var name = req.Name.Trim();
            var existing = await db.Labels
                .Find(Builders<Label>.Filter.Regex(l => l.Name, new MongoDB.Bson.BsonRegularExpression($"^{System.Text.RegularExpressions.Regex.Escape(name)}$", "i")))
                .FirstOrDefaultAsync();
            if (existing is not null) return Results.Ok(existing); // idempotent: labels are unique by name

            var last = await db.Labels.Find(_ => true).SortByDescending(l => l.Order).Limit(1).FirstOrDefaultAsync();
            var label = new Label { Name = name, Color = req.Color ?? "grey", Order = req.Order ?? (last is null ? 0 : last.Order + 1) };
            await db.Labels.InsertOneAsync(label);
            return Results.Created($"/api/labels/{label.Id}", label);
        });

        group.MapPut("/{id}", async (string id, LabelWriteRequest req, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var update = Builders<Label>.Update
                .Set(l => l.Name, req.Name.Trim())
                .Set(l => l.Color, req.Color ?? "grey");
            if (req.Order is int order) update = update.Set(l => l.Order, order);

            var label = await db.Labels.FindOneAndUpdateAsync(
                l => l.Id == id, update, new FindOneAndUpdateOptions<Label> { ReturnDocument = ReturnDocument.After });
            return label is null ? Results.NotFound() : Results.Ok(label);
        });

        group.MapDelete("/{id}", async (string id, MongoContext db) =>
        {
            if (!MongoContext.IsValidId(id)) return Results.NotFound();
            var result = await db.Labels.DeleteOneAsync(l => l.Id == id);
            if (result.DeletedCount == 0) return Results.NotFound();

            await db.Tasks.UpdateManyAsync(
                Builders<TodoTask>.Filter.AnyEq(t => t.LabelIds, id),
                Builders<TodoTask>.Update.Pull(t => t.LabelIds, id));
            return Results.NoContent();
        });

        return app;
    }
}
