using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence.Compact24;

// Native Identity rows and domain query projections over the reviewed 24-table schema.
// Domain writes use the typed Compact24 writer. Never infer schema with EnsureCreated/Migrate.
public sealed partial class Compact24DbContext(DbContextOptions<Compact24DbContext> options,
    Compact24Compatibility? compatibility = null) : BHomePersistenceContext(options)
{
    public const string MigrationHistorySchema = "bhome_meta";

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) =>
        optionsBuilder.UseNpgsql(options => options.MigrationsHistoryTable("__EFMigrationsHistory", MigrationHistorySchema));

    public override BHomePersistenceContext CreateIndependentContext() => new Compact24DbContext(options, compatibility);
    public override async Task<bool> IsSchemaReadyAsync(CancellationToken token = default) =>
        await Database.CanConnectAsync(token) && (await Compact24Schema.VerifyAsync(this, token) ||
            compatibility?.AllowPreviousPropertySchema == true && await Compact24Schema.VerifyPreviousPropertyAsync(this, token));
    internal DbSet<CompactRefreshRow> Refresh => Set<CompactRefreshRow>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        Compact24DomainModel.Configure(model);
        var user = model.Entity<ApplicationUser>();
        user.ToTable("users"); user.HasKey(x => x.Id);
        user.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        user.Property(x => x.UserName).HasColumnName("username").HasMaxLength(256).IsRequired();
        user.Property(x => x.NormalizedUserName).HasColumnName("normalized_username").HasMaxLength(256).IsRequired();
        user.Property(x => x.PasswordHash).HasColumnName("password_hash").IsRequired();
        user.Property(x => x.Email).HasColumnName("email").HasMaxLength(256);
        user.Property(x => x.NormalizedEmail).HasColumnName("normalized_email").HasMaxLength(256);
        user.Property(x => x.EmailConfirmed).HasColumnName("email_confirmed");
        user.Property(x => x.PhoneNumber).HasColumnName("phone").HasMaxLength(30);
        user.Property(x => x.PhoneNumberConfirmed).HasColumnName("phone_confirmed");
        user.Property(x => x.SecurityStamp).HasColumnName("security_stamp").HasMaxLength(256).IsRequired();
        user.Property(x => x.ConcurrencyStamp).HasColumnName("concurrency_stamp").HasMaxLength(256).IsRequired().IsConcurrencyToken();
        user.Property(x => x.AccessFailedCount).HasColumnName("access_failed_count");
        user.Property(x => x.LockoutEnabled).HasColumnName("lockout_enabled");
        user.Property(x => x.LockoutEnd).HasColumnName("lockout_end");
        user.Property(x => x.TwoFactorEnabled).HasColumnName("two_factor_enabled");
        user.Property(x => x.IsActive).HasColumnName("is_active");
        user.Property<string>("full_name").HasMaxLength(150);
        user.Property<string[]>("roles").IsRequired();
        user.Property<string>("reset_token_hash").HasMaxLength(64);
        user.Property<DateTimeOffset?>("reset_expires_at");
        user.Property<DateTimeOffset?>("reset_consumed_at");
        user.Property<string>("business_profile").HasColumnType("jsonb").HasDefaultValue("{}");
        user.Property<string>("signing_credentials").HasColumnType("jsonb").HasDefaultValue("[]");
        user.Property<string>("history").HasColumnType("jsonb").HasDefaultValue("[]");

        var refresh = model.Entity<CompactRefreshRow>();
        refresh.ToTable("refresh_tokens"); refresh.HasKey(x => x.Id);
        refresh.Property(x => x.Id).ValueGeneratedNever();
        refresh.HasOne<CompactRefreshRow>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Restrict);
        refresh.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        foreach (var property in refresh.Metadata.GetProperties())
            property.SetColumnName(ToSnakeCase(property.Name));
    }

    private static string ToSnakeCase(string value) => string.Concat(value.Select((c, i) =>
        i > 0 && char.IsUpper(c) ? "_" + char.ToLowerInvariant(c) : char.ToLowerInvariant(c).ToString()));
}

internal sealed class CompactRefreshRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string RecordKind { get; set; } = "";
    public Guid? SessionId { get; set; }
    public string? TokenHash { get; set; }
    public string? SecurityStamp { get; set; }
    public string? DeviceLabel { get; set; }
    public DateTimeOffset IssuedAt { get; set; }
    public DateTimeOffset? LastActivityAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevocationReason { get; set; }
    public Guid? ReplacedByTokenId { get; set; }
}
