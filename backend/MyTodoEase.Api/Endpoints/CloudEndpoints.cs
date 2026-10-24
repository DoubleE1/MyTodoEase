using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Endpoints;

/// <summary>
/// Cloud sync for the desktop app.
///
/// Sign-in: Firebase's Google popup cannot run inside Electron, so the renderer asks this API for a loopback page
/// (<c>/api/auth/firebase/page</c>) and opens it in the system browser. The page loads the Firebase SDK, signs the
/// user in with Google, and posts the resulting Google ID token back here (same origin, so no CORS or mixed
/// content). The renderer polls for it and finishes with <c>signInWithCredential</c>; <c>localhost</c> is one of
/// Firebase's default authorized domains, so no console changes are needed.
///
/// Session: afterwards the renderer shares the Firebase refresh token (<c>PUT /api/cloud/session</c>) so this API
/// can read and write the same Firestore data for the MCP server and Google Calendar sync.
/// </summary>
public static class CloudEndpoints
{
    private static readonly TimeSpan PendingTtl = TimeSpan.FromMinutes(10);
    private static readonly ConcurrentDictionary<string, PendingSignIn> Pending = new();

    public sealed record FirebaseWebConfig(string ApiKey, string AuthDomain, string ProjectId, string AppId);

    public sealed record CallbackRequest(string State, string IdToken, string? Email);

    public sealed record SessionRequest(string ProjectId, string ApiKey, string Uid, string? Email, string? Name, string RefreshToken);

    private sealed class PendingSignIn(FirebaseWebConfig config)
    {
        public FirebaseWebConfig Config { get; } = config;
        public DateTime ExpiresAt { get; } = DateTime.UtcNow + PendingTtl;
        public string? IdToken { get; set; }
        public string? Email { get; set; }
    }

    public static IEndpointRouteBuilder MapCloud(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth/firebase").WithTags("Auth");

        // Step 1 (renderer): register a sign-in attempt and get the page to open in the browser.
        auth.MapPost("/start", (FirebaseWebConfig config, HttpRequest http) =>
        {
            if (string.IsNullOrWhiteSpace(config.ApiKey) || string.IsNullOrWhiteSpace(config.AuthDomain) ||
                string.IsNullOrWhiteSpace(config.ProjectId) || string.IsNullOrWhiteSpace(config.AppId))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["config"] = ["Firebase web config is incomplete."] });

            PruneExpired();
            var state = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            Pending[state] = new PendingSignIn(config);
            // "localhost" (not 127.0.0.1) is the origin Firebase authorizes by default.
            var port = http.Host.Port ?? 5080;
            return Results.Ok(new { state, url = $"http://localhost:{port}/api/auth/firebase/page?state={Uri.EscapeDataString(state)}" });
        });

        // Step 2 (browser): the page that runs the Firebase Google popup.
        auth.MapGet("/page", (string? state) =>
        {
            if (string.IsNullOrEmpty(state) || !Pending.TryGetValue(state, out var pending) || pending.ExpiresAt < DateTime.UtcNow)
                return AuthEndpoints.Page("Sign-in expired", "This sign-in link is no longer valid. Start again from Settings in TodoEase.", false);
            return Results.Content(SignInPage(state, pending.Config), "text/html; charset=utf-8");
        });

        // Step 3 (browser): the page hands over the Google ID token Firebase just verified.
        auth.MapPost("/callback", (CallbackRequest req) =>
        {
            if (string.IsNullOrEmpty(req.State) || !Pending.TryGetValue(req.State, out var pending) || pending.ExpiresAt < DateTime.UtcNow)
                return Results.Problem("This sign-in attempt has expired. Start again from Settings in TodoEase.", statusCode: StatusCodes.Status400BadRequest);
            if (string.IsNullOrWhiteSpace(req.IdToken))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["idToken"] = ["Missing id token."] });
            pending.IdToken = req.IdToken;
            pending.Email = req.Email;
            return Results.NoContent();
        });

        // Step 4 (renderer): collect the token once; 204 while the browser is still working, 404 when expired or cancelled.
        auth.MapGet("/pending/{state}", (string state) =>
        {
            PruneExpired();
            if (!Pending.TryGetValue(state, out var pending)) return Results.NotFound();
            if (pending.IdToken is null) return Results.NoContent();
            Pending.TryRemove(state, out _);
            return Results.Ok(new { idToken = pending.IdToken, email = pending.Email });
        });

        auth.MapPost("/cancel", () =>
        {
            Pending.Clear();
            return Results.NoContent();
        });

        var cloud = app.MapGroup("/api/cloud").WithTags("Cloud");

        cloud.MapGet("/session", (CloudSessionService session) => Results.Ok(session.GetStatus()));

        // The renderer shares its Firebase session so MCP and Calendar sync read the same cloud data.
        cloud.MapPut("/session", (SessionRequest req, CloudSessionService session, CalendarSyncService sync) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(req.ProjectId)) errors["projectId"] = ["Project id is required."];
            if (string.IsNullOrWhiteSpace(req.ApiKey)) errors["apiKey"] = ["API key is required."];
            if (string.IsNullOrWhiteSpace(req.Uid)) errors["uid"] = ["User id is required."];
            if (string.IsNullOrWhiteSpace(req.RefreshToken)) errors["refreshToken"] = ["Refresh token is required."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var before = session.GetStatus();
            session.Set(new CloudSessionService.SessionInput(req.ProjectId, req.ApiKey, req.Uid, req.Email, req.Name, req.RefreshToken));
            // The mirror now reflects the cloud data: reconcile once (an unchanged session is a no-op push).
            if (!before.Active || before.Uid != req.Uid) sync.EnqueueFull();
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

    private static void PruneExpired()
    {
        var now = DateTime.UtcNow;
        foreach (var (key, value) in Pending)
        {
            if (value.ExpiresAt < now) Pending.TryRemove(key, out _);
        }
    }

    /// <summary>Firebase SDK version to load from Google's CDN; kept in step with frontend/package.json.</summary>
    private const string FirebaseJsVersion = "13.1.0";

    private static string SignInPage(string state, FirebaseWebConfig config)
    {
        var configJson = JsonSerializer.Serialize(new
        {
            apiKey = config.ApiKey,
            authDomain = config.AuthDomain,
            projectId = config.ProjectId,
            appId = config.AppId,
        });
        var stateJson = JsonSerializer.Serialize(state);
        return $$"""
            <!doctype html>
            <html lang="en"><head><meta charset="utf-8"><title>Sign in · TodoEase</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a1e; color: #e8e8e8; display: grid; place-items: center; min-height: 100vh; margin: 0; }
              main { max-width: 420px; padding: 32px; border-radius: 16px; background: #262630; text-align: center; }
              h1 { font-size: 20px; margin: 0 0 12px; }
              p { line-height: 1.5; margin: 0 0 16px; color: #c8c8d0; }
              button { font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 10px; border: 1px solid #3a3a46; background: #fff; color: #202020; cursor: pointer; display: inline-flex; gap: 10px; align-items: center; }
              button:disabled { opacity: .6; cursor: default; }
              .ok { color: #16a34a; } .err { color: #f87171; }
              .hidden { display: none; }
            </style></head>
            <body><main>
              <h1 id="title">Sign in to TodoEase</h1>
              <p id="message">Choose the Google account whose tasks you want to use on this PC. Your tasks sync to every device signed in with it.</p>
              <button id="go" type="button">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
                <span>Continue with Google</span>
              </button>
            </main>
            <script type="module">
              import { initializeApp } from "https://www.gstatic.com/firebasejs/{{FirebaseJsVersion}}/firebase-app.js";
              import { getAuth, GoogleAuthProvider, signInWithPopup, setPersistence, inMemoryPersistence } from "https://www.gstatic.com/firebasejs/{{FirebaseJsVersion}}/firebase-auth.js";
              const state = {{stateJson}};
              const app = initializeApp({{configJson}});
              const auth = getAuth(app);
              const title = document.getElementById('title');
              const message = document.getElementById('message');
              const button = document.getElementById('go');
              const done = (ok, heading, text) => {
                title.textContent = heading;
                title.className = ok ? 'ok' : 'err';
                message.textContent = text;
                button.classList.toggle('hidden', ok);
                button.disabled = false;
              };
              button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                  // Nothing stays signed in inside this browser tab; the desktop app keeps its own session.
                  await setPersistence(auth, inMemoryPersistence);
                  const provider = new GoogleAuthProvider();
                  provider.setCustomParameters({ prompt: 'select_account' });
                  const result = await signInWithPopup(auth, provider);
                  const credential = GoogleAuthProvider.credentialFromResult(result);
                  if (!credential?.idToken) throw new Error('Google did not return an ID token.');
                  const response = await fetch('/api/auth/firebase/callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state, idToken: credential.idToken, email: result.user.email }),
                  });
                  if (!response.ok) throw new Error('TodoEase did not accept the sign-in (' + response.status + '). Start again from Settings.');
                  await auth.signOut();
                  done(true, 'Signed in', 'TodoEase on this PC now uses the tasks of ' + (result.user.email || 'your Google account') + '. You can close this tab.');
                } catch (error) {
                  const code = error?.code || '';
                  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
                    button.disabled = false;
                    return;
                  }
                  const text = code === 'auth/popup-blocked'
                    ? 'Your browser blocked the Google sign-in window. Allow pop-ups for localhost and try again.'
                    : (error?.message || String(error)) + ' You can try again or close this tab.';
                  done(false, 'Sign-in failed', text);
                }
              });
            </script>
            </body></html>
            """;
    }
}
