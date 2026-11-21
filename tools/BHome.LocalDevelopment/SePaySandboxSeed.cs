using System.Text.RegularExpressions;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.LocalDevelopment;

public sealed record SePaySandboxFixture(Guid InvoiceId, Guid LocationId, string PaymentCode, bool Created);

// Explicit synthetic preconditions for payment testing, never a contract activation workflow.
public static class SePaySandboxSeed
{
    public const string LocationName = "[TEST] BHOME SePay Sandbox";
    public static Guid Id(int number) => Guid.Parse($"ae130000-0000-4000-8000-{number:000000000000}");

    public static void ValidateTarget(string? environment, string connection, SePayOptions options, string holder)
    {
        var target = new NpgsqlConnectionStringBuilder(connection);
        var pattern = environment == "Testing" ? "^bhome_compact24_(?:dev_)?[a-f0-9]{32}$" : "^bhome_compact24_dev_[a-f0-9]{32}$";
        if (environment is not ("Development" or "Testing") || target.Host is not ("127.0.0.1" or "localhost" or "::1") ||
            !Regex.IsMatch(target.Database ?? "", pattern) || !options.TestingAvailable(environment) || !options.Valid(environment) ||
            options.ReceivingAccounts.Count != 1 || !Regex.IsMatch(holder, "^[A-Z0-9 ]{5,50}$"))
            throw new LocalTestAccountException("SePay fixture requires an isolated loopback database, enabled Test Mode, one valid account and an uppercase ASCII account holder.");
    }

    public static async Task<SePaySandboxFixture> RunAsync(IServiceProvider services, string? environment, string password, CancellationToken token = default)
    {
        var config = services.GetRequiredService<IConfiguration>();
        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var options = sp.GetRequiredService<SePayOptions>();
        var holder = config["SePaySandbox:AccountHolder"] ?? "";
        ValidateTarget(environment, config.GetConnectionString("Database") ?? "", options, holder);
        var db = sp.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync(token)) throw new LocalTestAccountException("Prepare the reviewed Sandbox schema first; this seed never migrates or resets data.");
        var account = options.ReceivingAccounts.Single();
        var users = sp.GetRequiredService<UserManager<ApplicationUser>>();
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"sepay-sandbox-fixture-v1"},0))", token);
        var existing = await db.Locations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == account.LocationId, token);
        var created = existing is null;
        if (created)
        {
            if (await db.Users.AnyAsync(token) || await db.Locations.AnyAsync(token))
                throw new LocalTestAccountException("Initial SePay fixture requires an empty dedicated Sandbox database. Existing accounts and business data are preserved.");
            foreach (var (number, name, role) in Accounts)
            {
                var user = new ApplicationUser { Id = Id(number), UserName = name + ".sepay.test", Email = name + ".sepay.test@example.invalid", EmailConfirmed = true, IsActive = true, LockoutEnabled = true };
                db.PrepareUserRole(user, role);
                if (!(await users.CreateAsync(user, password)).Succeeded)
                    throw new LocalTestAccountException("Synthetic account creation failed; check the local password policy. The transaction was not committed.");
            }
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
            var period = new DateOnly(today.Year, today.Month, 1);
            var location = new Location(LocationName) { Address = "SYNTHETIC PAYMENT TEST FIXTURE ONLY" }; SetId(db, location, account.LocationId);
            var room = new Room { LocationId = location.Id, RoomNumber = "SEPAY-101", Capacity = 2, Status = RoomStatus.Occupied }; SetId(db, room, Id(10));
            var resident = new Resident { RoomId = room.Id, TenantUserId = Id(2), OwnerUserId = Id(1), DisplayLabel = "Khách thuê tổng hợp Sandbox", VerificationStatus = IdentityVerificationStatus.Verified }; SetId(db, resident, Id(11));
            var contract = new Contract
            {
                RoomId = room.Id,
                RepresentativeResidentId = resident.Id,
                OwnerSignerId = Id(1),
                TenantUserId = Id(2),
                Kind = ContractKind.Main,
                StartDate = period.AddMonths(-1),
                EndDate = period.AddYears(1),
                MonthlyRent = 2500000,
                RequiredDeposit = 0,
                IsDevelopmentDemo = true,
                Status = ContractStatus.Active,
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = Id(1),
                Terms = "SYNTHETIC FIXTURE ONLY. NO REAL SIGNING, OCCUPANCY OR PAYMENT.",
                Residents = [new() { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = period.AddMonths(-1) }]
            }; SetId(db, contract, Id(12));
            var invoice = new Invoice
            {
                LocationId = location.Id,
                RoomId = room.Id,
                RoomNumber = room.RoomNumber,
                LocationName = location.Name,
                RepresentativeContractId = contract.Id,
                RepresentativeTenantUserId = Id(2),
                BillingPeriod = period,
                Total = 2500000,
                CreatedByUserId = Id(1),
                ScheduledFinalDate = today,
                DueDate = today.AddDays(7),
                ScheduleSnapshot = "{}",
                Recipients = [new() { TenantUserId = Id(2) }, new() { TenantUserId = Id(3) }],
                Lines = [new() { Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Tiền thuê tổng hợp Sandbox", Rate = 2500000, Quantity = 1, Amount = 2500000, OccupiedDays = 30, PeriodDays = 30, RateDate = period }]
            }; SetId(db, invoice, Id(13));
            db.AddRange(location, room, resident, contract, invoice);
            db.Add(new ReceivingBankAccount { LocationId = location.Id, BankIdentifier = account.BankIdentifier, AccountNumber = account.AccountNumber, AccountHolder = holder, Enabled = true, IsDevelopmentDemo = true, Version = 1, ConfirmedByUserId = Id(1), ConfirmedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(token);
            invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = Id(1); invoice.FinalizedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(token);
        }
        else
        {
            if (existing!.Name != LocationName ||
                !await db.Set<Invoice>().AnyAsync(x => x.Id == Id(13) && x.LocationId == account.LocationId && x.Status == InvoiceStatus.Final, token) ||
                !await db.Set<Contract>().AnyAsync(x => x.Id == Id(12) && x.IsDevelopmentDemo, token) ||
                !await db.Set<ReceivingBankAccount>().AnyAsync(x => x.LocationId == account.LocationId && x.IsDevelopmentDemo && x.Enabled && x.BankIdentifier == account.BankIdentifier && x.AccountNumber == account.AccountNumber && x.AccountHolder == holder, token))
                throw new LocalTestAccountException("Existing Sandbox fixture or receiving binding differs. No business data or credentials were overwritten.");
            foreach (var (number, name, role) in Accounts)
            {
                var user = await users.FindByIdAsync(Id(number).ToString());
                if (user is null || !user.IsActive || user.Email != name + ".sepay.test@example.invalid" || !(await users.GetRolesAsync(user)).SequenceEqual([role]))
                    throw new LocalTestAccountException("Synthetic account identity differs. Existing credentials and roles are preserved.");
            }
        }
        await tx.CommitAsync(token);
        var code = await sp.GetRequiredService<IPaymentCodeRegistry>().IssueAsync("Invoice", Id(13), account.LocationId, token)
            ?? throw new LocalTestAccountException("Receiving binding cannot issue a Sandbox BH code.");
        return new(Id(13), account.LocationId, code, created);
    }

    private static readonly (int Number, string Name, string Role)[] Accounts = [(1, "owner", Roles.Owner), (2, "tenant1", Roles.Tenant), (3, "tenant2", Roles.Tenant), (4, "staff", Roles.Staff)];
    private static void SetId<T>(BHomePersistenceContext db, T entity, Guid id) where T : class => db.Entry(entity).Property("Id").CurrentValue = id;
}
