# Kế hoạch hoàn thiện BHOME cho Nguyễn Quốc Huy

## Baseline và phạm vi

- Branch: member/QHuy. HEAD đầu việc: f318ffcfe79fc5f6e9b829412a3f1257103331c1.
- Có sẵn hai file untracked: BHOME_NQH_FULL_IMPLEMENTATION_AUDIT_2026-11-10.md và docs/development/SYSTEM_DEMO_READINESS_AUDIT_2026-11-09.md. Không sửa/stage hai file này.
- Runtime: Compact24DbContext, typed SQL projections/writer; Location → Room. Không áp dụng migrations legacy lên Compact24.
- Toolchain: .NET 8, Node 22 trong .tools. CI ở .github/workflows/ci.yml.
- Database làm việc: cấu hình local hiện có, không migrate/seed/reset. Kiểm thử mutation dùng database disposable được xác thực target loopback.
- Không push/merge/checkout/reset. Mỗi phần thay đổi có commit local riêng sau build/test liên quan.
- Source requirements: BR-01–29 trong yêu cầu triển khai ngày 10/11/2026; thay thế nội dung mâu thuẫn ở SRS v1.3 và audit. Giữ privacy/auth/transaction invariants không bị thay thế.

## Ma trận triển khai

| Requirement       | Hiện tại                                                            | Gap/thay đổi được duyệt                                                                                                             | Thành phần                                                            | Phase  |
| ----------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| BR-01/02/03/04/05 | Mời sau Active nhưng ký đòi account; Resident thiếu contact độc lập | Ký theo Resident trước account, email từng occupant; Owner provisioning sau Main Active; nhận lời mời Web/Mobile                    | Resident/Capture, Contract/MainDraft, AccountInvitations, clients     | 1–3    |
| BR-06/19          | Invoice recipients snapshot; payer riêng                            | Room audience hiện tại + historical debt responsibility; không lộ Tenant khác                                                       | Invoice/Payment queries, Mobile invoice/debt                          | 6–7    |
| BR-07             | MySign đăng nhập hoặc simulator                                     | Internal OTP/drawn acceptance riêng: token hash/purpose/expiry, OTP limits/replay, exact PDF hash, consent/evidence; Owner approval | Contract signing service/repository, private files, public signing UI | 1/3    |
| BR-08/09/10/11    | Holding cơ bản, cancellation/refund và applied settlement thiếu     | Configurable expiry không max tự đặt; verified full deposit; reason-specific forfeiture/refund; transfer 100% một lần               | Holding/ledger/refund/UI                                              | 5      |
| BR-12             | Tenant meter screen đọc invoice lines                               | Scoped confirmed-reading API trước Draft, evidence authorization, notification                                                      | Meter read query, Mobile existing screen, notification                | 6      |
| BR-13/14/15       | Exit bị buộc periodic invoice cuối                                  | Settlement receivables, signed/effective proration policy, final-baseline delta, không tạo Final Settlement Invoice                 | Settlement/ledger/DB/Web                                              | 1/10   |
| BR-16             | Adjustment workflow đã có                                           | Kiểm chứng mọi category configurable và excess refund, giữ Final                                                                    | Adjustment/UI/tests                                                   | 8      |
| BR-17             | Manual only; generic unconfigured bank adapter                      | Canonical provider boundary/recovery; provider-specific adapter và actual test phụ thuộc access/docs                                | Bank/Payment/jobs/Web                                                 | 7      |
| BR-18             | Excess review/refund có; chưa có credit                             | Chỉ refund cho payer; không triển khai credit                                                                                       | Refund/Payment/Tenant status                                          | 7      |
| BR-20/21/22       | Damage trực tiếp deduction trong deposit budget                     | Distinct liability + separate approved source-specific offset; debt > deposit remains payable                                       | Settlement receivable/allocation/Web                                  | 10     |
| BR-23/24/25       | Release đợi settled; Resident current association chưa kết thúc     | Physical release độc lập finance; Tenant-only early; historical debt retained                                                       | Contract closure/residence/room queries/UI                            | 10     |
| BR-26             | Mobile có một số quyết định finance                                 | Monitoring/navigation; complex finance chỉ Owner Web                                                                                | Mobile action mapping/screens                                         | 12     |
| BR-27             | Crypto có; chưa có retention policy metadata                        | Configurable hold/review/anonymization eligibility, không xóa khi thời hạn chưa duyệt                                               | Identity lifecycle/Owner service/tests                                | 2/11   |
| BR-28             | Configured residence reminders có                                   | Kiểm chứng recurring/dedupe/Owner+Tenant/no Staff/no VNeID                                                                          | Notifications/residence/tests                                         | 11     |
| BR-29             | Không có provider access                                            | Không bịa sandbox response; phân biệt internal acceptance/simulator/MySign/bank thật                                                | Integration config/tests/docs                                         | 4/7/13 |

## Thiết kế thay đổi và tiêu chí chung

1. Reuse controller → service → repository; authorization dùng resource server-loaded. Token anonymous chỉ có đúng contract/version/purpose, chưa verify OTP không đọc PDF/PII.
2. Identity input ảnh vẫn transient; email contact được kiểm format/association, không tạo User ở identity confirmation.
3. Anonymous evidence không dùng user giả làm Tenant. Signed subject là Resident; việc tạo User sau activation không sửa signed snapshot.
4. Signing token/OTP chỉ lưu hash có scope, bounded attempts/expiry; issue/reissue/replay và consent được audit. Signature picture là internal acceptance, không phải chứng thư CA.
5. Settlement charge có source key/calculation snapshot; allocation lấy từ canonical payment/deposit, transaction/idempotency; không thu trùng và không mất historical liability khi release.
6. Schema thay đổi bằng migration additive/explicit constraint replacement. Baseline SQL migration cũ giữ nguyên; verifier và fresh/disposable migration tests cập nhật đồng bộ.
7. API/DTO thay đổi cập nhật docs/client/tests cùng phase. FE phải loading/empty/error/retry/validation/busy/reload; không fake-success.
8. Test positive + negative scope/state/replay/concurrency; mutations chỉ disposable DB. E2E ghi riêng API/component/native/real-provider.

## Trình tự và trạng thái

Phase 0 baseline/decisions → 1 persistence/demo → 2 OCR/onboarding → 3 anonymous signing/accounts → 4 MySign → 5 Holding/Main → 6 meters/billing → 7 payments/bank/refunds → 8 adjustments → 9 renewal → 10 settlement/release → 11 notifications/retention → 12 UI completion → 13 E2E/CI.

Mọi phase có source, contract/doc, tests và commit riêng khi có thay đổi coherent. Không tạo empty commit cho chức năng đã đúng. Việc cần provider thật vẫn BLOCKED nếu thiếu access, trong khi phần nội bộ tiếp tục.

## External/policy blockers

Người dùng đã trả lời “chưa có, tôi sẽ thêm vào sau” cho provider bank và sandbox/secrets MySign/Email/SMS. Không tự chọn contract ngân hàng hoặc chế tạo payload được gọi là provider thật. Holding maximum, CCCD retention duration và cadence residence chưa được đặt mặc định; xem decision register.

## Validation

Thực hiện restore/build theo CI, backend unit/digital-signing/full integration khi hạ tầng cho phép, Owner/Mobile typecheck, Node 22 frontend tests/lint/build/format, disposable schema/migrations, MinIO/PDF/OCR, UI E2E. Ghi đầy đủ FAIL/BLOCKED/NOT RUN. Không xác nhận GitHub Actions trên commits chưa push.

## 11/11/2026 — Tiếp nối receipt cọc

Commit cọc trực tiếp 5a855aa đã chặn vượt phần thỏa thuận. Slice receipt tiếp theo nối actual Resident trước account/external payer, phân bổ canonical và hoàn excess; migration 8 chỉ chạy disposable. Không đánh dấu toàn bộ Phase 7/10/13 hoàn tất: full-excess Main, adjustment/reversal, external principal và real UI/provider vẫn còn như kết quả kiểm chứng.

## 11/11/2026 — Phase 13: hồi quy đầy đủ local

Đã chạy full solution backend + full Owner/Mobile tests trên môi trường tách biệt, bổ sung digital-signing suite ngoài solution, Mobile web export và SQL-log independence. Sửa các lỗi thực tế của DI test host, mapping nguồn offline, đối soát allocation cọc được chuẩn hóa, property schema refresh và các tham chiếu RoomType cũ trên UI. Giữ kiểm tra quyền/immutable/native guards; không sửa dữ liệu làm việc. CI bổ sung PostgreSQL riêng, query log không bind parameters, runsettings giới hạn worker, Mobile typecheck/export và digital-signing unit.

Phase 13 vẫn còn browser E2E thực, nghiệm thu native, bộ ảnh/model OCR được pin và provider thật. Phase 7/8/10 vẫn cần adjustment-created excess/canonical reversal, principal deposit refund cho external payer, payer có Resident ngoài cohort và thông báo receipt refund. Không đánh dấu toàn bộ yêu cầu hoàn tất chỉ vì regression local đã PASS.

## 12/11/2026 — Receipt refund notifications

Đã hoàn tất slice thông báo receipt refund qua committed history, scoped inbox, reauthorized target, Owner Web source-receipt navigation và Tenant own-refund history; external/pre-account không tạo tài khoản. Kênh ngoài kiểm lại eligibility trước gửi. Local regression đã ghi ở results; chưa có browser/provider acceptance mới. Các gap adjustment/reversal, external principal, payer ngoài cohort và các phần Phase 13 còn lại vẫn cần tiếp tục.

## 12/11/2026 — Người nhận Security Deposit

BR-30 đã được người dùng quyết định: theo thỏa thuận hợp đồng, Owner xác nhận. Đã nối UI/basis lịch sử và kiểm thử recipient hợp lệ hiện hữu. Tiếp theo sửa thông báo để đúng beneficiary, rồi mở rộng receiver ngoài cohort/external theo mô hình phù hợp; không áp rule actual payer của receipt excess sang principal.
