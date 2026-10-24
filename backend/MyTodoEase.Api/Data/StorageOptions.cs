namespace MyTodoEase.Api.Data;

public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>
    /// Full path of the LiteDB file. When empty, the API uses
    /// %LOCALAPPDATA%\TodoEase\mytodoease.db (or MYTODOEASE_DATA_DIR\mytodoease.db when that
    /// environment variable is set), so the installed app and a development run share one database.
    /// </summary>
    public string? Path { get; set; }

    public string ResolvePath()
    {
        if (!string.IsNullOrWhiteSpace(Path)) return System.IO.Path.GetFullPath(Path);
        var dir = Environment.GetEnvironmentVariable("MYTODOEASE_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dir)) dir = DefaultDataDir();
        return System.IO.Path.Combine(dir, "mytodoease.db");
    }

    /// <summary>
    /// %LOCALAPPDATA%\TodoEase. The app used to be called MyTodoEase; an existing folder of that name is renamed
    /// once so the database, Google tokens and sync settings carry over. If the rename fails (an older API still
    /// has the database open) the old folder is used for this run and the move is retried next start.
    /// </summary>
    private static string DefaultDataDir()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var newDir = System.IO.Path.Combine(local, "TodoEase");
        var oldDir = System.IO.Path.Combine(local, "MyTodoEase");
        if (Directory.Exists(newDir) || !Directory.Exists(oldDir)) return newDir;
        try
        {
            Directory.Move(oldDir, newDir);
            return newDir;
        }
        catch (IOException)
        {
            return oldDir;
        }
        catch (UnauthorizedAccessException)
        {
            return oldDir;
        }
    }
}
