using System.Globalization;
using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Endpoints;

public static class CalendarEndpoints
{
    public sealed record SyncSettingsRequest(bool? Enabled, List<string>? SourceCalendarIds);

    public sealed record ChangedRequest(List<string>? TaskIds);

    public static IEndpointRouteBuilder MapCalendar(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/calendar").WithTags("Calendar");

        group.MapGet("/sync", (CalendarSyncService sync) => Results.Ok(sync.GetStatus()));

        group.MapPut("/sync", async (SyncSettingsRequest req, CalendarSyncService sync, GoogleCalendarClient google, CancellationToken ct) =>
        {
            if (req.Enabled == true && !google.HasScope())
                return Results.Problem("Grant Google Calendar access first.", statusCode: StatusCodes.Status400BadRequest);
            if (req.Enabled == false && sync.GetStatus().Enabled)
                await sync.DisableAndCleanAsync(ct);
            sync.UpdateSettings(req.Enabled, req.SourceCalendarIds);
            return Results.Ok(sync.GetStatus());
        });

        group.MapPost("/sync/run", async (CalendarSyncService sync, CancellationToken ct) =>
        {
            try
            {
                await sync.FullSyncAsync(ct);
                sync.MarkSynced();
                return Results.Ok(sync.GetStatus());
            }
            catch (Exception ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Change feed from the desktop renderer: in cloud mode it writes to Firestore directly (and hears other
        // devices' writes), so it tells this API which tasks changed and the mirror pushes them right away.
        group.MapPost("/changed", (ChangedRequest req, CalendarSyncService sync) =>
        {
            if (req.TaskIds is { Count: > 0 }) sync.EnqueueMany(req.TaskIds);
            return Results.NoContent();
        });

        group.MapGet("/calendars", async (CalendarSyncService sync, GoogleCalendarClient google, CancellationToken ct) =>
        {
            if (!google.HasScope()) return Results.Ok(Array.Empty<GoogleCalendarClient.CalendarInfo>());
            try
            {
                return Results.Ok(await sync.ListCalendarsAsync(ct));
            }
            catch (Exception ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Google events for a range of local calendar dates (inclusive); events the app mirrored itself are left out.
        group.MapGet("/events", async (string? from, string? to, CalendarSyncService sync, CancellationToken ct) =>
        {
            if (!TryParse(from, out var fromDate) || !TryParse(to, out var toDate) || toDate < fromDate || toDate.DayNumber - fromDate.DayNumber > 120)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["range"] = ["from and to must be yyyy-MM-dd, at most 120 days apart."],
                });
            try
            {
                return Results.Ok(await sync.GetEventsAsync(fromDate, toDate, ct));
            }
            catch (Exception ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        return app;
    }

    private static bool TryParse(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
}
