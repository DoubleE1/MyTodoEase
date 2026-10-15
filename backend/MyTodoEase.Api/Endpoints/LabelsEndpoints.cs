using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class LabelsEndpoints
{
    public static IEndpointRouteBuilder MapLabels(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/labels").WithTags("Labels");

        group.MapGet("/", (AppDb db) =>
            Results.Ok(db.Labels.FindAll().OrderBy(l => l.Order).ThenBy(l => l.Name).ToList()));

        group.MapPost("/", (LabelWriteRequest req, AppDb db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var name = req.Name.Trim();
            var all = db.Labels.FindAll().ToList();
            var existing = all.FirstOrDefault(l => string.Equals(l.Name, name, StringComparison.OrdinalIgnoreCase));
            if (existing is not null) return Results.Ok(existing); // idempotent: labels are unique by name

            var last = all.MaxBy(l => l.Order);
            var label = new Label
            {
                Id = AppDb.NewId(),
                Name = name,
                Color = req.Color ?? "grey",
                Order = req.Order ?? (last is null ? 0 : last.Order + 1),
            };
            db.Labels.Insert(label);
            return Results.Created($"/api/labels/{label.Id}", label);
        });

        group.MapPut("/{id}", (string id, LabelWriteRequest req, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var label = db.Labels.FindById(id);
            if (label is null) return Results.NotFound();

            label.Name = req.Name.Trim();
            label.Color = req.Color ?? "grey";
            if (req.Order is int order) label.Order = order;
            db.Labels.Update(label);
            return Results.Ok(label);
        });

        group.MapDelete("/{id}", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (!db.Labels.Delete(id)) return Results.NotFound();

            // Array membership is filtered in memory: the data set is one user's tasks.
            foreach (var task in db.Tasks.FindAll().Where(t => t.LabelIds.Contains(id)).ToList())
            {
                task.LabelIds.Remove(id);
                db.Tasks.Update(task);
            }
            return Results.NoContent();
        });

        return app;
    }
}
