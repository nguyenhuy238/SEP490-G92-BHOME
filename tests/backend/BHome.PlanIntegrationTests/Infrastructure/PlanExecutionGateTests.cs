namespace BHome.PlanIntegrationTests.Infrastructure;

public sealed class PlanExecutionGateTests
{
    private const string Api = "https://127.0.0.1:7258/";
    private const string Database = "Host=127.0.0.1;Port=55439;Database=bhome_plan_it_0123456789abcdef0123456789abcdef;Username=bhome_ci;Password=synthetic-only";

    [Fact]
    public void OptInAndAnExplicitDisposableFixtureAreMandatory()
    {
        Assert.NotNull(PlanExecutionGate.RejectionReason(null, Api, Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("false", Api, Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", null, Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", Api, null));
        Assert.Null(PlanExecutionGate.RejectionReason("true", Api, Database));
    }

    [Fact]
    public void OrdinaryLocalApiAndRemoteHostsAreRejectedEvenWhenOptedIn()
    {
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", "https://localhost:7240/", Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", "https://api.example.com:7258/", Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", "https://127.0.0.1:7258/login", Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", "https://127.0.0.1:7258@api.example.com/", Database));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", "not a url", Database));
    }

    [Fact]
    public void ExistingOrRemotePostgresDatabasesAndInvalidSettingsAreRejected()
    {
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", Api, "Host=localhost;Port=5434;Database=bhome_dev"));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", Api, "Host=db.example.com;Port=55439;Database=bhome_plan_it_0123456789abcdef0123456789abcdef"));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", Api, "Host=127.0.0.1;Port=5432;Database=bhome_plan_it_0123456789abcdef0123456789abcdef"));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", Api, "Host=127.0.0.1;Port=not-a-port;Database=bhome_plan_it_0123456789abcdef0123456789abcdef"));
        Assert.NotNull(PlanExecutionGate.RejectionReason("true", Api, "not a connection string"));
    }
}
