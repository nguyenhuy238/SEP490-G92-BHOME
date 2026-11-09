# Owner contract, handover and residence integration

Traceability: UC-15/16/17/18/19, GBR-04/06. Existing Main draft, signing recovery, lifecycle, inspection, deduction and settlement panels remain the implementation. Holding does not load the Main policy panel.

The handover page reads the existing authorized Room occupancy history to select a tenancy, then uses `ContractHandoverPanel` for snapshots, readings, private evidence, confirmations, disputes and history. Direct Contract UUID lookup also supports archived records. No Owner confirmation or Staff execution permission was added.

Residence filters use the actual `ResidenceQuery` LocationId and Status, before server pagination. Filter changes discard data from the previous scope. The existing record/evidence/history and Owner confirmation flow remains in use. Official registration takes place outside BHOME.

Production signing remains blocked until an approved production document/template and provider configuration are supplied. Development/Testing simulation is labelled and cannot confer legal signing status. Residence statutory deadlines and JOB-08 recipient/cadence remain a policy decision; this change does not introduce them.

Cross-channel handover, real provider signing and official residence registration have not been E2E tested here.
