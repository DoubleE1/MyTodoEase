using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Options;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Services;

/// <summary>
/// Two-way Google Calendar integration.
/// Push: every open task with a due date is mirrored as an event in a dedicated "MyTodoEase" calendar
/// (recurring tasks become recurring events). Pull: events from the calendars the user picked are
/// served to the UI for the Calendar, Today and Upcoming views. Pushes are queued per task and run on a
/// background worker, with a full reconcile on enable and every 15 minutes.
/// </summary>
public sealed class CalendarSyncService : BackgroundService
{
    private const string TargetCalendarName = "MyTodoEase";
    private static readonly TimeSpan FullSyncInterval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan EventsCacheTtl = TimeSpan.FromSeconds(60);

    private readonly AppDb _db;
    private readonly DataStoreProvider _stores;
    private readonly GoogleCalendarClient _google;
    private readonly ILogger<CalendarSyncService> _log;
    private readonly string _filePath;
    private readonly object _gate = new();
    private readonly Channel<string> _queue = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });
    private readonly Dictionary<string, (DateTime At, List<ExternalEvent> Events)> _eventsCache = new();
    private Settings _settings;
    private int _fullSyncRequested;

    public CalendarSyncService(AppDb db, DataStoreProvider stores, GoogleCalendarClient google, IOptions<StorageOptions> storage, ILogger<CalendarSyncService> log)
    {
        _db = db;
        _stores = stores;
        _google = google;
        _log = log;
        _filePath = Path.Combine(Path.GetDirectoryName(storage.Value.ResolvePath())!, "calendar-sync.json");
        _settings = Load();
    }

    // ----- Settings and status -----

    public sealed class Settings
    {
        public bool Enabled { get; set; }
        public string? TargetCalendarId { get; set; }
        /// <summary>Google calendars whose events are shown in the app. Empty = primary only.</summary>
        public List<string> SourceCalendarIds { get; set; } = [];
        public DateTime? LastSyncAt { get; set; }
        public string? LastError { get; set; }
    }

    public sealed record SyncStatus(
        bool ScopeGranted,
        bool Enabled,
        string? TargetCalendarId,
        List<string> SourceCalendarIds,
        DateTime? LastSyncAt,
        string? LastError,
        int LinkedTasks);

    public SyncStatus GetStatus()
    {
        lock (_gate)
        {
            return new SyncStatus(
                _google.HasScope(),
                _settings.Enabled,
                _settings.TargetCalendarId,
                _settings.SourceCalendarIds,
                _settings.LastSyncAt,
                _settings.LastError,
                _db.CalendarLinks.Count());
        }
    }

    public void UpdateSettings(bool? enabled, List<string>? sourceCalendarIds)
    {
        var requestFull = false;
        lock (_gate)
        {
            if (enabled is { } flag && flag != _settings.Enabled)
            {
                _settings.Enabled = flag;
                _settings.LastError = null;
                requestFull = flag;
            }
            if (sourceCalendarIds is not null)
            {
                _settings.SourceCalendarIds = sourceCalendarIds.Distinct().ToList();
                _eventsCache.Clear();
            }
            Save();
        }
        if (requestFull) EnqueueFull();
    }

    /// <summary>Turned off: remove the mirrored events so the Google calendar does not keep stale copies.</summary>
    public async Task DisableAndCleanAsync(CancellationToken ct)
    {
        List<CalendarLink> links;
        lock (_gate)
        {
            _settings.Enabled = false;
            Save();
            links = _db.CalendarLinks.FindAll().ToList();
        }
        foreach (var link in links)
        {
            try
            {
                await _google.DeleteEventAsync(link.CalendarId, link.EventId, ct);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not delete event {EventId}", link.EventId);
            }
            _db.CalendarLinks.Delete(link.Id);
        }
    }

    // ----- Queue -----

    /// <summary>Records a successful manual sync (the worker records its own).</summary>
    public void MarkSynced()
    {
        lock (_gate)
        {
            _settings.LastError = null;
            _settings.LastSyncAt = DateTime.UtcNow;
            Save();
        }
    }

    public void Enqueue(string taskId)
    {
        if (_settings.Enabled) _queue.Writer.TryWrite(taskId);
    }

    /// <summary>Tasks changed outside this API (the desktop renderer writing straight to Firestore, or another device).</summary>
    public void EnqueueMany(IEnumerable<string> taskIds)
    {
        if (!_settings.Enabled) return;
        foreach (var id in taskIds.Where(AppDb.IsValidId).Distinct()) _queue.Writer.TryWrite(id);
    }

    public void EnqueueFull()
    {
        Interlocked.Exchange(ref _fullSyncRequested, 1);
        _queue.Writer.TryWrite("*");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_settings.Enabled) EnqueueFull();
        using var timer = new PeriodicTimer(FullSyncInterval);
        var tick = Task.Run(async () =>
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                if (_settings.Enabled) EnqueueFull();
            }
        }, stoppingToken);

        await foreach (var taskId in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            if (!_settings.Enabled && taskId != "*") continue;
            try
            {
                if (taskId == "*" || Interlocked.Exchange(ref _fullSyncRequested, 0) == 1)
                {
                    if (_settings.Enabled) await FullSyncAsync(stoppingToken);
                }
                else
                {
                    await SyncTaskAsync(taskId, stoppingToken);
                }
                lock (_gate)
                {
                    _settings.LastError = null;
                    _settings.LastSyncAt = DateTime.UtcNow;
                    Save();
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Calendar sync failed for {TaskId}", taskId);
                lock (_gate)
                {
                    _settings.LastError = ex.Message;
                    Save();
                }
            }
        }
    }

    // ----- Push -----

    public async Task FullSyncAsync(CancellationToken ct)
    {
        if (!_google.HasScope()) throw new InvalidOperationException("Google Calendar permission has not been granted yet.");
        var calendarId = await EnsureTargetCalendarAsync(ct);

        // Current store: the LiteDB file, or Firestore while the app is signed in to the cloud.
        var tasks = (await _stores.Current.Tasks.AllAsync(ct)).Where(t => !t.IsCompleted && t.DueDate != null).ToList();
        var wanted = tasks.ToDictionary(t => t.Id);
        foreach (var task in tasks)
        {
            await PushAsync(task, calendarId, ct);
        }
        // Links for tasks that are gone, completed or undated: remove their events.
        foreach (var link in _db.CalendarLinks.FindAll().ToList())
        {
            if (wanted.ContainsKey(link.Id)) continue;
            await _google.DeleteEventAsync(link.CalendarId, link.EventId, ct);
            _db.CalendarLinks.Delete(link.Id);
        }
        _eventsCache.Clear();
    }

    private async Task SyncTaskAsync(string taskId, CancellationToken ct)
    {
        if (!_google.HasScope()) return;
        var calendarId = await EnsureTargetCalendarAsync(ct);
        var task = await _stores.Current.Tasks.GetAsync(taskId, ct);
        if (task is null || task.IsCompleted || task.DueDate is null)
        {
            var link = _db.CalendarLinks.FindById(taskId);
            if (link is not null)
            {
                await _google.DeleteEventAsync(link.CalendarId, link.EventId, ct);
                _db.CalendarLinks.Delete(taskId);
            }
            return;
        }
        await PushAsync(task, calendarId, ct);
    }

    private async Task PushAsync(TodoTask task, string calendarId, CancellationToken ct)
    {
        var body = ToEvent(task);
        var hash = Hash(body, calendarId);
        var link = _db.CalendarLinks.FindById(task.Id);
        if (link is not null && link.Hash == hash && link.CalendarId == calendarId) return;

        GoogleCalendarClient.Event? saved = null;
        if (link is not null && link.CalendarId == calendarId)
        {
            try
            {
                saved = await _google.UpdateEventAsync(calendarId, link.EventId, body, ct);
            }
            catch (GoogleCalendarClient.GoogleApiException ex) when (ex.Status is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Gone)
            {
                saved = null; // event deleted by the user in Google: recreate
            }
        }
        saved ??= await _google.InsertEventAsync(calendarId, body, ct);
        if (saved?.Id is null) throw new InvalidOperationException("Google did not return the saved event.");
        _db.CalendarLinks.Upsert(new CalendarLink { Id = task.Id, CalendarId = calendarId, EventId = saved.Id, Hash = hash, UpdatedAt = DateTime.UtcNow });
    }

    private async Task<string> EnsureTargetCalendarAsync(CancellationToken ct)
    {
        var current = _settings.TargetCalendarId;
        if (current is not null && await _google.CalendarExistsAsync(current, ct)) return current;

        // Reuse an existing "MyTodoEase" calendar (for example after a reinstall) before creating one.
        var existing = (await _google.ListCalendarsAsync(ct))
            .FirstOrDefault(c => c.Summary == TargetCalendarName && c.AccessRole == "owner");
        var id = existing?.Id ?? (await _google.CreateCalendarAsync(TargetCalendarName, LocalIanaTimeZone(), ct)).Id;
        lock (_gate)
        {
            _settings.TargetCalendarId = id;
            Save();
        }
        _db.CalendarLinks.DeleteAll(); // links pointed at a calendar that no longer exists
        return id;
    }

    private static GoogleCalendarClient.Event ToEvent(TodoTask task)
    {
        var due = DateOnly.ParseExact(task.DueDate!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var ev = new GoogleCalendarClient.Event
        {
            Summary = task.Content,
            Description = string.IsNullOrWhiteSpace(task.Description) ? "From MyTodoEase" : task.Description + "\n\nFrom MyTodoEase",
            ExtendedProperties = new GoogleCalendarClient.ExtendedProperties
            {
                Private = new Dictionary<string, string> { ["mytodoeaseTaskId"] = task.Id },
            },
            Reminders = new GoogleCalendarClient.Reminders { UseDefault = true },
        };
        if (task.DueTime is { } time && TimeOnly.TryParseExact(time, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t))
        {
            var start = due.ToDateTime(t, DateTimeKind.Unspecified);
            var zone = LocalIanaTimeZone();
            ev.Start = new GoogleCalendarClient.EventTime { DateTime = start.ToString("yyyy-MM-dd'T'HH:mm:ss"), TimeZone = zone };
            ev.End = new GoogleCalendarClient.EventTime { DateTime = start.AddMinutes(task.DurationMinutes ?? 30).ToString("yyyy-MM-dd'T'HH:mm:ss"), TimeZone = zone };
        }
        else
        {
            ev.Start = new GoogleCalendarClient.EventTime { Date = task.DueDate };
            ev.End = new GoogleCalendarClient.EventTime { Date = due.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        }
        var rule = task.Recurrence switch
        {
            Recurrence.Daily => "RRULE:FREQ=DAILY",
            Recurrence.Weekdays => "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
            Recurrence.Weekly => "RRULE:FREQ=WEEKLY",
            Recurrence.Biweekly => "RRULE:FREQ=WEEKLY;INTERVAL=2",
            Recurrence.Monthly => "RRULE:FREQ=MONTHLY",
            Recurrence.Yearly => "RRULE:FREQ=YEARLY",
            _ => null,
        };
        if (rule is not null) ev.Recurrence = [rule];
        return ev;
    }

    private static string Hash(GoogleCalendarClient.Event ev, string calendarId)
    {
        var text = string.Join('|', calendarId, ev.Summary, ev.Description, ev.Start?.Date, ev.Start?.DateTime, ev.End?.Date, ev.End?.DateTime, ev.Recurrence is null ? "" : string.Join(',', ev.Recurrence));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    }

    public static string LocalIanaTimeZone()
    {
        var local = TimeZoneInfo.Local;
        if (local.HasIanaId) return local.Id;
        return TimeZoneInfo.TryConvertWindowsIdToIanaId(local.Id, out var iana) ? iana : "UTC";
    }

    // ----- Pull -----

    public sealed record ExternalEvent(
        string Id,
        string CalendarId,
        string CalendarName,
        string? Color,
        string Title,
        string? Location,
        /// <summary>yyyy-MM-dd of the (local) day the event starts.</summary>
        string Date,
        /// <summary>yyyy-MM-dd of the last (local) day the event covers.</summary>
        string EndDate,
        /// <summary>HH:mm local start time, or null for all-day events.</summary>
        string? StartTime,
        string? EndTime,
        bool AllDay,
        string? HtmlLink);

    /// <summary>Events from the chosen Google calendars whose days intersect [from, to] (local calendar dates).</summary>
    public async Task<List<ExternalEvent>> GetEventsAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (!_google.HasScope()) return [];
        var key = $"{from:yyyy-MM-dd}|{to:yyyy-MM-dd}";
        lock (_gate)
        {
            if (_eventsCache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < EventsCacheTtl) return hit.Events;
        }

        var calendars = await _google.ListCalendarsAsync(ct);
        var target = _settings.TargetCalendarId;
        var chosen = _settings.SourceCalendarIds.Count == 0
            ? calendars.Where(c => c.Primary).ToList()
            : calendars.Where(c => _settings.SourceCalendarIds.Contains(c.Id)).ToList();
        chosen = chosen.Where(c => c.Id != target).ToList();

        var zone = TimeZoneInfo.Local;
        var fromUtc = TimeZoneInfo.ConvertTimeToUtc(from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified), zone);
        var toUtc = TimeZoneInfo.ConvertTimeToUtc(to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified), zone);

        var result = new List<ExternalEvent>();
        foreach (var calendar in chosen)
        {
            foreach (var ev in await _google.ListEventsAsync(calendar.Id, fromUtc, toUtc, ct))
            {
                if (ev.Id is null || ev.Start is null) continue;
                if (ev.ExtendedProperties?.Private?.ContainsKey("mytodoeaseTaskId") == true) continue; // our own mirror
                var mapped = Map(ev, calendar, zone);
                if (mapped is not null) result.Add(mapped);
            }
        }
        result = result.OrderBy(e => e.Date).ThenBy(e => e.StartTime ?? "").ToList();
        lock (_gate)
        {
            _eventsCache[key] = (DateTime.UtcNow, result);
        }
        return result;
    }

    private static ExternalEvent? Map(GoogleCalendarClient.Event ev, GoogleCalendarClient.CalendarInfo calendar, TimeZoneInfo zone)
    {
        var title = string.IsNullOrWhiteSpace(ev.Summary) ? "(No title)" : ev.Summary!;
        if (ev.Start?.Date is { } startDate)
        {
            // All-day: end date is exclusive in Google's model.
            var endDate = ev.End?.Date is { } e ? DateOnly.ParseExact(e, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : startDate;
            return new ExternalEvent(ev.Id!, calendar.Id, calendar.Summary, calendar.BackgroundColor, title, ev.Location, startDate, endDate, null, null, true, ev.HtmlLink);
        }
        if (ev.Start?.DateTime is { } startIso && DateTimeOffset.TryParse(startIso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var startOffset))
        {
            var startLocal = TimeZoneInfo.ConvertTime(startOffset, zone);
            var endLocal = ev.End?.DateTime is { } endIso && DateTimeOffset.TryParse(endIso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var endOffset)
                ? TimeZoneInfo.ConvertTime(endOffset, zone)
                : startLocal.AddMinutes(30);
            return new ExternalEvent(
                ev.Id!, calendar.Id, calendar.Summary, calendar.BackgroundColor, title, ev.Location,
                startLocal.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                endLocal.AddSeconds(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                startLocal.ToString("HH:mm", CultureInfo.InvariantCulture),
                endLocal.ToString("HH:mm", CultureInfo.InvariantCulture),
                false,
                ev.HtmlLink);
        }
        return null;
    }

    public Task<List<GoogleCalendarClient.CalendarInfo>> ListCalendarsAsync(CancellationToken ct) => _google.ListCalendarsAsync(ct);

    // ----- Storage -----

    private Settings Load()
    {
        try
        {
            if (File.Exists(_filePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(_filePath)) ?? new Settings();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not read {File}; calendar sync starts disabled.", _filePath);
        }
        return new Settings();
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        File.WriteAllText(_filePath, JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true }));
    }
}
