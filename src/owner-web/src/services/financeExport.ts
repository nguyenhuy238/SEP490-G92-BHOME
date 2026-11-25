import type { FinancialReport } from '../../../../packages/client-core/src/finance';
// Preserve backend decimal strings and make text safe to open in a spreadsheet.
export function reportCsv(report: FinancialReport) {
  const rows: unknown[][] = [
    [
      'from',
      'to',
      'snapshotAt',
      'locationId',
      'locationName',
      'issued',
      'approvedAdjustments',
      'verifiedCollections',
      'operatingExpenses',
      'operatingProfit',
      'outstandingNow',
      'initialInvestment',
      'netOperatingCashFlow',
      'settlementApprovedCharges',
      'settlementOutstandingNow',
      'settlementVerifiedBankCollections',
      'depositOffsetsApplied',
      'holdingForfeitures',
      'managementRevenue',
      'actualBusinessCollections',
      'currentOutstanding',
      'overdueInvoiceOutstanding',
      'priorPeriodCollections',
      'depositReceipts',
      'initialRentAndFeeCollections',
      'advanceCollections',
      'operatingPaymentsConfirmed',
      'operatingUnpaidConfirmed',
      'operatingUnknownPaymentAmount',
      'operatingCashFlow',
      'operatingMarginPercent',
      'depreciation',
      'profitAfterDepreciation',
      'investmentPaymentsConfirmed',
      'netCashAfterInvestment',
      'collectionRatePercent',
      'periodOutstanding',
      'investmentInPeriod',
      'assetDisposalReceipts',
      'cumulativeOperatingCashFlow',
      'cashCapitalNetRecovery',
      'cashCapitalRemaining',
      'cashCapitalRecoveryPercent',
      'cashCapitalEstimatedRemainingMonths',
      'cashCapitalUnavailableReason',
      'totalRooms',
      'occupiedRooms',
      'currentOccupancyPercent',
      'operatingCostPerRoom',
      'legacyMetricMeaning',
      'expenseCategories',
      'cashFlowUnavailableReason',
      'monthlyTrend',
      'trendUnavailableReason',
    ],
  ];
  const append = (
    id: string,
    name: string,
    t: FinancialReport['total'],
    source?: FinancialReport['settlementSources'],
  ) =>
    rows.push([
      report.filter.from,
      report.filter.to,
      report.snapshotAt,
      id,
      name,
      t.issued,
      t.approvedAdjustments,
      t.verifiedCollections,
      t.operatingExpenses,
      t.operatingProfit,
      t.outstandingNow,
      t.initialInvestment,
      t.netOperatingCashFlow,
      source?.approvedCharges,
      source?.outstandingNow,
      source?.verifiedBankCollections,
      source?.depositOffsetsApplied,
      source?.holdingForfeitures,
      t.management?.revenue,
      t.management?.actualBusinessCollections,
      t.management?.currentOutstanding,
      t.management?.overdueInvoiceOutstanding,
      t.management?.priorPeriodCollections,
      t.management?.depositReceipts,
      t.management?.initialRentAndFeeCollections,
      t.management?.advanceCollections,
      t.management?.operatingPaymentsConfirmed,
      t.management?.operatingUnpaidConfirmed,
      t.management?.operatingUnknownPaymentAmount,
      t.management?.operatingCashFlow,
      t.management?.operatingMarginPercent,
      t.management?.depreciation,
      t.management?.profitAfterDepreciation,
      t.management?.investmentPaymentsConfirmed,
      t.management?.netCashAfterInvestment,
      t.management?.collectionRatePercent,
      t.management?.periodOutstanding,
      t.management?.investmentInPeriod,
      t.management?.assetDisposalReceipts,
      t.management?.cumulativeOperatingCashFlow,
      t.management?.cashCapital?.netRecovery,
      t.management?.cashCapital?.remainingCapital,
      t.management?.cashCapital?.recoveryPercent,
      t.management?.cashCapital?.estimatedRemainingMonths,
      t.management?.cashCapital?.unavailableReason,
      t.totalRooms,
      t.occupiedRooms,
      t.management?.currentOccupancyPercent,
      t.management?.operatingCostPerRoom,
      'verifiedCollections=allocated verified receipts; netOperatingCashFlow=allocated receipts minus accrued OPEX; use actualBusinessCollections and operatingCashFlow for actual cash',
      t.management ? JSON.stringify(t.management.expenseCategories ?? []) : null,
      t.management?.cashFlowUnavailableReason,
      id ? null : report.trend == null ? null : JSON.stringify(report.trend),
      id ? null : report.trendUnavailableReason,
    ]);
  append('', 'TOTAL', report.total, report.settlementSources);
  for (const location of report.locations)
    append(location.locationId, location.locationName, location.totals, location.settlementSources);
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = value == null ? '' : String(value);
            if (/^[=+@\t\r-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
export function downloadFinance(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
