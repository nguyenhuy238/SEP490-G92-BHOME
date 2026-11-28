using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PropertyManagement;

public sealed class Chain : AuditableEntity
{
    public string Name { get; set; } = "";
    public int Version { get; set; } = 1;
}
