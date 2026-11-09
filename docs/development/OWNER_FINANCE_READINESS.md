# Owner finance integration

UC-31..34, GBR-15/16: retain existing Expense/Evidence, reports/capital recovery and What-if APIs and views. Initial investment and OPEX remain server records with version/reason and linked references; no policy, money formula or excluded module changes.

The report now exposes its snapshot timestamp, supported Room UUID filter and a CSV of exact server decimal values. The CSV preserves unavailable values and escapes spreadsheet formulas in text. What-if can export the actual server scenario/baseline and compare two server results in a table, warning about mismatched baseline scope/period. Existing snapshot/calculation version and unavailable-payback explanations remain visible.

Exports contain management data already authorized to the current Owner. What-if never writes operational prices, contracts, invoices, payments or expenses. Real multi-client E2E and evaluation-scale performance remain to be verified.
