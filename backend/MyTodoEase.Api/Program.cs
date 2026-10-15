using System.Text.Json;
using System.Text.Json.Serialization;
using MyTodoEase.Api.Data;
using MyTodoEase.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.AddSingleton<AppDb>();
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
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var db = app.Services.GetRequiredService<AppDb>();
db.Initialize();
app.Logger.LogInformation("Storage: {Path}", db.FilePath);

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));
app.MapProjects();
app.MapSections();
app.MapLabels();
app.MapTasks();
app.MapStats();

app.Run();
