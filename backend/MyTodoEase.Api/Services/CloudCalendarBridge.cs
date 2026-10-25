using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace MyTodoEase.Api.Services;

/// <summary>
/// Hands the Google Calendar permission this PC obtained over to the cloud. While the desktop app is signed in,
/// Google Calendar sync for the account runs in the Cloud Functions (so it is the same on the web and on every
/// device, and keeps running while no app is open). The functions need a refresh token: this uploads the one the
/// local API holds, together with the desktop OAuth client that issued it (a refresh token only works with its
/// own client; Google documents an installed app's client secret as non-confidential), to
/// users/{uid}/private/googleCalendar, a document the Firestore rules let the user write but never read.
/// </summary>
public sealed class CloudCalendarBridge
{
    private const string FirestoreBase = "https://firestore.googleapis.com/v1/";
    /// <summary>Must match setGlobalOptions in functions/src/index.ts.</summary>
    private const string FunctionsRegion = "asia-southeast1";

    private readonly CloudSessionService _session;
    private readonly GoogleAuthService _google;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<CloudCalendarBridge> _log;

    public CloudCalendarBridge(CloudSessionService session, GoogleAuthService google, IHttpClientFactory http, ILogger<CloudCalendarBridge> log)
    {
        _session = session;
        _google = google;
        _http = http;
        _log = log;
    }

    /// <summary>
    /// Uploads the calendar permission when there is one and a cloud session is active; a no-op otherwise.
    /// Never throws: the app keeps working, and the next sign-in or session share tries again.
    /// </summary>
    public async Task<bool> UploadConnectionAsync(CancellationToken ct)
    {
        if (!_session.IsActive || !_google.HasScope(GoogleCalendarClient.Scope)) return false;
        var connection = _google.ExportConnection();
        if (connection is null) return false;
        try
        {
            var (projectId, uid) = _session.Target;
            var fields = new JsonObject
            {
                ["provider"] = Str("google"),
                ["refreshToken"] = Str(connection.RefreshToken),
                ["client"] = Str("desktop"),
                ["clientId"] = Str(connection.ClientId),
                ["clientSecret"] = connection.ClientSecret is null ? new JsonObject { ["nullValue"] = null } : Str(connection.ClientSecret),
                ["email"] = Str(connection.Account.Email),
                ["name"] = Str(connection.Account.Name),
                ["picture"] = connection.Account.Picture is null ? new JsonObject { ["nullValue"] = null } : Str(connection.Account.Picture),
                ["scopes"] = new JsonObject
                {
                    ["arrayValue"] = new JsonObject { ["values"] = new JsonArray(connection.Account.Scopes.Select(s => (JsonNode)Str(s)).ToArray()) },
                },
                ["connectedAt"] = Str(connection.Account.ConnectedAt.ToString("o")),
            };
            var url = $"{FirestoreBase}projects/{Uri.EscapeDataString(projectId)}/databases/(default)/documents/users/{Uri.EscapeDataString(uid)}/private/googleCalendar";
            using var client = await ClientAsync(ct);
            using var content = new StringContent(new JsonObject { ["fields"] = fields }.ToJsonString(), Encoding.UTF8, "application/json");
            using var response = await client.PatchAsync(url, content, ct);
            if (!response.IsSuccessStatusCode)
            {
                _log.LogWarning("Could not upload the Google Calendar permission to the cloud: {Status} {Body}", (int)response.StatusCode, await response.Content.ReadAsStringAsync(ct));
                return false;
            }
            _log.LogInformation("Google Calendar permission for {Email} uploaded; the cloud sync takes over.", connection.Account.Email);
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not upload the Google Calendar permission to the cloud.");
            return false;
        }
    }

    private async Task<HttpClient> ClientAsync(CancellationToken ct)
    {
        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await _session.GetIdTokenAsync(ct));
        return client;
    }

    private static JsonObject Str(string value) => new() { ["stringValue"] = value };

    /// <summary>The https callable endpoint of a Cloud Function in this project (for the API's own use).</summary>
    public string FunctionUrl(string name)
    {
        var (projectId, _) = _session.Target;
        return $"https://{FunctionsRegion}-{projectId}.cloudfunctions.net/{name}";
    }
}
