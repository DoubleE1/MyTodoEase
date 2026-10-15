namespace MyTodoEase.Api.Data;

public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>
    /// Full path of the LiteDB file. When empty, the API uses
    /// %LOCALAPPDATA%\MyTodoEase\mytodoease.db (or MYTODOEASE_DATA_DIR\mytodoease.db when that
    /// environment variable is set), so the installed app and a development run share one database.
    /// </summary>
    public string? Path { get; set; }

    public string ResolvePath()
    {
        if (!string.IsNullOrWhiteSpace(Path)) return System.IO.Path.GetFullPath(Path);
        var dir = Environment.GetEnvironmentVariable("MYTODOEASE_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dir))
            dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MyTodoEase");
        return System.IO.Path.Combine(dir, "mytodoease.db");
    }
}
