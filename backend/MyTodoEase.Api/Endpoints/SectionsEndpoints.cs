using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class SectionsEndpoints
{
    public static IEndpointRouteBuilder MapSections(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sections").WithTags("Sections");

        group.MapGet("/", async (string? projectId, IDataStore store, CancellationToken ct) =>
        {
            var sections = await store.Sections.AllAsync(ct);
            if (projectId is not null) sections = sections.Where(s => s.ProjectId == projectId).ToList();
            return Results.Ok(sections.OrderBy(s => s.Order).ThenBy(s => s.CreatedAt).ToList());
        });

        group.MapPost("/", async (SectionWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            var errors = await ValidateAsync(req, store, ct);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var section = new Section
            {
                Id = AppDb.NewId(),
                ProjectId = req.ProjectId,
                Name = req.Name.Trim(),
                Order = req.Order ?? await NextOrderAsync(store, req.ProjectId, ct),
            };
            await store.Sections.UpsertAsync(section, ct);
            return Results.Created($"/api/sections/{section.Id}", section);
        });

        group.MapPut("/{id}", async (string id, SectionWriteRequest req, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var errors = await ValidateAsync(req, store, ct);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var section = await store.Sections.GetAsync(id, ct);
            if (section is null) return Results.NotFound();

            section.Name = req.Name.Trim();
            section.ProjectId = req.ProjectId;
            if (req.Order is int order) section.Order = order;
            await store.Sections.UpsertAsync(section, ct);
            return Results.Ok(section);
        });

        group.MapDelete("/{id}", async (string id, IDataStore store, CancellationToken ct) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (await store.Sections.GetAsync(id, ct) is null) return Results.NotFound();
            await store.Sections.DeleteAsync(id, ct);

            // Tasks in the section are kept and moved to the project root rather than destroyed.
            var orphans = (await store.Tasks.AllAsync(ct)).Where(t => t.SectionId == id).ToList();
            foreach (var task in orphans) task.SectionId = null;
            await store.Tasks.UpsertManyAsync(orphans, ct);
            return Results.NoContent();
        });

        return app;
    }

    private static async Task<Dictionary<string, string[]>> ValidateAsync(SectionWriteRequest req, IDataStore store, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Name)) errors["name"] = ["Name is required."];
        if (!AppDb.IsValidId(req.ProjectId) || await store.Projects.GetAsync(req.ProjectId, ct) is null)
            errors["projectId"] = ["Project does not exist."];
        return errors;
    }

    private static async Task<int> NextOrderAsync(IDataStore store, string projectId, CancellationToken ct)
    {
        var last = (await store.Sections.AllAsync(ct)).Where(s => s.ProjectId == projectId).MaxBy(s => s.Order);
        return last is null ? 0 : last.Order + 1;
    }
}
