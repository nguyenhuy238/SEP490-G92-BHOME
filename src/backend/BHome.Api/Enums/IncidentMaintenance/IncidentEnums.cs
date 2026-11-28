using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.IncidentMaintenance;

public enum IncidentSeverity { Normal, Emergency }
public enum IncidentStatus { Submitted, InProgress, Resolved, Rejected, Duplicate, Cancelled }
public enum WorkOrderStatus { Assigned, PendingApproval, InProgress, PendingVerification, Verified, Cancelled }
public enum IncidentEvidenceKind { Report, EmergencyAction, Inspection, Completion, Direct }
