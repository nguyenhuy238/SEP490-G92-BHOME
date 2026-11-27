namespace BHome.Application.Contracts;

public static class InboxStage
{
    public static bool Valid(string? stage) => stage is null or "Staff" or "Owner" or "Tenant" or "Completed";
}
