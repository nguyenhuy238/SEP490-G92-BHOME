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
