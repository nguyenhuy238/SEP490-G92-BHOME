namespace BHome.Application.Storage;

// Only an authenticated private-storage lookup that confirms an absent object
// should produce this exception. Never include object keys or bucket details.
public sealed class PrivateObjectNotFoundException()
    : FileNotFoundException("The requested private file is unavailable.");
