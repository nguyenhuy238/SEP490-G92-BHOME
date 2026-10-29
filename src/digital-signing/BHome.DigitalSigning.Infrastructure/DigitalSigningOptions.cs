namespace BHome.DigitalSigning.Infrastructure;

// Bound from the "DigitalSigning" configuration section. Secrets come from environment variables or user-secrets.
public sealed class DigitalSigningOptions
{
    public const string Section = "DigitalSigning";

    // Encrypts the client secret an Owner saves; at least 32 random characters.
    public string? SecretKey { get; set; }
    public int TransactionTtlSeconds { get; set; } = 300;
    public int MaxPdfMegabytes { get; set; } = 10;
    // Size of the "Ký bởi / Ngày ký" text in the visible signature box.
    public float SignatureFontSize { get; set; } = 14f;
    public ViettelMySignOptions Viettel { get; set; } = new();
}

// Viettel MySign, asynchronous flow. The paths are separate because Viettel's documents put them under different prefixes.
public sealed class ViettelMySignOptions
{
    public string? BaseUrl { get; set; } = "https://remotesigning.viettel.vn";
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public string? ProfileId { get; set; }
    public string LoginPath { get; set; } = "/vtss/service/ras/v1/login";
    public string CredentialsPath { get; set; } = "/adss/service/ras/csc/v1/credentials/list";
    public string SignHashPath { get; set; } = "/vtss/service/signHash";
    public string StatusPath { get; set; } = "/vtss/service/requests/status";
    public int TimeoutSeconds { get; set; } = 15;
}
