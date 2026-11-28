using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

// The API runtime maps only the reviewed physical schema. Business aggregates and
// JSON snapshots are materialized by their owning repositories, not EF projections.
public partial class Compact24DbContext(DbContextOptions<Compact24DbContext> options,
    Compact24Compatibility? compatibility = null, TimeProvider? clock = null) : BHomePersistenceContext(options)
{
    public const string MigrationHistorySchema = "bhome_meta";

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) =>
        optionsBuilder.UseNpgsql(options => options.MigrationsHistoryTable("__EFMigrationsHistory", MigrationHistorySchema));

    public override BHomePersistenceContext CreateIndependentContext() => new Compact24DbContext(options, compatibility, clock);
    public override async Task<bool> IsSchemaReadyAsync(CancellationToken token = default) =>
        await Database.CanConnectAsync(token) && await Compact24Schema.VerifyAsync(this, token);
    internal DbSet<RefreshToken> Refresh => Set<RefreshToken>();
    protected TimeProvider PersistenceClock => clock ?? TimeProvider.System;
    protected DbContextOptions<Compact24DbContext> ContextOptions => options;
    protected Compact24Compatibility? Compatibility => compatibility;
    // Offline fixture adapters can expose the historical EF projection model.
    // Runtime DI always resolves this native context, never the offline adapter.
    internal virtual bool UsesArchiveProjection => false;

    internal NpgsqlCommand CreateSqlCommand(string sql) => new(sql, (NpgsqlConnection)Database.GetDbConnection(),
        (NpgsqlTransaction?)Database.CurrentTransaction?.GetDbTransaction());

    protected override void OnModelCreating(ModelBuilder model)
    {
        // IdentityDbContext and the offline persistence base expose legacy DbSets.
        // EF conventions discover them before OnModelCreating; explicitly remove
        // them from the runtime model before installing the 24 physical mappings.
        foreach (var type in model.Model.GetEntityTypes().Select(e => e.ClrType).Distinct().ToArray())
            if (type != typeof(User) && type != typeof(RefreshToken) && !Compact24NativeModel.IsNative(type))
                model.Ignore(type);
        ConfigurePhysicalModel(model);
    }

    protected static void ConfigurePhysicalModel(ModelBuilder model, bool archive = false)
    {
        var user = model.Entity<User>();
        user.ToTable("users", t => t.ExcludeFromMigrations()); user.HasKey(x => x.Id);
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
        user.Property<string>("business_profile").HasColumnType("jsonb").HasDefaultValue("{}").IsRequired();
        user.Property<string>("signing_credentials").HasColumnType("jsonb").HasDefaultValue("[]").IsRequired();
        user.Property<string>("history").HasColumnType("jsonb").HasDefaultValue("[]").IsRequired();

        var refresh = model.Entity<RefreshToken>();
        refresh.ToTable("refresh_tokens", t => t.ExcludeFromMigrations()); refresh.HasKey(x => x.Id);
        refresh.Property(x => x.Id).ValueGeneratedNever();
        refresh.HasOne<RefreshToken>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Restrict);
        refresh.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        foreach (var property in refresh.Metadata.GetProperties())
            property.SetColumnName(ToSnakeCase(property.Name));
        refresh.Property(x => x.RecordKind).HasMaxLength(10).IsRequired();
        refresh.Property(x => x.TokenHash).HasMaxLength(64);
        refresh.Property(x => x.SecurityStamp).HasMaxLength(256);
        refresh.Property(x => x.DeviceLabel).HasMaxLength(256);
        refresh.Property(x => x.RevocationReason).HasMaxLength(50);
        Compact24NativeModel.Configure(model, archive);
    }

    public override void PrepareUserRole(User user, string role)
    {
        if (Entry(user).State is not (EntityState.Detached or EntityState.Added) || !BHome.Domain.IdentityAccess.Roles.All.Contains(role))
            throw new InvalidOperationException("Prepare a supported role only for a new account.");
        Entry(user).Property<string[]>("roles").CurrentValue = [role];
    }

    public override IQueryable<T> Locked<T>(Guid id, bool skipLocked = false, bool shared = false)
    {
        var entity = Model.FindEntityType(typeof(T)) ?? throw new InvalidOperationException("Only physical runtime entities can be locked.");
        var table = entity.GetTableName() ?? throw new InvalidOperationException("A physical table is required.");
        var suffix = shared ? " FOR SHARE" : " FOR UPDATE" + (skipLocked ? " SKIP LOCKED" : "");
        return Set<T>().FromSqlRaw($"SELECT * FROM \"public\".\"{table}\" WHERE id={{0}}" + suffix, id);
    }

    internal override async Task<IReadOnlyList<BHome.Application.Billing.BillingQueueView>> BillingQueueAsync(Guid location, DateOnly period, CancellationToken token)
    {
        var key = period.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        return await Database.SqlQuery<BHome.Application.Billing.BillingQueueView>($"""
            SELECT j.id AS "Id",j.task_data->>'name' AS "Name",j.status AS "State",j.attempt_count AS "Attempts",
              j.next_run_at AS "AvailableAt",j.locked_until AS "LockedUntil",j.task_data->>'lastErrorCode' AS "LastErrorCode"
            FROM operational_tasks j JOIN locations l ON l.id={location}
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.operating_settings->'automationPlanVersions','[]'::jsonb)) p
            WHERE j.task_type='SYSTEM_JOB' AND j.task_data->'payload'->>'PlanId'=p->>'id'
              AND j.task_data->'payload'->>'BillingPeriod'={key}
              AND j.task_data->>'name' IN ('billing-meter','billing-draft','billing-final')
            ORDER BY j.next_run_at DESC LIMIT 30
            """).ToArrayAsync(token);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        SaveChangesAsync(acceptAllChangesOnSuccess).GetAwaiter().GetResult();

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ChangeTracker.DetectChanges();
        if (ChangeTracker.Entries().Any(e => Compact24NativeModel.IsNative(e.Metadata.ClrType) &&
            e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            return await SaveNativeChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        if (ChangeTracker.Entries().Any(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted &&
            e.Entity is not User && e.Entity is not RefreshToken))
            throw new InvalidOperationException("Runtime writes require a physical entity or its explicit repository.");
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    internal static Guid DeterministicId(string key) => new(System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(key)).AsSpan(0, 16));

    private static string ToSnakeCase(string value) => string.Concat(value.Select((c, i) =>
        i > 0 && char.IsUpper(c) ? "_" + char.ToLowerInvariant(c) : char.ToLowerInvariant(c).ToString()));
}
