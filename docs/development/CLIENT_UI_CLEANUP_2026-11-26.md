# Điều chỉnh giao diện xác thực và tổng quan — 26/11/2026

## Quyết định và truy vết

Nguồn thay đổi: yêu cầu trực tiếp của người dùng ngày 26/11/2026.

| Yêu cầu                                            | Phạm vi và nguồn liên quan                                                                                                           | Thành phần                                                                        | Nghiệm thu                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bỏ khôi phục mật khẩu SMS trên Owner Web và Mobile | FE-02 Authentication, UC-01/UC-02, GBR-02/13; `docs/api/AUTHENTICATION_EMAIL.md`, `docs/testing/PASSWORD_RECOVERY_FIX_2026-11-15.md` | LoginPage, router Owner Web, route forgot-password Mobile                         | Không còn màn hình/link SMS; đường dẫn cũ mở khôi phục email; API email, lỗi và phản hồi chung vẫn được kiểm thử                                                   |
| Bỏ cấu hình MySign                                 | BF-03/BF-04, GBR-04; yêu cầu này gỡ giao diện cấu hình, không thay quy tắc ký/kích hoạt hợp đồng                                     | AppShell, route digital-signing, ContractDetailPanel và các luồng hợp đồng Mobile | Không có menu/trang/nút khai báo MySign; URL cũ về quản lý hợp đồng; giữ kiểm thử deep link và lịch sử điều hướng hợp đồng                                         |
| Đổi vị trí hồ sơ/thiết bị cần chú ý                | Owner overview, NFR UX; `src/owner-web/DESIGN.md`                                                                                    | LiveDashboardPage, LifecycleAttention                                             | Ưu tiên khai thác, phòng và kinh doanh trước; khối theo dõi ở cuối; hai cột desktop, một cột màn hình hẹp; giữ liên kết, loading, lỗi/thử lại và giá trị chưa biết |

Không đổi API, schema, cấu hình provider hay quy tắc xác minh chữ ký/thanh toán. Tài liệu ký hiện tại vẫn mô tả khả năng MySign ở backend; việc gỡ giao diện cấu hình theo yêu cầu này không xác nhận backend đã xóa khả năng đó.

## Kiểm tra

Thực hiện bằng Node 22 trong `.tools/node-v22.23.4-win-x64`, theo các lệnh frontend của `.github/workflows/ci.yml`.

| Kiểm tra                                                  | Kết quả                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` toàn repository                            | PASS, 0 lỗi/cảnh báo                                                                                                                                           |
| `npm run format:check` toàn repository                    | PASS                                                                                                                                                           |
| `npm run typecheck --workspace ./src/mobile`              | PASS                                                                                                                                                           |
| `npm run build --workspace ./src/owner-web`               | PASS; có cảnh báo kích thước chunk trên 500 kB, không làm build thất bại                                                                                       |
| Toàn bộ Mobile tests, `--maxWorkers=2`                    | PASS: 164 files, 1.761 tests, 0 failed/skipped; JUnit `.tools/ui-cleanup-mobile-tests.xml`                                                                     |
| Toàn bộ Owner Web tests                                   | PASS: 140 files, 1.059 tests, 0 failed/skipped; JUnit `.tools/ui-cleanup-owner-tests.xml`                                                                      |
| `expo export --platform web --max-workers 2`              | PASS; output `.tools/ui-cleanup-mobile-export`                                                                                                                 |
| Browser Owner Web, 1440×1000 và 390×844, dữ liệu tổng hợp | PASS: login không có SMS, URL cũ mở email, khối cần chú ý sau kinh doanh, đúng 2/1 cột, không tràn ngang, liên kết cao tối thiểu 44px, không có lỗi JavaScript |
| Browser Mobile web bundle, 390×844                        | PASS: login → Quên mật khẩu → form email → phản hồi chung; một lời gọi API email, không gọi SMS                                                                |
| `git diff --check`                                        | PASS                                                                                                                                                           |

Ảnh kiểm tra: `.tools/ui-cleanup-preview/`. Browser và HTTP server phục vụ kiểm tra đã được đóng. Không khởi động backend để kiểm tra giao diện. Native Android/iOS và GitHub Actions chưa chạy trong lần chỉnh sửa này.

Lần chạy đầu phát hiện biến `signer` thừa, hai test quản lý chứng thư đã bị gỡ và tên heading demo khác chế độ API trong test mới. Đã sửa các điểm này và chạy lại kiểm tra liên quan. Không sửa workflow CI hoặc giảm mức kiểm tra để xử lý lỗi.

## File thay đổi

- Owner Web xác thực/điều hướng: `src/app/router.tsx`, `src/app/router.test.tsx`, `src/components/layout/AppShell.tsx`, `AppShell.test.tsx`, `src/features/auth/pages/LoginPage.tsx`, `LoginPage.test.tsx`; xóa `SmsRecoveryPage.tsx` và test riêng.
- Owner Web hợp đồng: `src/features/contracts/ContractDetailPanel.tsx`, `ContractActionDialog.tsx`; xóa `pages/DigitalSigningPage.tsx`; chuyển test điều hướng hợp đồng còn áp dụng từ `DigitalSigningPage.test.tsx` sang `ContractsNavigation.test.tsx`.
- Owner Web tổng quan: `src/features/dashboard/LifecycleAttention.tsx`, `pages/LiveDashboardPage.tsx`, `LiveDashboardPage.test.tsx`.
- Mobile xác thực: `src/app/forgot-password.tsx`, `src/__tests__/password-recovery.test.tsx`; xóa `src/screens/SmsPasswordRecoveryScreen.tsx`; giữ test inbox SMS độc lập trong `src/__tests__/demo-sms-inbox.test.tsx` thay cho tên `sms-recovery.test.tsx`.
- Mobile hợp đồng: `src/features/contracts/ContractActionForm.tsx`, `ContractScreen.tsx`, `ContractSigningStep.tsx`, `HoldingContractFlow.tsx`, `RentalContractFlow.tsx`, `src/features/owner/OwnerMainContractFlow.tsx`; cập nhật `src/__tests__/holding-signing-flow.test.tsx`, `owner-main-contract-flow.test.tsx`, `tests/mobile/ocr/signing-ui.test.tsx`.
- Tài liệu: file này. Các đường dẫn bắt đầu `src/` ở mỗi nhóm được tính từ ứng dụng tương ứng; `tests/mobile/ocr/signing-ui.test.tsx` tính từ repository root.
