namespace BHome.Domain.IdentityAccess;

// Fixed business actions, not JWT claims or a configurable permissions table.
public static class Permissions
{
    public static class Account
    {
        public const string ViewOwn = "account.view-own";
        public const string UpdateOwn = "account.update-own";
        public const string ChangePassword = "account.change-password";
    }

    public static class Sessions
    {
        public const string RevokeOwn = "sessions.revoke-own";
    }

    public static class StaffAccounts
    {
        public const string Manage = "staff-accounts.manage";
    }

    public static class StaffAssignments
    {
        public const string Manage = "staff-assignments.manage";
    }

    public static class Locations
    {
        public const string Manage = "locations.manage";
        public const string ViewAssigned = "locations.view-assigned";
    }

    public static class Rooms
    {
        public const string View = "rooms.view";
        public const string Manage = "rooms.manage";
    }

    public static class Assets
    {
        public const string View = "assets.view";
        public const string Manage = "assets.manage";
        public const string UpdateCondition = "assets.update-condition";
    }

    public static class OperationalTasks
    {
        public const string Manage = "operational-tasks.manage";
        public const string Execute = "operational-tasks.execute";
        public const string Verify = "operational-tasks.verify";
    }

    public static class Contracts
    {
        public const string Prepare = "contracts.prepare";
        public const string Activate = "contracts.activate";
        public const string Sign = "contracts.sign";
    }

    public static class MeterReadings
    {
        public const string Confirm = "meter-readings.confirm";
    }

    public static class Invoices
    {
        public const string View = "invoices.view";
        public const string ViewOperational = "invoices.view-operational";
        public const string ViewOwn = "invoices.view-own";
    }

    public static class InvoiceAdjustments
    {
        public const string Request = "invoice-adjustments.request";
        public const string Approve = "invoice-adjustments.approve";
    }

    public static class Incidents
    {
        public const string Report = "incidents.report";
        public const string View = "incidents.view";
        public const string RespondEmergency = "incidents.respond-emergency";
        public const string Review = "incidents.review";
    }

    public static class WorkOrders
    {
        public const string ApprovePlan = "work-orders.approve-plan";
        public const string Execute = "work-orders.execute";
        public const string Verify = "work-orders.verify";
    }

    public static class Finance
    {
        public const string View = "finance.view";
    }

    public static class Notifications
    {
        public const string ReadOwn = "notifications.read-own";
    }

    public static class PublicContent
    {
        public const string Publish = "public-content.publish";
    }
}
