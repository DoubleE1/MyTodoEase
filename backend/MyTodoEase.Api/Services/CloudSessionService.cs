using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using MyTodoEase.Api.Data;

namespace MyTodoEase.Api.Services;

/// <summary>
/// The Firebase session the desktop app shares with this API after the user signs in with Google.
/// The renderer owns the sign-in (Firebase JS SDK) and hands over the Firebase refresh token, the project id
/// and the public web API key; from those this API mints short-lived ID tokens to call Firestore on behalf of
/// the user (for the MCP server and Google Calendar sync), under the same security rules as the apps.
/// Stored in cloud-session.json next to the database, refresh token protected with Windows DPAPI.
/// </summary>
public sealed class CloudSessionService
{
    private const string SecureTokenEndpoint = "https://securetoken.googleapis.com/v1/token";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MyTodoEase.CloudSession.v1");

    private readonly IHttpClientFactory _http;
    private readonly ILogger<CloudSessionService> _log;
    private readonly string _filePath;
    private readonly object _gate = new();
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private Stored? _session;
    private (string Token, DateTime ExpiresAt)? _idToken;
    private string? _lastError;

    public CloudSessionService(IOptions<StorageOptions> storage, IHttpClientFactory http, ILogger<CloudSessionService> log)
    {
        _http = http;
        _log = log;
        _filePath = Path.Combine(Path.GetDirectoryName(storage.Value.ResolvePath())!, "cloud-session.json");
        _session = Load();
    }

    public sealed record Status(bool Active, string? ProjectId, string? Uid, string? Email, string? Name, DateTime? ConnectedAt, string? LastError);

    public sealed record SessionInput(string ProjectId, string ApiKey, string Uid, string? Email, string? Name, string RefreshToken);

    /// <summary>Raised when a session exists but Firebase refuses to refresh it (revoked, disabled, expired).</summary>
    public sealed class CloudSessionException(string message) : Exception(message);

    public bool IsActive
    {
        get { lock (_gate) return _session is not null; }
    }

    public Status GetStatus()
    {
        lock (_gate)
        {
            return _session is { } s
                ? new Status(true, s.ProjectId, s.Uid, s.Email, s.Name, s.ConnectedAt, _lastError)
                : new Status(false, null, null, null, null, null, null);
        }
    }

    public (string ProjectId, string Uid) Target
    {
        get
        {
            lock (_gate)
            {
                if (_session is not { } s) throw new CloudSessionException("No cloud session: sign in to Google in the MyTodoEase app.");
                return (s.ProjectId, s.Uid);
            }
        }
    }

    public void Set(SessionInput input)
    {
        lock (_gate)
        {
            _session = new Stored
            {
                ProjectId = input.ProjectId.Trim(),
                ApiKey = input.ApiKey.Trim(),
                Uid = input.Uid.Trim(),
                Email = input.Email,
                Name = input.Name,
                RefreshTokenProtected = Protect(input.RefreshToken.Trim()),
                ConnectedAt = DateTime.UtcNow,
            };
            _idToken = null;
            _lastError = null;
            Save();
        }
        _log.LogInformation("Cloud session set for {Email} ({Uid}) in project {Project}", input.Email, input.Uid, input.ProjectId);
    }

    public void Clear()
    {
        lock (_gate)
        {
            _session = null;
            _idToken = null;
            _lastError = null;
            try
            {
                if (File.Exists(_filePath)) File.Delete(_filePath);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not delete {File}", _filePath);
            }
        }
        _log.LogInformation("Cloud session cleared; back to local storage.");
    }

    /// <summary>A valid Firebase ID token for Firestore calls, refreshed through the Secure Token API when needed.</summary>
    public async Task<string> GetIdTokenAsync(CancellationToken ct)
    {
        lock (_gate)
        {
            if (_idToken is { } cached && cached.ExpiresAt > DateTime.UtcNow) return cached.Token;
        }
        await _refreshLock.WaitAsync(ct);
        try
        {
            string apiKey, refresh;
            lock (_gate)
            {
                if (_idToken is { } cached && cached.ExpiresAt > DateTime.UtcNow) return cached.Token;
                if (_session is not { } s) throw new CloudSessionException("No cloud session: sign in to Google in the MyTodoEase app.");
                apiKey = s.ApiKey;
                refresh = Unprotect(s.RefreshTokenProtected);
            }

            using var client = _http.CreateClient();
            using var response = await client.PostAsync(
                $"{SecureTokenEndpoint}?key={Uri.EscapeDataString(apiKey)}",
                new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "refresh_token", ["refresh_token"] = refresh }),
                ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
            {
                var detail = ExtractError(body);
                lock (_gate) _lastError = detail;
                _log.LogWarning("Firebase refused to refresh the cloud session: {Detail}", detail);
                throw new CloudSessionException($"The cloud session is no longer valid ({detail}). Sign in again in the MyTodoEase app.");
            }
            var tokens = JsonSerializer.Deserialize<RefreshResponse>(body) ?? throw new CloudSessionException("Empty token response from Firebase.");
            lock (_gate)
            {
                var ttl = int.TryParse(tokens.ExpiresIn, out var seconds) ? seconds : 3600;
                _idToken = (tokens.IdToken, DateTime.UtcNow.AddSeconds(Math.Max(60, ttl - 60)));
                _lastError = null;
                // Firebase may rotate the refresh token; keep whatever it handed back.
                if (_session is { } s && !string.IsNullOrEmpty(tokens.RefreshToken) && tokens.RefreshToken != refresh)
                {
                    s.RefreshTokenProtected = Protect(tokens.RefreshToken);
                    Save();
                }
                return tokens.IdToken;
            }
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private static string ExtractError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var error) && error.TryGetProperty("message", out var message))
                return message.GetString() ?? body;
        }
        catch
        {
            // Not JSON.
        }
        return body;
    }

    private sealed record RefreshResponse(
        [property: JsonPropertyName("id_token")] string IdToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] string? ExpiresIn);

    private sealed class Stored
    {
        public string ProjectId { get; set; } = "";
        public string ApiKey { get; set; } = "";
        public string Uid { get; set; } = "";
        public string? Email { get; set; }
        public string? Name { get; set; }
        public string RefreshTokenProtected { get; set; } = "";
        public DateTime ConnectedAt { get; set; }
    }

    private Stored? Load()
    {
        try
        {
            if (!File.Exists(_filePath)) return null;
            var stored = JsonSerializer.Deserialize<Stored>(File.ReadAllText(_filePath));
            if (stored is null || string.IsNullOrEmpty(stored.Uid) || string.IsNullOrEmpty(stored.RefreshTokenProtected)) return null;
            _log.LogInformation("Cloud session restored for {Email}; data is read from Firestore project {Project}.", stored.Email, stored.ProjectId);
            return stored;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not read {File}; starting in local mode.", _filePath);
            return null;
        }
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        File.WriteAllText(_filePath, JsonSerializer.Serialize(_session, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static string Protect(string plain)
    {
        var bytes = Encoding.UTF8.GetBytes(plain);
        if (OperatingSystem.IsWindows())
            return "dpapi:" + Convert.ToBase64String(ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser));
        return "plain:" + Convert.ToBase64String(bytes);
    }

    private static string Unprotect(string stored)
    {
        if (stored.StartsWith("dpapi:", StringComparison.Ordinal) && OperatingSystem.IsWindows())
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored[6..]), Entropy, DataProtectionScope.CurrentUser));
        if (stored.StartsWith("plain:", StringComparison.Ordinal))
            return Encoding.UTF8.GetString(Convert.FromBase64String(stored[6..]));
        throw new InvalidOperationException("Stored secret is in an unknown format.");
    }
}
