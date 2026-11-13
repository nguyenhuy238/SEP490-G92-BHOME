# Holding: Staff simulation → QR → verified deposit → OnHold (SePay Test Mode)

## Scope

User explicitly requested temporary Staff buttons to simulate Owner/Tenant signing, then QR, verified deposit and OnHold. This feature is restricted to Development/Testing + valid enabled SePay Test Mode + an isolated loopback sandbox database. Every affected contract and receiving account must be development demo data. Real signatures, real Neon data and normal Owner signing/activation permissions are unchanged.

Staff must have an active assignment to the contract location. Existing ContractService.GetAsync enforces this before any sandbox data read or mutation. Tenant/anonymous cannot use these routes. Remote databases, Neon, Production, Live Mode, disabled SePay, ordinary working databases and non-demo contracts are rejected.

## API

Base: `/api/v1/integrations/sepay/testing/holdings/{id}`; JWT Owner or assigned Staff.

- `GET /simulation`: persisted simulation flags and verified ledger amount, current contract/room completion state.
- `POST /simulation/signatures`: `{ "participant": "Owner" | "Tenant", "simulationOnly": true }`. Requires actual Owner approval first. Idempotently records simulation timestamps bound to snapshotHash in Holding draft metadata, with audit identifying the Staff who clicked. Does not create ContractSignature, InternalAcceptance or any legal signing evidence; contract stays Draft.
- `GET /transfer-instructions`: QR from the backend BH registry and receiving account bound to Location, using existing VietQrGenerator. Staff must complete both simulation flags first; Owner retains the previously added pre-signing preview capability. Amount is the verified-ledger remainder.
- `POST /simulation/activate`: explicit demo fixture completion. Requires both simulation flags, actual Owner approval, unexpired Holding, active/available room, no conflicting contract and exact full verified deposit from the existing payment ledger. Under existing ledger/location/room transaction locks, updates only the demo contract to Active and demo room to OnHold, records Staff actor and explicit Sandbox audit/property history. Repeat is idempotent. No fake payment or signature is generated. Normal `/holding-activation` still rejects absent legal signature evidence.

There is no “mark paid” Staff button. “Kiểm tra thanh toán” only refreshes server state. Payment must come through the existing verified receipt/SePay reconciliation path.

## Mobile

`HoldingSandboxFlow.tsx` is available only in a development build for demo Holding with a successful server sandbox capability response. Unavailable capabilities fall back to the real flow.

Two buttons: “Mô phỏng Owner đã ký” and “Mô phỏng người giữ chỗ đã ký”. Only after both server responses can Staff press “Tiếp tục: tạo QR”. QR displays amount, account, holder and reference returned by the API. Activation stays disabled until the backend verifies the deposit. Completion displays Test Mode and confirms Active/OnHold from the sandbox API, without claiming legal signatures.

## Local setup, 13/11/2026

- Sandbox API: `https://localhost:7340`; original Neon API remains on 7240.
- Sandbox Cloudflare: `https://due-nation-biological-smallest.trycloudflare.com` (temporary tunnel).
- Mobile `.env.local` now points to this sandbox tunnel; Metro restarted on 8081. Prior config backup: `.tools/private-backups/mobile-env-before-sepay-staff-simulation.backup`.
- Login: `staff.sepay.test@example.invalid`; private password is `BHOME_SEPAY_FIXTURE_PASSWORD` in `.env.sepay.local`, also copied to ignored `.tools/sepay-holding-preview/sandbox-login.txt` for the local operator.
- Assigned location: `[TEST] BHOME SePay Sandbox`; room `HOLD-QR-TEST`; Holding `ae130000-0000-4000-8000-000000000022`; deposit 3,000,000 VND. Fixture already approved through the normal Owner API; simulation flags and receipt remain empty for manual testing.
- `ContractWorkflow__SimulatedSigningEnabled=true` is restricted to the private sandbox profile and loaded by Start-SePaySandbox.ps1, so newly created sandbox contracts are demo-marked. No shared Neon signing setting was changed.
- Tokens, passwords and provider secrets are not committed. All helper/launcher/credential files remain gitignored.
- Test Mode is not for transferring real money from a banking app. Create the transaction in SePay Test Mode with the exact backend reference/amount. A webhook targeting this sandbox must use its own tunnel URL plus `/api/v1/integrations/sepay/webhook`; polling uses the existing Test Mode configuration.

## Executed checks

- 9 backend tests pass: environment/database guards; Owner QR preview; assigned Staff full simulation with authenticated synthetic SePay HMAC receipt; pre-payment activation rejection; out-of-location denial; idempotency; no legal signatures; actual demo Active/OnHold only after ledger verification; original Holding deposit safeguards.
- 52 mobile tests pass in four files, including the new simulation tests plus existing real signing, contract sections and draft tests. Mobile typecheck/lint pass.
- Runtime Staff sandbox login and capability read return 200; QR before both flags returns 409; public sandbox HTTPS readiness 200. No simulated signature or payment was posted to the operator's local fixture, leaving it ready to click through.
- Visual emulator verification has not been performed. UI uses the shell scroll/safe-area/navigation, a bounded responsive QR image and no additional footer.
