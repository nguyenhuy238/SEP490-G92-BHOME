using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.ComponentModel.DataAnnotations.Schema;

namespace BHome.Domain.TenantContracts;

public enum ResidentType { Representative, CoOccupant }
public enum IdentityVerificationStatus { Pending, Verified, Rejected }
