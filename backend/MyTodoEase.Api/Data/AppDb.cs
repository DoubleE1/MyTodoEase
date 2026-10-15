using System.Text.RegularExpressions;
using LiteDB;
using Microsoft.Extensions.Options;
using MyTodoEase.Api.Models;

namespace MyTodoEase.Api.Data;

/// <summary>
/// Embedded LiteDB storage: one file, no service to install. A single LiteDatabase instance is
/// thread-safe, so this lives as a singleton for the life of the API process.
/// Ids stay 24-hex-character strings (ObjectId text) so the client contract is unchanged.
/// </summary>
public sealed partial class AppDb : IDisposable
{
    private readonly LiteDatabase _db;

    public string FilePath { get; }
    public ILiteCollection<Project> Projects { get; }
    public ILiteCollection<Section> Sections { get; }
    public ILiteCollection<Label> Labels { get; }
    public ILiteCollection<TodoTask> Tasks { get; }
    public ILiteCollection<Completion> Completions { get; }

    public AppDb(IOptions<StorageOptions> options)
    {
        FilePath = options.Value.ResolvePath();
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);

        _db = new LiteDatabase(new ConnectionString
        {
            Filename = FilePath,
            Connection = ConnectionType.Direct,
            Upgrade = true,
        })
        {
            // Hand DateTimes back as UTC instead of converting them to the machine's local time.
            UtcDate = true,
        };

        Projects = _db.GetCollection<Project>("projects");
        Sections = _db.GetCollection<Section>("sections");
        Labels = _db.GetCollection<Label>("labels");
        Tasks = _db.GetCollection<TodoTask>("tasks");
        Completions = _db.GetCollection<Completion>("completions");
    }

    /// <summary>Creates indexes and guarantees the Inbox project exists. Safe to run on every start.</summary>
    public void Initialize()
    {
        Tasks.EnsureIndex(t => t.ProjectId);
        Tasks.EnsureIndex(t => t.IsCompleted);
        Tasks.EnsureIndex(t => t.ParentId);
        Tasks.EnsureIndex(t => t.SectionId);
        Sections.EnsureIndex(s => s.ProjectId);
        Completions.EnsureIndex(c => c.CompletedAt);
        Completions.EnsureIndex(c => c.TaskId);

        if (!Projects.Exists(p => p.IsInbox))
        {
            Projects.Insert(new Project { Id = NewId(), Name = "Inbox", Color = "grey", IsInbox = true, Order = 0 });
        }
    }

    public static string NewId() => ObjectId.NewObjectId().ToString();

    public static bool IsValidId(string? id) => id is not null && IdPattern().IsMatch(id);

    public void Dispose() => _db.Dispose();

    [GeneratedRegex("^[0-9a-f]{24}$")]
    private static partial Regex IdPattern();
}
