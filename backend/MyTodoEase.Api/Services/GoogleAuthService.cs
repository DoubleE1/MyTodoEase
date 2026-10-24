using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using MyTodoEase.Api.Data;

namespace MyTodoEase.Api.Services;

/// <summary>
/// "Sign in with Google" for a desktop app: OAuth 2.0 authorization code flow with PKCE and a
/// loopback redirect back into this API. The refresh token (and the OAuth client secret) are kept
/// in google-auth.json next to the database, protected with Windows DPAPI for the current user.
/// Identity scopes only for now; features that need Gmail ask for their scopes incrementally.
/// </summary>
public sealed class GoogleAuthService
{
    public static readonly string[] DefaultScopes = ["openid", "email", "profile"];

    private const string AuthEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string RevokeEndpoint = "https://oauth2.googleapis.com/revoke";
    private const string UserInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
    private static readonly TimeSpan PendingTtl = TimeSpan.FromMinutes(10);
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MyTodoEase.GoogleAuth.v1");

    private readonly IHttpClientFactory _http;
    private readonly ILogger<GoogleAuthService> _log;
    private readonly string _filePath;
    private readonly object _gate = new();
    private readonly ConcurrentDictionary<string, PendingLogin> _pending = new();
    private StoredState _state;
    private (string Token, DateTime ExpiresAt)? _accessToken;

    private readonly IConfiguration _config;

    public GoogleAuthService(IOptions<StorageOptions> storage, IConfiguration config, IHttpClientFactory http, ILogger<GoogleAuthService> log)
    {
        _http = http;
        _log = log;
        _config = config;
        _filePath = Path.Combine(Path.GetDirectoryName(storage.Value.ResolvePath())!, "google-auth.json");
        _state = Load();
    }

    // ----- Status and configuration -----

    public sealed record AccountInfo(string Email, string Name, string? Picture, string[] Scopes, DateTime ConnectedAt);

    public sealed record Status(bool Configured, string? ClientId, bool SignedIn, AccountInfo? Account, bool Pending);

    public Status GetStatus()
    {
        lock (_gate)
        {
            PruneExpired();
            var account = _state.Account is { } a
                ? new AccountInfo(a.Email, a.Name, a.Picture, a.Scopes, a.ConnectedAt)
                : null;
            return new Status(!string.IsNullOrWhiteSpace(_state.ClientId), _state.ClientId, account is not null, account, !_pending.IsEmpty);
        }
    }

    public void SetClient(string clientId, string? clientSecret)
    {
        lock (_gate)
        {
            _state.ClientId = clientId.Trim();
            _state.ClientSecretProtected = string.IsNullOrWhiteSpace(clientSecret) ? null : Protect(clientSecret.Trim());
            Save();
        }
    }

    // ----- Sign-in flow -----

    /// <summary>Builds the Google consent URL for the given scopes; the API keeps the PKCE verifier until the callback.</summary>
    public string BeginLogin(string redirectUri, IEnumerable<string>? scopes)
    {
        if (string.IsNullOrWhiteSpace(_state.ClientId))
            throw new InvalidOperationException("Google sign-in is not configured: set the OAuth client id first.");

        PruneExpired();
        var state = RandomToken(24);
        var verifier = RandomToken(64);
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var requested = DefaultScopes.Union(scopes ?? [], StringComparer.Ordinal).ToArray();
        _pending[state] = new PendingLogin(verifier, redirectUri, requested, DateTime.UtcNow + PendingTtl);

        var query = new Dictionary<string, string>
        {
            ["client_id"] = _state.ClientId!,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = string.Join(' ', requested),
            ["state"] = state,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["include_granted_scopes"] = "true",
        };
        if (_state.Account is { } existing) query["login_hint"] = existing.Email;
        return AuthEndpoint + "?" + string.Join('&', query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
    }

    /// <summary>Exchanges the code from Google's redirect for tokens and stores the signed-in account.</summary>
    public async Task<AccountInfo> CompleteLoginAsync(string code, string state, CancellationToken ct)
    {
        if (!_pending.TryRemove(state, out var pending) || pending.ExpiresAt < DateTime.UtcNow)
            throw new InvalidOperationException("This sign-in attempt has expired or was already used. Start again from Settings.");

        var form = new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = _state.ClientId!,
            ["redirect_uri"] = pending.RedirectUri,
            ["grant_type"] = "authorization_code",
            ["code_verifier"] = pending.Verifier,
        };
        if (ClientSecret() is { } secret) form["client_secret"] = secret;

        var tokens = await PostTokenAsync(form, ct);
        if (string.IsNullOrEmpty(tokens.RefreshToken))
            throw new InvalidOperationException("Google did not return a refresh token. Remove TodoEase from your Google account's third-party access list and sign in again.");

        var profile = await GetUserInfoAsync(tokens.AccessToken, ct);
        var grantedScopes = (tokens.Scope ?? string.Join(' ', pending.Scopes)).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        lock (_gate)
        {
            _state.Account = new StoredAccount
            {
                Email = profile.Email,
                Name = profile.Name ?? profile.Email,
                Picture = profile.Picture,
                RefreshTokenProtected = Protect(tokens.RefreshToken),
                Scopes = grantedScopes,
                ConnectedAt = DateTime.UtcNow,
            };
            _accessToken = (tokens.AccessToken, DateTime.UtcNow.AddSeconds(Math.Max(60, tokens.ExpiresIn - 60)));
            Save();
        }
        _log.LogInformation("Google account connected: {Email}", profile.Email);
        return new AccountInfo(profile.Email, profile.Name ?? profile.Email, profile.Picture, grantedScopes, DateTime.UtcNow);
    }

    public void CancelPending() => _pending.Clear();

    /// <summary>Revokes the refresh token at Google (best effort) and forgets the account.</summary>
    public async Task SignOutAsync(CancellationToken ct)
    {
        string? refresh;
        lock (_gate)
        {
            refresh = _state.Account?.RefreshTokenProtected is { } p ? Unprotect(p) : null;
            _state.Account = null;
            _accessToken = null;
            Save();
        }
        if (refresh is null) return;
        try
        {
            using var client = _http.CreateClient();
            using var response = await client.PostAsync(
                RevokeEndpoint,
                new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = refresh }),
                ct);
            _log.LogInformation("Google token revoked: {Status}", response.StatusCode);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not revoke the Google token; the account was forgotten locally anyway.");
        }
    }

    /// <summary>A valid access token for Google APIs, refreshed when needed. For features such as Gmail.</summary>
    public async Task<string> GetAccessTokenAsync(CancellationToken ct)
    {
        lock (_gate)
        {
            if (_accessToken is { } cached && cached.ExpiresAt > DateTime.UtcNow) return cached.Token;
        }
        var refresh = _state.Account?.RefreshTokenProtected is { } p ? Unprotect(p) : null;
        if (refresh is null) throw new InvalidOperationException("No Google account is signed in.");

        var form = new Dictionary<string, string>
        {
            ["client_id"] = _state.ClientId!,
            ["refresh_token"] = refresh,
            ["grant_type"] = "refresh_token",
        };
        if (ClientSecret() is { } secret) form["client_secret"] = secret;
        var tokens = await PostTokenAsync(form, ct);
        lock (_gate)
        {
            _accessToken = (tokens.AccessToken, DateTime.UtcNow.AddSeconds(Math.Max(60, tokens.ExpiresIn - 60)));
        }
        return tokens.AccessToken;
    }

    // ----- Google HTTP -----

    private sealed record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("scope")] string? Scope);

    private sealed record UserInfo(
        [property: JsonPropertyName("email")] string Email,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("picture")] string? Picture);

    private async Task<TokenResponse> PostTokenAsync(Dictionary<string, string> form, CancellationToken ct)
    {
        using var client = _http.CreateClient();
        using var response = await client.PostAsync(TokenEndpoint, new FormUrlEncodedContent(form), ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            string detail;
            try
            {
                using var doc = JsonDocument.Parse(body);
                detail = doc.RootElement.TryGetProperty("error_description", out var d) ? d.GetString() ?? body
                    : doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() ?? body : body;
            }
            catch
            {
                detail = body;
            }
            throw new InvalidOperationException($"Google rejected the token request: {detail}");
        }
        return JsonSerializer.Deserialize<TokenResponse>(body) ?? throw new InvalidOperationException("Empty token response from Google.");
    }

    private async Task<UserInfo> GetUserInfoAsync(string accessToken, CancellationToken ct)
    {
        using var client = _http.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await client.GetAsync(UserInfoEndpoint, ct);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<UserInfo>(body) ?? throw new InvalidOperationException("Empty profile response from Google.");
    }

    // ----- Storage -----

    private sealed class StoredAccount
    {
        public string Email { get; set; } = "";
        public string Name { get; set; } = "";
        public string? Picture { get; set; }
        public string RefreshTokenProtected { get; set; } = "";
        public string[] Scopes { get; set; } = [];
        public DateTime ConnectedAt { get; set; }
    }

    private sealed class StoredState
    {
        public string? ClientId { get; set; }
        public string? ClientSecretProtected { get; set; }
        public StoredAccount? Account { get; set; }
    }

    private sealed record PendingLogin(string Verifier, string RedirectUri, string[] Scopes, DateTime ExpiresAt);

    private StoredState Load()
    {
        try
        {
            if (File.Exists(_filePath))
                return JsonSerializer.Deserialize<StoredState>(File.ReadAllText(_filePath)) ?? new StoredState();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not read {File}; starting without a Google account.", _filePath);
        }
        // No client saved from the UI: fall back to the one that ships with the app.
        var state = new StoredState();
        var shipped = BuiltInClient();
        if (shipped is { } client)
        {
            state.ClientId = client.Id;
            state.ClientSecretProtected = client.Key is null ? null : Protect(client.Key);
        }
        return state;
    }

    /// <summary>
    /// The OAuth client bundled with the app, in priority order: environment variables, the
    /// google-client.json downloaded from Google Cloud and placed next to the API, or appsettings
    /// (Google:ClientId / Google:ClientSecret). Google documents a desktop client's key as non-confidential,
    /// so bundling it is the standard approach for installed apps.
    /// </summary>
    private (string Id, string? Key)? BuiltInClient()
    {
        var envId = Environment.GetEnvironmentVariable("MYTODOEASE_GOOGLE_CLIENT_ID");
        if (!string.IsNullOrWhiteSpace(envId))
            return (envId.Trim(), Environment.GetEnvironmentVariable("MYTODOEASE_GOOGLE_CLIENT_SECRET")?.Trim());

        var jsonPath = Path.Combine(AppContext.BaseDirectory, "google-client.json");
        if (File.Exists(jsonPath))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                var root = doc.RootElement;
                if (root.TryGetProperty("installed", out var installed)) root = installed;
                var id = root.TryGetProperty("client_id", out var idProp) ? idProp.GetString() : null;
                var key = root.TryGetProperty("client_secret", out var keyProp) ? keyProp.GetString() : null;
                if (!string.IsNullOrWhiteSpace(id)) return (id.Trim(), key?.Trim());
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not read {File}.", jsonPath);
            }
        }

        var configId = _config["Google:ClientId"];
        return string.IsNullOrWhiteSpace(configId) ? null : (configId.Trim(), _config["Google:ClientSecret"]?.Trim());
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        File.WriteAllText(_filePath, JsonSerializer.Serialize(_state, new JsonSerializerOptions { WriteIndented = true }));
    }

    private string? ClientSecret() => _state.ClientSecretProtected is { } p ? Unprotect(p) : null;

    private void PruneExpired()
    {
        var now = DateTime.UtcNow;
        foreach (var (key, value) in _pending)
        {
            if (value.ExpiresAt < now) _pending.TryRemove(key, out _);
        }
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

    private static string RandomToken(int bytes) => Base64Url(RandomNumberGenerator.GetBytes(bytes));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
