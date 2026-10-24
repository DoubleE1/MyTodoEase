using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using MyTodoEase.Api.Models;
using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Data;

/// <summary>
/// Cloud mode: the user's Firestore tree (users/{uid}/{projects,sections,labels,tasks,completions}) through the
/// Firestore REST API, authenticated with the Firebase ID token of the signed-in user, so the same security rules
/// apply as in the apps. Documents keep the exact camelCase JSON shape the API serves, which is also what the
/// web app and the desktop renderer write, so every client reads every other client's rows.
/// One instance serves one request: whole-collection reads are memoised until this instance writes to them.
/// </summary>
public sealed class FirestoreStore : IDataStore
{
    private const string ApiBase = "https://firestore.googleapis.com/v1/";
    private const int BatchLimit = 400; // Firestore allows 500 writes per commit; leave headroom.

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly CloudSessionService _session;
    private readonly IHttpClientFactory _http;
    /// <summary>projects/{p}/databases/(default)/documents/users/{uid}</summary>
    private readonly string _userPath;

    public FirestoreStore(CloudSessionService session, IHttpClientFactory http)
    {
        _session = session;
        _http = http;
        var (projectId, uid) = session.Target;
        _userPath = $"projects/{Uri.EscapeDataString(projectId)}/databases/(default)/documents/users/{Uri.EscapeDataString(uid)}";
        Projects = new Repo<Project>(this, "projects");
        Sections = new Repo<Section>(this, "sections");
        Labels = new Repo<Label>(this, "labels");
        Tasks = new Repo<TodoTask>(this, "tasks");
        Completions = new Repo<Completion>(this, "completions");
    }

    public string Description
    {
        get
        {
            var status = _session.GetStatus();
            return $"Firebase project {status.ProjectId} (synced to {status.Email ?? "your Google account"})";
        }
    }

    public bool IsCloud => true;
    public IRepository<Project> Projects { get; }
    public IRepository<Section> Sections { get; }
    public IRepository<Label> Labels { get; }
    public IRepository<TodoTask> Tasks { get; }
    public IRepository<Completion> Completions { get; }

    public async Task ReplaceAllAsync(
        IEnumerable<Project> projects,
        IEnumerable<Section> sections,
        IEnumerable<Label> labels,
        IEnumerable<TodoTask> tasks,
        IEnumerable<Completion> completions,
        CancellationToken ct = default)
    {
        var deletes = new List<JsonObject>();
        foreach (var collection in new[] { "projects", "sections", "labels", "tasks", "completions" })
        {
            foreach (var doc in await ListDocumentsAsync(collection, ct))
                deletes.Add(new JsonObject { ["delete"] = doc["name"]!.GetValue<string>() });
        }
        await CommitAsync(deletes, ct);

        var writes = new List<JsonObject>();
        writes.AddRange(projects.Select(p => UpdateWrite("projects", p)));
        writes.AddRange(sections.Select(s => UpdateWrite("sections", s)));
        writes.AddRange(labels.Select(l => UpdateWrite("labels", l)));
        writes.AddRange(tasks.Select(t => UpdateWrite("tasks", t)));
        writes.AddRange(completions.Select(c => UpdateWrite("completions", c)));
        await CommitAsync(writes, ct);
        InvalidateAll();
    }

    private void InvalidateAll()
    {
        ((Repo<Project>)Projects).Invalidate();
        ((Repo<Section>)Sections).Invalidate();
        ((Repo<Label>)Labels).Invalidate();
        ((Repo<TodoTask>)Tasks).Invalidate();
        ((Repo<Completion>)Completions).Invalidate();
    }

    // ----- HTTP -----

    private async Task<HttpClient> ClientAsync(CancellationToken ct)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await _session.GetIdTokenAsync(ct));
        return client;
    }

    private static async Task<JsonNode?> ReadAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var body = await response.Content.ReadAsStringAsync(ct);
        if (response.IsSuccessStatusCode) return string.IsNullOrWhiteSpace(body) ? null : JsonNode.Parse(body);
        var detail = body;
        try
        {
            detail = JsonNode.Parse(body)?["error"]?["message"]?.GetValue<string>() ?? body;
        }
        catch
        {
            // Not JSON.
        }
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new CloudSessionService.CloudSessionException($"Firestore refused the request: {detail}. Sign in again in the MyTodoEase app.");
        throw new InvalidOperationException($"Firestore returned {(int)response.StatusCode}: {detail}");
    }

    private async Task<List<JsonObject>> ListDocumentsAsync(string collection, CancellationToken ct)
    {
        using var client = await ClientAsync(ct);
        var documents = new List<JsonObject>();
        string? pageToken = null;
        do
        {
            var url = $"{ApiBase}{_userPath}/{collection}?pageSize=300" + (pageToken is null ? "" : $"&pageToken={Uri.EscapeDataString(pageToken)}");
            using var response = await client.GetAsync(url, ct);
            var page = await ReadAsync(response, ct) as JsonObject;
            if (page?["documents"] is JsonArray docs) documents.AddRange(docs.OfType<JsonObject>());
            pageToken = page?["nextPageToken"]?.GetValue<string>();
        } while (!string.IsNullOrEmpty(pageToken));
        return documents;
    }

    private async Task CommitAsync(List<JsonObject> writes, CancellationToken ct)
    {
        if (writes.Count == 0) return;
        using var client = await ClientAsync(ct);
        var database = _userPath[.._userPath.IndexOf("/documents/", StringComparison.Ordinal)];
        var commitUrl = $"{ApiBase}{database}/documents:commit";
        for (var start = 0; start < writes.Count; start += BatchLimit)
        {
            var batch = new JsonArray(writes.Skip(start).Take(BatchLimit).Select(w => (JsonNode)w.DeepClone()).ToArray());
            var body = new JsonObject { ["writes"] = batch };
            using var content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(commitUrl, content, ct);
            await ReadAsync(response, ct);
        }
    }

    private string DocumentName(string collection, string id) => $"{_userPath}/{collection}/{id}";

    private JsonObject UpdateWrite<T>(string collection, T item) where T : class =>
        new() { ["update"] = new JsonObject { ["name"] = DocumentName(collection, IdOf(item)), ["fields"] = ToFields(item) } };

    private static string IdOf<T>(T item) => item switch
    {
        Project p => p.Id,
        Section s => s.Id,
        Label l => l.Id,
        TodoTask t => t.Id,
        Completion c => c.Id,
        _ => throw new ArgumentException($"Unsupported row type {typeof(T).Name}"),
    };

    // ----- Value mapping: model <-> Firestore typed values -----

    private static JsonObject ToFields<T>(T item)
    {
        var element = JsonSerializer.SerializeToElement(item, Json);
        var fields = new JsonObject();
        foreach (var property in element.EnumerateObject()) fields[property.Name] = ToValue(property.Value);
        return fields;
    }

    private static JsonObject ToValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => new JsonObject { ["stringValue"] = element.GetString() },
        JsonValueKind.Number when element.TryGetInt64(out var l) => new JsonObject { ["integerValue"] = l.ToString() },
        JsonValueKind.Number => new JsonObject { ["doubleValue"] = element.GetDouble() },
        JsonValueKind.True => new JsonObject { ["booleanValue"] = true },
        JsonValueKind.False => new JsonObject { ["booleanValue"] = false },
        JsonValueKind.Array => new JsonObject
        {
            ["arrayValue"] = new JsonObject { ["values"] = new JsonArray(element.EnumerateArray().Select(e => (JsonNode)ToValue(e)).ToArray()) },
        },
        JsonValueKind.Object => new JsonObject
        {
            ["mapValue"] = new JsonObject { ["fields"] = new JsonObject(element.EnumerateObject().Select(p => KeyValuePair.Create(p.Name, (JsonNode?)ToValue(p.Value)))) },
        },
        _ => new JsonObject { ["nullValue"] = null },
    };

    private static JsonNode? FromValue(JsonObject value)
    {
        if (value.ContainsKey("stringValue")) return value["stringValue"]?.DeepClone();
        if (value.ContainsKey("integerValue"))
        {
            // The REST API encodes 64-bit integers as strings.
            var raw = value["integerValue"];
            return raw is JsonValue v && v.TryGetValue<string>(out var s) ? long.Parse(s) : raw?.DeepClone();
        }
        if (value.ContainsKey("doubleValue")) return value["doubleValue"]?.DeepClone();
        if (value.ContainsKey("booleanValue")) return value["booleanValue"]?.DeepClone();
        if (value.ContainsKey("timestampValue")) return value["timestampValue"]?.DeepClone();
        if (value.ContainsKey("arrayValue"))
        {
            var items = value["arrayValue"]?["values"] as JsonArray;
            return new JsonArray((items ?? []).OfType<JsonObject>().Select(FromValue).ToArray());
        }
        if (value.ContainsKey("mapValue"))
        {
            return FromFields(value["mapValue"]?["fields"] as JsonObject ?? []);
        }
        return null; // nullValue or unknown
    }

    private static JsonObject FromFields(JsonObject fields)
    {
        var result = new JsonObject();
        foreach (var (key, node) in fields) result[key] = node is JsonObject o ? FromValue(o) : null;
        return result;
    }

    private static T? FromDocument<T>(JsonObject document) where T : class
    {
        var fields = FromFields(document["fields"] as JsonObject ?? []);
        if (fields["id"] is null && document["name"]?.GetValue<string>() is { } name)
            fields["id"] = name[(name.LastIndexOf('/') + 1)..];
        return fields.Deserialize<T>(Json);
    }

    // ----- Repository -----

    private sealed class Repo<T>(FirestoreStore store, string collection) : IRepository<T> where T : class
    {
        private List<T>? _all;

        public void Invalidate() => _all = null;

        public async Task<List<T>> AllAsync(CancellationToken ct = default)
        {
            if (_all is null)
            {
                var docs = await store.ListDocumentsAsync(collection, ct);
                _all = docs.Select(FromDocument<T>).OfType<T>().ToList();
            }
            return [.. _all];
        }

        public async Task<T?> GetAsync(string id, CancellationToken ct = default)
        {
            if (!AppDb.IsValidId(id)) return null;
            if (_all is not null) return _all.FirstOrDefault(x => IdOf(x) == id);
            using var client = await store.ClientAsync(ct);
            using var response = await client.GetAsync($"{ApiBase}{store._userPath}/{collection}/{id}", ct);
            if (response.StatusCode == HttpStatusCode.NotFound) return null;
            return await ReadAsync(response, ct) is JsonObject doc ? FromDocument<T>(doc) : null;
        }

        public async Task UpsertAsync(T item, CancellationToken ct = default)
        {
            Invalidate();
            using var client = await store.ClientAsync(ct);
            var body = new JsonObject { ["fields"] = ToFields(item) };
            using var content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            using var response = await client.PatchAsync($"{ApiBase}{store._userPath}/{collection}/{IdOf(item)}", content, ct);
            await ReadAsync(response, ct);
        }

        public async Task UpsertManyAsync(IEnumerable<T> items, CancellationToken ct = default)
        {
            Invalidate();
            await store.CommitAsync(items.Select(i => store.UpdateWrite(collection, i)).ToList(), ct);
        }

        public async Task DeleteAsync(string id, CancellationToken ct = default)
        {
            Invalidate();
            using var client = await store.ClientAsync(ct);
            using var response = await client.DeleteAsync($"{ApiBase}{store._userPath}/{collection}/{id}", ct);
            await ReadAsync(response, ct);
        }

        public async Task DeleteManyAsync(IEnumerable<string> ids, CancellationToken ct = default)
        {
            Invalidate();
            var writes = ids.Select(id => new JsonObject { ["delete"] = store.DocumentName(collection, id) }).ToList();
            await store.CommitAsync(writes, ct);
        }
    }
}
