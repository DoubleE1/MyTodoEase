using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyTodoEase.Api.Services;

/// <summary>Thin REST client for the Google Calendar API v3, authenticated through GoogleAuthService.</summary>
public sealed class GoogleCalendarClient
{
    public const string Scope = "https://www.googleapis.com/auth/calendar";
    private const string BaseUrl = "https://www.googleapis.com/calendar/v3";

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly GoogleAuthService _auth;
    private readonly IHttpClientFactory _http;

    public GoogleCalendarClient(GoogleAuthService auth, IHttpClientFactory http)
    {
        _auth = auth;
        _http = http;
    }

    public bool HasScope() => _auth.GetStatus().Account?.Scopes.Contains(Scope) == true;

    // ----- Models (only the fields we use) -----

    public sealed record CalendarInfo(
        string Id,
        string Summary,
        string? BackgroundColor,
        bool Primary,
        string? AccessRole);

    public sealed class EventTime
    {
        public string? Date { get; set; }
        public string? DateTime { get; set; }
        public string? TimeZone { get; set; }
    }

    public sealed class ExtendedProperties
    {
        public Dictionary<string, string>? Private { get; set; }
    }

    public sealed class Reminders
    {
        public bool UseDefault { get; set; } = true;
    }

    public sealed class Event
    {
        public string? Id { get; set; }
        public string? Status { get; set; }
        public string? Summary { get; set; }
        public string? Description { get; set; }
        public string? Location { get; set; }
        public string? HtmlLink { get; set; }
        public EventTime? Start { get; set; }
        public EventTime? End { get; set; }
        public string[]? Recurrence { get; set; }
        public ExtendedProperties? ExtendedProperties { get; set; }
        public Reminders? Reminders { get; set; }
    }

    private sealed class CalendarListResponse
    {
        public List<CalendarListEntry> Items { get; set; } = [];
    }

    private sealed class CalendarListEntry
    {
        public string Id { get; set; } = "";
        public string Summary { get; set; } = "";
        public string? BackgroundColor { get; set; }
        public bool Primary { get; set; }
        public string? AccessRole { get; set; }
        public bool Deleted { get; set; }
    }

    private sealed class EventsResponse
    {
        public List<Event> Items { get; set; } = [];
        public string? NextPageToken { get; set; }
    }

    // ----- Calendars -----

    public async Task<List<CalendarInfo>> ListCalendarsAsync(CancellationToken ct)
    {
        var response = await SendAsync<CalendarListResponse>(HttpMethod.Get, "/users/me/calendarList?minAccessRole=reader&showHidden=false", null, ct);
        return response!.Items
            .Where(c => !c.Deleted)
            .Select(c => new CalendarInfo(c.Id, c.Summary, c.BackgroundColor, c.Primary, c.AccessRole))
            .ToList();
    }

    public async Task<CalendarInfo> CreateCalendarAsync(string summary, string? timeZone, CancellationToken ct)
    {
        var body = new Dictionary<string, object?> { ["summary"] = summary, ["timeZone"] = timeZone };
        var created = await SendAsync<CalendarListEntry>(HttpMethod.Post, "/calendars", body, ct);
        return new CalendarInfo(created!.Id, created.Summary, null, false, "owner");
    }

    public async Task<bool> CalendarExistsAsync(string calendarId, CancellationToken ct)
    {
        try
        {
            await SendAsync<CalendarListEntry>(HttpMethod.Get, $"/calendars/{Uri.EscapeDataString(calendarId)}", null, ct);
            return true;
        }
        catch (GoogleApiException ex) when (ex.Status is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            return false;
        }
    }

    // ----- Events -----

    public async Task<List<Event>> ListEventsAsync(string calendarId, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
    {
        var all = new List<Event>();
        string? pageToken = null;
        do
        {
            var query = $"singleEvents=true&orderBy=startTime&maxResults=2500" +
                        $"&timeMin={Uri.EscapeDataString(fromUtc.ToString("o"))}&timeMax={Uri.EscapeDataString(toUtc.ToString("o"))}" +
                        (pageToken is null ? "" : $"&pageToken={Uri.EscapeDataString(pageToken)}");
            var page = await SendAsync<EventsResponse>(HttpMethod.Get, $"/calendars/{Uri.EscapeDataString(calendarId)}/events?{query}", null, ct);
            all.AddRange(page!.Items.Where(e => e.Status != "cancelled"));
            pageToken = page.NextPageToken;
        } while (pageToken is not null);
        return all;
    }

    public Task<Event?> InsertEventAsync(string calendarId, Event body, CancellationToken ct) =>
        SendAsync<Event>(HttpMethod.Post, $"/calendars/{Uri.EscapeDataString(calendarId)}/events", body, ct);

    public Task<Event?> UpdateEventAsync(string calendarId, string eventId, Event body, CancellationToken ct) =>
        SendAsync<Event>(HttpMethod.Put, $"/calendars/{Uri.EscapeDataString(calendarId)}/events/{Uri.EscapeDataString(eventId)}", body, ct);

    /// <summary>Deletes an event; an event that is already gone counts as deleted.</summary>
    public async Task DeleteEventAsync(string calendarId, string eventId, CancellationToken ct)
    {
        try
        {
            await SendAsync<object>(HttpMethod.Delete, $"/calendars/{Uri.EscapeDataString(calendarId)}/events/{Uri.EscapeDataString(eventId)}", null, ct);
        }
        catch (GoogleApiException ex) when (ex.Status is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            // Already deleted on Google's side.
        }
    }

    // ----- HTTP -----

    public sealed class GoogleApiException(HttpStatusCode status, string message) : Exception(message)
    {
        public HttpStatusCode Status { get; } = status;
    }

    private async Task<T?> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct) where T : class
    {
        var token = await _auth.GetAccessTokenAsync(ct);
        using var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        using var request = new HttpRequestMessage(method, BaseUrl + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null)
            request.Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NoContent) return null;
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            string detail = text;
            try
            {
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.TryGetProperty("error", out var err) && err.TryGetProperty("message", out var msg))
                    detail = msg.GetString() ?? text;
            }
            catch
            {
                // keep raw text
            }
            throw new GoogleApiException(response.StatusCode, $"Google Calendar: {detail}");
        }
        return string.IsNullOrWhiteSpace(text) ? null : JsonSerializer.Deserialize<T>(text, Json);
    }
}
