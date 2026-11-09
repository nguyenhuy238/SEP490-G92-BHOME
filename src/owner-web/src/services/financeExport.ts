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
    ],
  ];
  const append = (id: string, name: string, t: FinancialReport['total']) =>
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
    ]);
  append('', 'TOTAL', report.total);
  for (const location of report.locations)
    append(location.locationId, location.locationName, location.totals);
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
