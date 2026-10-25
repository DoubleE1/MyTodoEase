using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Endpoints;

/// <summary>
/// Cloud session shared by the desktop renderer. The renderer signs into Firebase itself, with the ID token of the
/// Google sign-in that <see cref="AuthEndpoints"/> runs, and then hands this API the Firebase refresh token, so the
/// API can read and write the same Firestore data for the MCP server, and upload its Google Calendar permission
/// for the cloud-side calendar sync.
/// </summary>
public static class CloudEndpoints
{
    public sealed record SessionRequest(string ProjectId, string ApiKey, string Uid, string? Email, string? Name, string RefreshToken);

    public static IEndpointRouteBuilder MapCloud(this IEndpointRouteBuilder app)
    {
        var cloud = app.MapGroup("/api/cloud").WithTags("Cloud");

        cloud.MapGet("/session", (CloudSessionService session) => Results.Ok(session.GetStatus()));

        cloud.MapPut("/session", async (SessionRequest req, CloudSessionService session, CalendarSyncService sync, CloudCalendarBridge bridge, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(req.ProjectId)) errors["projectId"] = ["Project id is required."];
            if (string.IsNullOrWhiteSpace(req.ApiKey)) errors["apiKey"] = ["API key is required."];
            if (string.IsNullOrWhiteSpace(req.Uid)) errors["uid"] = ["User id is required."];
            if (string.IsNullOrWhiteSpace(req.RefreshToken)) errors["refreshToken"] = ["Refresh token is required."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var before = session.GetStatus();
            session.Set(new CloudSessionService.SessionInput(req.ProjectId, req.ApiKey, req.Uid, req.Email, req.Name, req.RefreshToken));
            // The cloud sync owns the calendar from here: hand it this PC's Google permission (if any) and clear the
            // events the local mirror created for the local tasks.
            await bridge.UploadConnectionAsync(ct);
            if (!before.Active || before.Uid != req.Uid) sync.OnCloudSessionStarted();
            return Results.Ok(session.GetStatus());
        });

        cloud.MapDelete("/session", (CloudSessionService session, CalendarSyncService sync) =>
        {
            var wasActive = session.IsActive;
            session.Clear();
            if (wasActive) sync.EnqueueFull(); // back to mirroring the local file
            return Results.Ok(session.GetStatus());
        });

        return app;
    }
}
