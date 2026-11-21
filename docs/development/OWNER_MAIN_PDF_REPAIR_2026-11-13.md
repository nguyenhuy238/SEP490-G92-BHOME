# Sửa PDF và quy trình ký Main trên Owner Mobile

## Truy vết và phạm vi

Yêu cầu trực tiếp ngày 13/11/2026; BF-03/04, UC-15/16, GBR-04, BR-07/09 và BR-26 trong quyết định 10/11. Sửa Owner Mobile và thành phần hợp đồng dùng chung tối thiểu; không sửa policy/hash backend, Staff/Tenant hoặc Owner Web. Kiểm tra Git trước sửa: sạch, nhánh `member/QHuy`, base `b0982ed8`.

## Nguyên nhân xác nhận từ source

- `ContractPdfPreview` gom mọi 409 thành lỗi đổi tài liệu; retry chỉ tăng revision, gọi lại cùng fileId. Backend `CopyFileAsync` trả `draft_document_outdated` khi SnapshotHash tệp khác contract; validation này giữ nguyên.
- `MainDraftScreen.save(false)` giữ documents và component review cũ sau lưu mới; quay lại preview có thể tái sử dụng tệp thuộc snapshot trước. MainDraftService.SaveAsync cập nhật version/snapshot; ReleaseAsync cũng đổi signing mode/snapshot. Không quy mọi 409 thành outdated: configuration/template/version có mã riêng và hành động khác nhau.
- Web openFile luôn đặt anchor.download; không có nhánh xem PDF, URL bị revoke sau 1 giây. Không phải lỗi quyền MinIO đã được chứng minh.
- MobileApi đã có deadline 60 giây cho generation/page và 15 giây thường; bổ sung giới hạn độc lập của viewer cho custom bridge/transport không hoàn tất. Không tự retry POST generation. Chưa có browser Network capture từ phiên người dùng tại localhost:8081; không khẳng định renderer/storage thực tế của phiên đó hỏng.

## Tiêu chí nghiệm thu

| Vùng           | Kiểm tra                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Preview        | metadata/page timeout, first page, không tạo request theo rerender, abort và bỏ response cũ                                   |
| Conflict       | đúng code; outdated bỏ file, tải draft mới, regenerate có kiểm trạng thái; configuration/template yêu cầu save/review rõ ràng |
| PDF            | Xem/Tải riêng, authenticated bytes, MIME/signature, popup failure, Blob lifecycle, cache native cleanup                       |
| Review/signing | đúng version/file, clear checkbox khi tệp đổi, release chưa phải ký, trạng thái/payment/readiness từ backend                  |
| Regression     | Vitest Mobile, lint/typecheck/format, backend existing PDF/release tests nếu môi trường cho phép                              |

## Kết quả

Giai đoạn 1: `a5d46ae` — bounded preview metadata/page, phân biệt conflict, hủy request cũ, bỏ stale documents khi save, khôi phục theo latest draft, tách Xem/Tải PDF qua authenticated bytes; kiểm MIME và signature, cleanup Blob/cache. Lint, typecheck và format PASS; full Mobile 99 files / 1.071 tests PASS; recovery test mới chạy riêng 14/14 PASS sau đó. Không thay backend source.

Giai đoạn 2: Owner Main có bốn bước riêng; bước duyệt nháp yêu cầu PDF hiện tại đọc được, xóa checkbox khi lỗi hoặc file/version đổi, re-read draft trước generation/release. Không coi release là ký. OwnerMainContractFlow dùng trạng thái MySign/chấp thuận nội bộ theo signingMode, số cọc/readiness backend và actions hiện có. Owner route nhận draft không còn Draft chuyển về contract thật, không giữ mainDraftId cũ. Staff/Tenant giữ flow và nhãn bước đang có.

API deposit-payment hiện chỉ trả position/reference; chưa có endpoint QR cọc. Không tạo QR giả hoặc dùng QR invoice thay cọc. Theo dõi tiền cọc và xác minh dùng endpoint hiện có; activation vẫn phụ thuộc readiness backend.

Giai đoạn 2: `1d9b15f`; lint/typecheck/format PASS; Mobile 100 files / 1.075 tests PASS. Backend: 1 release workflow PASS và 6 preview/release-negative tests PASS. MySign trong fixture là simulator; không phải bằng chứng ký provider thật.

Giai đoạn 3: Owner không hiển thị UUID nháp; summary ngắn, nhãn Duyệt & ký rõ ràng. Viewer dùng cache PNG chỉ trong vòng đời document, xóa khi background/document đổi, tránh render lại trang 1 khi mở/đóng fullscreen. Xem PDF hợp lệ bên ngoài có thể mở bước review khi rasterizer không sẵn sàng; vẫn phải human-confirm PDF chính xác trước release. Recovery chỉ rõ Tải phiên bản mới hoặc Lưu lại bản nháp theo mã lỗi.

Đã chạy toàn bộ MainDraftApiTests: 13 PASS, có LibreOffice thực và PDF→PNG trong container, MIME/file integrity, tenant/outside access denial và snapshot outdated. Không sửa backend hoặc dữ liệu người dùng.

Giai đoạn 3: `5849033`; lint/typecheck/format PASS; Mobile 100 files / 1.075 tests PASS và viewer regression 10/10 PASS (bổ sung case xem PDF ngoài sau đó). Đã xem ảnh preview 390px và PendingSigning 320px. Sau QA điều chỉnh footer Owner xếp nút đủ rộng để không cắt nhãn ở 320px; Staff giữ layout cũ.

## Regression và bằng chứng cuối

| Kiểm tra                                            | Kết quả và giới hạn                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / Mobile typecheck / format / diff check       | PASS                                                                                                                                                                                            |
| Mobile Vitest                                       | 100 files / 1.083 tests PASS                                                                                                                                                                    |
| Owner Web contracts                                 | 15 files / 56 tests PASS; không sửa Owner Web                                                                                                                                                   |
| Backend MainDraftApiTests                           | 13 PASS trên PostgreSQL/MinIO Testcontainers, gồm PDF/PNG thật qua LibreOffice/converter container, auth, stale snapshot, tampering và release                                                  |
| Backend MainDraftPreviewTests                       | 5 PASS (unit trong project IntegrationTests): invalid PDF, page bounds/dimensions, unavailable renderer                                                                                         |
| Workspace build                                     | PASS; warning chunk size Owner Web hiện có                                                                                                                                                      |
| Expo web export                                     | PASS với EXPO_NO_DOTENV và API origin tổng hợp; output ignored                                                                                                                                  |
| Chrome UI regression                                | PASS, transport tổng hợp: outdated 409 → GET draft mới → generate fileId mới → inline page → Blob reader → PDF download → signing review → một release → PendingSigning và mainDraftId được xóa |
| Live localhost:8081 / API session của người báo lỗi | NOT RUN; không có listener 8081/7240 khi kiểm tra đầu phiên, không có contract ID hoặc phiên xác thực live được cung cấp                                                                        |
| Android/iOS native                                  | NOT RUN trên thiết bị; native cache/share cleanup đã có component tests                                                                                                                         |
| MySign / SMTP / bank provider thật                  | NOT RUN; không tuyên bố ký hoặc thanh toán thành công                                                                                                                                           |

Browser regression lưu request paths/methods, PNG và PDF tổng hợp ở `.tools/owner-pdf-validation/` (ignored). Đã xác minh chỉ gọi metadata fileId cũ một lần, generation đúng hai lần do user recovery, release đúng một lần; không unexpected API request hoặc page error. Browser API responses là synthetic test transport; không thay API production bằng mock. PDF download có MIME và `%PDF-` hợp lệ; PNG synthetic chỉ kiểm tra viewer UI, việc rasterize thật được kiểm tra riêng trong backend tests.

Các case bổ sung: metadata 15 giây/page 50 giây không kết thúc vẫn thoát loading, response cũ bị bỏ, mở fullscreen dùng lại trang 1 trong memory, popup blocked, Blob revoke khi đóng, MIME sai, signature sai, native cleanup, configuration conflict chuyển về sửa/lưu nháp, draft không còn Draft chuyển về chi tiết, latest version thay trước release xóa review và không gửi release, readiness false luôn chặn activation dù UI có đủ signature/deposit indicators. Không tự retry POST sau timeout không xác định.

## Các tệp chính

- Preview/loading/recovery: `ContractPdfPreview.tsx`, `pdfPreview.ts`, `MainDraftScreen.tsx`, `MainDraftSigningReview.tsx`.
- View/download: `webContractDocument.ts`, kiểm MIME giới hạn ở draft document bytes trong `src/mobile/src/lib/api.ts`.
- Owner workflow/navigation: `ContractScreen.tsx`, `RentalContractStepper.tsx`, `features/owner/OwnerMainContractFlow.tsx`, `ownerContractSteps.ts`.
- Tests: `contract-pdf-preview`, `pdf-preview` hiện có, `contract-document-timeout`, `main-draft-screen`, `rental-contract-flow`, `contract-sections`, `owner-main-contract-flow`, `web-contract-document` trong `src/mobile/src/__tests__/`.
- Tài liệu này. Không thay packages/client-core, backend, migrations, Staff/Tenant screens hoặc Owner Web.

## Giới hạn còn lại

- Cần mở lại đúng contract trên localhost:8081 với API đang chạy để xác nhận lỗi runtime của phiên người dùng; source/tests chứng minh cơ chế gây retry sai fileId, không chứng minh MinIO/LibreOffice live đang lỗi hay chậm. Nếu còn lỗi, lấy status/code và timing (không token/PII) của documents/preview/pages ở phiên đó.
- MainDraftRenderer chỉ cho signing-review template ở Development/Testing; production cần mẫu hợp đồng được duyệt. Không sửa guard này.
- Backend chưa cấp QR cọc Main trong các endpoint hiện có. Mobile không tự tạo QR hoặc suy payment success.
- MySign yêu cầu credentials/provider acceptance thật. Internal mode chỉ dùng khi server trả INTERNAL_OTP_DRAWN; release vẫn khác ký; không tự thay phương thức ký của Main.
