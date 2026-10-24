using System.Net;
using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Endpoints;

public static class AuthEndpoints
{
    public sealed record ClientConfigRequest(string ClientId, string? ClientSecret);

    public sealed record StartRequest(string[]? Scopes);

    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth/google").WithTags("Auth");

        group.MapGet("/", (GoogleAuthService auth) => Results.Ok(auth.GetStatus()));

        group.MapPut("/config", (ClientConfigRequest req, GoogleAuthService auth) =>
        {
            if (string.IsNullOrWhiteSpace(req.ClientId))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["clientId"] = ["Client id is required."] });
            auth.SetClient(req.ClientId, req.ClientSecret);
            return Results.Ok(auth.GetStatus());
        });

        // Returns the Google consent URL; the client opens it in the system browser. Google redirects
        // back to this API on the loopback address (the only redirect a desktop OAuth client allows).
        group.MapPost("/start", (StartRequest? req, HttpRequest http, GoogleAuthService auth) =>
        {
            var port = http.Host.Port ?? 5080;
            var redirectUri = $"http://127.0.0.1:{port}/api/auth/google/callback";
            try
            {
                return Results.Ok(new { url = auth.BeginLogin(redirectUri, req?.Scopes) });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status400BadRequest);
            }
        });

        group.MapGet("/callback", async (string? code, string? state, string? error, GoogleAuthService auth, CancellationToken ct) =>
        {
            if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            {
                auth.CancelPending();
                return Page("Sign-in cancelled", $"Google reported: {WebUtility.HtmlEncode(error ?? "missing code")}. You can close this tab and try again from TodoEase.", false);
            }
            try
            {
                var account = await auth.CompleteLoginAsync(code, state, ct);
                return Page("Signed in", $"TodoEase is now connected to <strong>{WebUtility.HtmlEncode(account.Email)}</strong>. You can close this tab.", true);
            }
            catch (Exception ex)
            {
                return Page("Sign-in failed", WebUtility.HtmlEncode(ex.Message) + " You can close this tab and try again from TodoEase.", false);
            }
        });

        // One-time pickup of the Google ID token from the last sign-in: the renderer opens the matching Firebase
        // session with it (signInWithCredential), so one consent screen covers cloud sync and the calendar.
        group.MapGet("/id-token", (GoogleAuthService auth) =>
            auth.TakeIdToken() is { } token ? Results.Ok(new { idToken = token }) : Results.NoContent());

        group.MapPost("/cancel", (GoogleAuthService auth) =>
        {
            auth.CancelPending();
            return Results.NoContent();
        });

        group.MapDelete("/", async (GoogleAuthService auth, CancellationToken ct) =>
        {
            await auth.SignOutAsync(ct);
            return Results.Ok(auth.GetStatus());
        });

        return app;
    }

    internal static IResult Page(string title, string message, bool ok)
    {
        var color = ok ? "#16a34a" : "#dc2626";
        var html = $$"""
            <!doctype html>
            <html lang="en"><head><meta charset="utf-8"><title>{{title}} · TodoEase</title>
            <style>
              body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a1e; color: #e8e8e8; display: grid; place-items: center; min-height: 100vh; margin: 0; }
              main { max-width: 420px; padding: 32px; border-radius: 16px; background: #262630; text-align: center; }
              h1 { font-size: 20px; margin: 0 0 12px; color: {{color}}; }
              p { line-height: 1.5; margin: 0; }
            </style></head>
            <body><main><h1>{{title}}</h1><p>{{message}}</p></main></body></html>
            """;
        return Results.Content(html, "text/html; charset=utf-8");
    }
}
