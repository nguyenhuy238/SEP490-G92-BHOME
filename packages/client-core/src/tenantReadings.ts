export interface TenantMeterReading {
  id: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  meterCode: string;
  utilityType: 'Electricity' | 'Water';
  purpose: 'Initial' | 'Periodic' | 'Final';
  readingDate: string;
  billingPeriod: string | null;
  previousValue: string | null;
  confirmedValue: string;
  consumption: string | null;
  confirmedAt: string;
  status: 'Confirmed' | 'Corrected';
}
export interface TenantMeterReadingPage {
  items: TenantMeterReading[];
  page: number;
  pageSize: number;
  totalCount: number;
}
