using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.TenantContracts;

public enum ContractKind { Main, Renewal, Holding, Addendum }
public enum ContractStatus { Draft, PendingSigning, PendingActivation, Active, Terminated, Superseded, Cancelled, Expired, Converted, Applied }
public enum SignatureStatus { Prepared, Dispatching, Pending, Signed, Failed, ManualReview, Simulated }
public enum MoveOutStatus { Requested, Approved, Inspected, PendingSettlement, Settled, Completed, Rejected, AwaitingConsent }
