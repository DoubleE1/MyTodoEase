using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class LabelsEndpoints
{
    public static IEndpointRouteBuilder MapLabels(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/labels").WithTags("Labels");

        group.MapGet("/", async (IDataStore store, CancellationToken ct) =>
            Results.Ok((await store.Labels.AllAsync(ct)).OrderBy(l => l.Order).ThenBy(l => l.Name).ToList()));

        group.MapPost("/", async (LabelWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var name = req.Name.Trim();
            var all = await store.Labels.AllAsync(ct);
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
            await store.Labels.UpsertAsync(label, ct);
            return Results.Created($"/api/labels/{label.Id}", label);
        });

        group.MapPut("/{id}", async (string id, LabelWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name is required."] });

            var label = await store.Labels.GetAsync(id, ct);
            if (label is null) return Results.NotFound();

            label.Name = req.Name.Trim();
            label.Color = req.Color ?? "grey";
            if (req.Order is int order) label.Order = order;
            await store.Labels.UpsertAsync(label, ct);
            return Results.Ok(label);
        });

        group.MapDelete("/{id}", async (string id, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (await store.Labels.GetAsync(id, ct) is null) return Results.NotFound();
            await store.Labels.DeleteAsync(id, ct);

            // Array membership is filtered in memory: the data set is one user's tasks.
            var tagged = (await store.Tasks.AllAsync(ct)).Where(t => t.LabelIds.Contains(id)).ToList();
            foreach (var task in tagged) task.LabelIds.Remove(id);
            await store.Tasks.UpsertManyAsync(tagged, ct);
            return Results.NoContent();
        });

        return app;
    }
}
