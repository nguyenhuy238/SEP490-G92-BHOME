using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Billing;

public enum InvoiceStatus { Draft, Final }
public enum BillingRateDate { PeriodStart, PeriodEnd }
public enum BillingRentSource { RoomPolicy, RepresentativeContract }
public enum PartialMonthRule { FullMonth, OccupiedCalendarDays }
public enum VndRounding { AwayFromZero, ToEven }
