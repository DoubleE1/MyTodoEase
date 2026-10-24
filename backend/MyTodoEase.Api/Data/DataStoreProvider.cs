using MyTodoEase.Api.Services;

namespace MyTodoEase.Api.Data;

/// <summary>
/// Picks the store for the current request: Firestore while the desktop app has shared a Firebase session,
/// the local LiteDB file otherwise. Firestore stores are per request (they memoise collection reads); the
/// LiteDB store is a singleton wrapper around the one database handle.
/// </summary>
public sealed class DataStoreProvider(AppDb db, CloudSessionService session, IHttpClientFactory http)
{
    private readonly LiteDbStore _local = new(db);

    public IDataStore Current => session.IsActive ? new FirestoreStore(session, http) : _local;

    /// <summary>The LiteDB file regardless of mode (for moving local data to the cloud).</summary>
    public IDataStore Local => _local;
}
