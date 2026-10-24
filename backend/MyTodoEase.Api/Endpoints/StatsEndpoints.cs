using System.Globalization;
using MyTodoEase.Api.Data;

namespace MyTodoEase.Api.Endpoints;

public static class StatsEndpoints
{
    public sealed record CompletionItem(string TaskId, string Content, string ProjectId, DateTime CompletedAt);

    public sealed record CompletionsResponse(List<int> Years, List<CompletionItem> Items);

    public static IEndpointRouteBuilder MapStats(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stats").WithTags("Stats");

        // Completion history for a calendar-date range. Dates are the client's local days, so the UTC window is
        // widened by 14 hours on each side; the client buckets by its own local date.
        group.MapGet("/completions", async (string? from, string? to, IDataStore store, CancellationToken ct) =>
        {
            if (!TryParseDate(from, out var fromDate) || !TryParseDate(to, out var toDate) || toDate < fromDate)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["range"] = ["from and to must be yyyy-MM-dd with to on or after from."],
                });

            var start = fromDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddHours(-14);
            var end = toDate.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc).AddHours(14);

            var all = await store.Completions.AllAsync(ct);
            var items = all
                .Where(c => c.CompletedAt >= start && c.CompletedAt <= end)
                .OrderBy(c => c.CompletedAt)
                .Select(c => new CompletionItem(c.TaskId, c.Content, c.ProjectId, c.CompletedAt))
                .ToList();

            var first = all.MinBy(c => c.CompletedAt);
            var years = new List<int>();
            if (first is not null)
            {
                for (var y = first.CompletedAt.Year; y <= DateTime.UtcNow.Year; y++) years.Add(y);
            }
            return Results.Ok(new CompletionsResponse(years, items));
        });

        return app;
    }

    private static bool TryParseDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
}
