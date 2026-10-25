using System.Text.Json;
using System.Text.Json.Serialization;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.AddSingleton<AppDb>();
builder.Services.AddHttpClient();
// Data lives in the LiteDB file, or in the user's Firestore tree while the desktop app shares a Firebase session.
builder.Services.AddSingleton<MyTodoEase.Api.Services.CloudSessionService>();
builder.Services.AddSingleton<DataStoreProvider>();
builder.Services.AddScoped<IDataStore>(sp => sp.GetRequiredService<DataStoreProvider>().Current);
builder.Services.AddSingleton<MyTodoEase.Api.Services.GoogleAuthService>();
builder.Services.AddSingleton<MyTodoEase.Api.Services.GoogleCalendarClient>();
builder.Services.AddSingleton<MyTodoEase.Api.Services.CloudCalendarBridge>();
builder.Services.AddSingleton<MyTodoEase.Api.Services.CalendarSyncService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<MyTodoEase.Api.Services.CalendarSyncService>());
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

// Local single-user app: the desktop shell (file:// origin) and the Vite dev server both call this API.
// Tighten this before exposing the API beyond localhost.
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
// A cloud session that Firebase no longer accepts must surface as a clear 503, never as a silent fallback to local data.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (MyTodoEase.Api.Services.CloudSessionService.CloudSessionException ex) when (!context.Response.HasStarted)
    {
        context.Response.Clear();
        await Results.Problem(ex.Message, statusCode: StatusCodes.Status503ServiceUnavailable, title: "Cloud session unavailable").ExecuteAsync(context);
    }
});
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var db = app.Services.GetRequiredService<AppDb>();
db.Initialize();
app.Logger.LogInformation("Storage: {Path}", db.FilePath);

app.MapGet("/api/health", (DataStoreProvider stores) =>
{
    var store = stores.Current;
    return Results.Ok(new { status = "ok", time = DateTime.UtcNow, storage = store.Description, cloud = store.IsCloud, localFile = db.FilePath });
});

// The desktop shell calls this on quit so the host disposes AppDb and LiteDB flushes its log.
// The API only listens on localhost, so this is reachable from this computer alone.
app.MapPost("/api/shutdown", (IHostApplicationLifetime lifetime) =>
{
    lifetime.StopApplication();
    return Results.Accepted();
});
app.MapProjects();
app.MapSections();
app.MapLabels();
app.MapTasks();
app.MapStats();
app.MapBackup();
app.MapAuth();
app.MapCloud();
app.MapCalendar();

app.Run();
