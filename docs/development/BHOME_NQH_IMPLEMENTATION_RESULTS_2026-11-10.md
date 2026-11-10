# Kết quả triển khai BHOME NQH

Kế hoạch và quyết định mang ngày yêu cầu 10/11/2026; thực thi tiếp tục ngày 11/11/2026. Không coi kết quả unit/API là UI E2E.

## Commits và bằng chứng theo phase

| Phase        | Thay đổi                                                                                                                                                                                                                    | Verification                                                                                                              | Commit                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0            | Baseline, matrix BR-01–29, quyết định thay thế SRS/audit và external blockers                                                                                                                                               | Git baseline + đọc source/CI/contracts; docs format                                                                       | e7d86c0 docs(plan): map approved business changes |
| 1 foundation | Resident contact_email + case-insensitive uniqueness; anonymous invitation/history mapping; signing mode/evidence không cần user giả; Active metadata cho Holding trước account; migration additive, baseline cũ giữ nguyên | dotnet restore PASS; Release build PASS; disposable upgrade/data preservation/email-conflict + runtime snapshot: 2/2 PASS | Xem local commit feat(db) tương ứng               |

Phase 1 chưa được công nhận toàn bộ demo-ready: MinIO/Docker và provider access chưa có; demo scenarios và E2E tiếp tục các phase sau. Database làm việc không migrate/seed.

## Chi tiết phase 1

- BR-01/05/07, UC-13/14/15: Domain Resident.ContactEmail; Contract.SigningMode/InternalAcceptance; ContractSigningInvitation lưu hash/session/OTP state và evidence references trong contracts.history, không raw token/password.
- Physical schema vẫn 24 bảng. Chỉ thêm contact_email/index và thay active constraint để Holding không đòi tài khoản Tenant. Service signing/payment gates vẫn bắt buộc; không dùng SQL để kích hoạt demo contract.
- LifecycleAlignment migration giữ nguyên immutable InitialCompact24 baseline. Canonical fresh DDL và generated EF snapshot đồng bộ.
- Test LifecycleMigrationTests tạo database tên bhome_compact24_<random>, migrate baseline, giữ account qua upgrade, kiểm email khác hoa/thường bị từ chối, replay migration không mất data, rồi chỉ xóa database test do test tự tạo.
- Một invocation filter ban đầu match thêm PostgresFoundationTests dùng Docker: 1 test BLOCKED bởi DockerUnavailable, 2 test liên quan PASS. Chạy lại filter đầy đủ namespace: 2/2 PASS. Không skip/delete assertion.

## External readiness

| Dependency                             | Status                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| MySign sandbox                         | BLOCKED — người dùng chưa có access                                |
| Bank sandbox/provider contract         | BLOCKED — người dùng sẽ bổ sung                                    |
| OTP/invitation Email/SMS thật          | BLOCKED — chưa có delivery credentials                             |
| Docker/MinIO/PDF container integration | BLOCKED — chưa có Docker daemon; tiếp tục kiểm tra phương án local |
| Native Android/iOS UI E2E              | NOT RUN                                                            |

NOT PUSHED — USER PUSH REQUIRED.
