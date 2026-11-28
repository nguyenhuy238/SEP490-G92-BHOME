using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;

namespace BHome.Domain.Billing;

public enum UtilityType { Electricity, Water }
public enum MeterDisplay { Mechanical, Digital }
public enum ReadingPurpose { Initial, Periodic, Final }
// Preserve the legacy numeric values used by meter APIs and filtered indexes.
public enum MeterTaskStatus { Assigned, InProgress, Completed, Cancelled, PendingVerification }
public enum MeterReadingStatus { Confirmed, Corrected }
