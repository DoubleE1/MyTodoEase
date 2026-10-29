using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class NotesEndpoints
{
    /// <summary>Partial update: a null field is left as it is.</summary>
    public sealed record NoteWriteRequest(string? Text, string? Color, int? Order, bool? IsArchived, List<string>? TaskIds, double? X = null, double? Y = null);

    public sealed record NoteOrder(string Id, int Order);

    public sealed record NoteReorderRequest(List<NoteOrder>? Items);

    public static IEndpointRouteBuilder MapNotes(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/notes").WithTags("Notes");

        // Board order: lowest Order first (new notes get the lowest), then newest.
        group.MapGet("/", async (IDataStore store, CancellationToken ct) =>
            Results.Ok((await store.Notes.AllAsync(ct)).OrderBy(n => n.Order).ThenByDescending(n => n.CreatedAt).ToList()));

        group.MapPost("/", async (NoteWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            var errors = Validate(req);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var all = await store.Notes.AllAsync(ct);
            var now = DateTime.UtcNow;
            var note = new Note
            {
                Id = AppDb.NewId(),
                Text = req.Text ?? "",
                Color = req.Color ?? "yellow",
                // New notes go to the front of the board.
                Order = req.Order ?? (all.Count == 0 ? 0 : all.Min(n => n.Order) - 1),
                IsArchived = req.IsArchived ?? false,
                TaskIds = req.TaskIds?.Distinct().ToList() ?? [],
                X = req.X,
                Y = req.Y,
                CreatedAt = now,
                UpdatedAt = now,
            };
            await store.Notes.UpsertAsync(note, ct);
            return Results.Created($"/api/notes/{note.Id}", note);
        });

        group.MapPut("/{id}", async (string id, NoteWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var errors = Validate(req);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var note = await store.Notes.GetAsync(id, ct);
            if (note is null) return Results.NotFound();

            if (req.Text is not null) note.Text = req.Text;
            if (req.Color is not null) note.Color = req.Color;
            if (req.Order is int order) note.Order = order;
            if (req.IsArchived is bool archived) note.IsArchived = archived;
            if (req.TaskIds is not null) note.TaskIds = req.TaskIds.Distinct().ToList();
            if (req.X is double x) note.X = x;
            if (req.Y is double y) note.Y = y;
            // Moving a note is not an edit of its content: "edited 2 minutes ago" keeps meaning the text.
            if (req.Text is not null || req.Color is not null) note.UpdatedAt = DateTime.UtcNow;
            await store.Notes.UpsertAsync(note, ct);
            return Results.Ok(note);
        });

        group.MapDelete("/{id}", async (string id, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (await store.Notes.GetAsync(id, ct) is null) return Results.NotFound();
            await store.Notes.DeleteAsync(id, ct);
            return Results.NoContent();
        });

        group.MapPost("/reorder", async (NoteReorderRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (req.Items is null || req.Items.Count == 0) return Results.NoContent();
            var orders = req.Items.Where(i => AppDb.IsValidId(i.Id)).ToDictionary(i => i.Id, i => i.Order);
            var changed = (await store.Notes.AllAsync(ct)).Where(n => orders.ContainsKey(n.Id)).ToList();
            foreach (var note in changed) note.Order = orders[note.Id];
            await store.Notes.UpsertManyAsync(changed, ct);
            return Results.NoContent();
        });

        return app;
    }

    private static Dictionary<string, string[]> Validate(NoteWriteRequest req)
    {
        var errors = new Dictionary<string, string[]>();
        if (req.Text is { Length: > Note.MaxTextLength })
            errors["text"] = [$"A note can hold at most {Note.MaxTextLength} characters."];
        if (req.Color is not null && !Note.Colors.Contains(req.Color))
            errors["color"] = [$"Color must be one of: {string.Join(", ", Note.Colors)}."];
        if (req.TaskIds is not null && (req.TaskIds.Count > 100 || req.TaskIds.Any(id => !AppDb.IsValidId(id))))
            errors["taskIds"] = ["Task ids must be valid, at most 100."];
        if (req.X is < 0 or > 100000 || req.Y is < 0 or > 100000 || req.X is double.NaN || req.Y is double.NaN)
            errors["position"] = ["Position must be between 0 and 100000."];
        return errors;
    }
}
