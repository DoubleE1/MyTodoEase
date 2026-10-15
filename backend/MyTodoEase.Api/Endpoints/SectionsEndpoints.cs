using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Endpoints;

public static class SectionsEndpoints
{
    public static IEndpointRouteBuilder MapSections(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sections").WithTags("Sections");

        group.MapGet("/", (string? projectId, AppDb db) =>
        {
            var sections = projectId is null ? db.Sections.FindAll() : db.Sections.Find(s => s.ProjectId == projectId);
            return Results.Ok(sections.OrderBy(s => s.Order).ThenBy(s => s.CreatedAt).ToList());
        });

        group.MapPost("/", (SectionWriteRequest req, AppDb db) =>
        {
            var errors = Validate(req, db);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var section = new Section
            {
                Id = AppDb.NewId(),
                ProjectId = req.ProjectId,
                Name = req.Name.Trim(),
                Order = req.Order ?? NextOrder(db, req.ProjectId),
            };
            db.Sections.Insert(section);
            return Results.Created($"/api/sections/{section.Id}", section);
        });

        group.MapPut("/{id}", (string id, SectionWriteRequest req, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            var errors = Validate(req, db);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var section = db.Sections.FindById(id);
            if (section is null) return Results.NotFound();

            section.Name = req.Name.Trim();
            section.ProjectId = req.ProjectId;
            if (req.Order is int order) section.Order = order;
            db.Sections.Update(section);
            return Results.Ok(section);
        });

        group.MapDelete("/{id}", (string id, AppDb db) =>
        {
            if (!AppDb.IsValidId(id)) return Results.NotFound();
            if (!db.Sections.Delete(id)) return Results.NotFound();

            // Tasks in the section are kept and moved to the project root rather than destroyed.
            foreach (var task in db.Tasks.Find(t => t.SectionId == id).ToList())
            {
                task.SectionId = null;
                db.Tasks.Update(task);
            }
            return Results.NoContent();
        });

        return app;
    }

    private static Dictionary<string, string[]> Validate(SectionWriteRequest req, AppDb db)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Name)) errors["name"] = ["Name is required."];
        if (!AppDb.IsValidId(req.ProjectId) || db.Projects.FindById(req.ProjectId) is null)
            errors["projectId"] = ["Project does not exist."];
        return errors;
    }

    private static int NextOrder(AppDb db, string projectId)
    {
        var last = db.Sections.Find(s => s.ProjectId == projectId).MaxBy(s => s.Order);
        return last is null ? 0 : last.Order + 1;
    }
}
