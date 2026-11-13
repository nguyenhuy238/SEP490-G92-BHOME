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

Cập nhật theo lệnh thực chạy và commit từng giai đoạn; chưa tuyên bố provider/MySign/bank E2E.
