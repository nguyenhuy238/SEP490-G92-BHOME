# BE-20 — hồi quy OCR ngày 06/11/2026

Truy vết UC-20 / GBR-07 / mục tiêu NFR xử lý OCR hoặc fallback trong 10 giây. Scope: nhánh automatic analysis trong OnnxOcrEngine và bài HTTP model thật hiện hữu; không đổi API/schema/model weights, quyền hoặc quy tắc xác nhận chỉ số.

Full backend run trước slice đạt Domain 90, Application 250, Integration 612 và skip một bài model thật theo opt-in. Sau khi xác minh local có model pinned và ảnh public cần thiết, đã bật BHOME_OCR_LOCAL_EVALUATION_ROOT và chạy riêng bài đó. Ảnh nước và ảnh điện thẳng đạt; ảnh GELEX xoay 180° thất bại. Diagnostic assertion xác định classificationStatus=unavailable, warning=ocr_timeout, không phải kết quả một bộ phân loại thiếu tin cậy.

Nguyên nhân: sau neutral analysis và correction hướng ảnh, automatic path nhận dạng lại tất cả text boxes khi áp meter profile. Các crop dùng bucket 320 tạo cùng tensor đầu vào và cùng model ở hai lần gọi; việc tính lại làm hết deadline mặc định 8 giây trên máy test.

Thay đổi: giữ raw recognition trong dictionary cục bộ của một lần analysis/một hướng ảnh; chỉ tái sử dụng khi natural width ở height 48 không vượt 320. Vùng rộng phải nhận dạng lại vì neutral pass có thể dùng bucket 640 hoặc word splitting. Hướng xoay có dictionary riêng; không giữ cache giữa request, người dùng hoặc ảnh. Meter splitting, numeric refinement, conflict guards và human confirmation vẫn chạy. Explicit profile không cấp cache, giữ nguyên đường xử lý. Version bổ sung hậu tố cache1 để truy vết pipeline; không đổi checksum model.

Cache dựa vào điều kiện đầu vào giống hệt nêu trên để giữ nguyên semantics cả dòng có số. Không tăng deadline, giảm confidence hoặc bỏ assertion ảnh xoay. Assertion lỗi chỉ bổ sung status/warning, không log OCR text, ảnh hoặc dữ liệu identity; bổ sung kiểm requiresReview/requiresConfirmation/confidence null và resource lookups bằng 0.

Đã thực thi trên bản cuối:

- BHOME_OCR_LOCAL_EVALUATION_ROOT=<repository>, dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter FullyQualifiedName~RealModelsReadWaterThroughDiagnosticHttpAndResolveElectricLabelWithoutPersistence --verbosity minimal: **1/1 PASS, 0 skip**, với model ONNX thật đã được loader kiểm SHA-256; nước + điện thẳng + điện xoay. Auth/resource adapters là test boundary có nhãn, không phải nghiệm thu phân quyền production.
- dotnet test tests/backend/BHome.Application.UnitTests --no-build --no-restore --filter FullyQualifiedName~Ocr --verbosity minimal: **125/125 PASS**.

Lượt regression OCR đầu không truyền test-admin nên 5 Compact24 capture tests skip theo guard; không coi các bài đó là đã chạy. Rerun với BHOME_COMPACT24_TEST_ADMIN trỏ PostgreSQL loopback riêng, dotnet test tests/backend/BHome.IntegrationTests --no-build --no-restore --filter 'FullyQualifiedName~BHome.IntegrationTests.Ocr&FullyQualifiedName!~RealModelsReadWaterThroughDiagnosticHttpAndResolveElectricLabelWithoutPersistence' --verbosity minimal: **119/119 PASS, 0 skip**, 17 giây. Bài model thật chạy riêng như trên để không trộn contention do chạy song song với phép kiểm request deadline. Không tăng giới hạn sản phẩm để làm test pass.

Giới hạn: smoke public này không phải holdout >=50 ảnh, không chứng minh accuracy >=90% hoặc p95/load. Deadline vẫn có thể trả manual fallback dưới tải/ảnh khó; không tự nâng proposal thành confirmed reading. Không lưu ảnh CCCD, không đưa real identity vào test hoặc gọi AI/external provider. Owner Web/Mobile không đổi; cần native camera/device acceptance và reviewer. Task BE-20 vẫn PARTIAL.
