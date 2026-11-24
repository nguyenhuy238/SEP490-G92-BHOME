# Sửa tài khoản nhận tiền cho hóa đơn trên Staging — 24/11/2026

## Nguyên nhân và truy vết

BF-06 / UC-22 / GBR-01/02/10/18; đối chiếu `AGENTS.md`, `docs/api/PAYMENTS.md`, `TransferInstructionsService`, `PaymentCodeRegistry`, repository tài khoản Owner, cấu hình môi trường và test SePay hiện có.

Đúng hóa đơn người dùng báo lỗi có dư nợ 13.232.000 VND. Tài khoản Owner phiên bản 2 đã bật và đánh dấu Test; hợp đồng dùng `PaymentMode=Test`. Backend vẫn trả `ReceivingAccountUnavailable` vì nhánh đọc hướng dẫn hóa đơn chỉ kiểm `AllowDevelopmentDemo`, bỏ sót `AllowSandboxReceivingAccounts` đã có để dùng SePay Test trên Staging. Đây là lỗi điều kiện đọc, không phải tài khoản Owner chưa lưu.

## Thay đổi

`TransferInstructionsService.GetAsync` chấp nhận tài khoản Test khi một trong hai capability hợp lệ cho phép: Development demo hoặc Sandbox receiving. Giữ nguyên DI kiểm môi trường: Staging chỉ nhận Sandbox khi SePay Test bật; Production không được mở tài khoản Test bằng thay đổi này. Không mở thanh toán demo thủ công, sửa tài khoản Owner, thay tiền, sửa Final Invoice hoặc đổi trạng thái thanh toán.

Registry vẫn yêu cầu tài khoản đang bật và khớp binding SePay trước khi cấp QR/mã BH; sai binding vẫn `PaymentCodeUnavailable`. Phân quyền Owner/Tenant và quyền trên hóa đơn giữ nguyên. Không đổi endpoint/DTO/schema; Owner Web/Mobile hiện tại đọc được response sau khi tải lại, không cần phát hành frontend.

## Kiểm chứng

- PostgreSQL 16 disposable, nguồn Release đúng Staging: **6 PASS, 0 fail, 0 skip**. Ba nhánh nhận tài khoản (Development, Sandbox Staging, không có capability), tài khoản Owner chung, QR/BH lặp ổn định, tiền/trạng thái không thay đổi, account drift bị chặn, exact receipt, Tenant khác/Location khác và receipt Test vào nghĩa vụ Live vẫn bị từ chối. Các callback trong test dùng payload tổng hợp; không gửi giao dịch tới ngân hàng.
- Infrastructure `PaymentRuntimeModeTests`: **8 PASS**, không skip; Development/Testing, Staging Test bật/tắt, Production Test/Live và không bật manual demo trên Staging.
- Build portable `.NET 8` Application Release từ nguồn Staging đã giữ các hotfix: **PASS**, 0 warning/error. Assembly này không có thay đổi dependency hoặc native code.
- `dotnet format whitespace --verify-no-changes` hai file C# sửa và `git diff --check`: PASS sau khi chuẩn hóa whitespace initializer trong test.
- Lượt test đầu lỗi do các case dùng chung Owner fixture nhưng giả định account version 0; lượt tiếp theo cho thấy profile account làm ảnh hưởng mã thanh toán giữa các case. Đã tách mỗi case account vào database disposable riêng và lấy version thực tế; 6 ca cuối đều qua. Không sửa guard runtime để vượt fixture.
- `postman status` trước/sau: CLI có sẵn nhưng không có workspace/account binding. Dùng integration HTTP hiện hữu và probe private trên VPS; không khởi tạo/publish workspace hoặc gửi credential/thông tin tài khoản lên Postman. Áp dụng hướng dẫn `postman:api-engineer` và `postman:api-testing` cho contract/verification; không gọi provider ngoài để kiểm thử.

Evidence local `.tools/invoice-receiving-staging/`: unit TRX, `staging-tests-final/`, build/format logs, checksum/provenance và probe trước/sau. Không chạy CI toàn bộ.

## Triển khai và kết quả thực tế

API kế thừa `bhome/billing-manual-api:20261124`, cập nhật riêng Application assembly/PDB từ nguồn PR163 `c4860aa44caca6795b55bb4022375dc45d8fd1f5` cộng hotfix đã triển khai trước; image mới `bhome/invoice-receiving-api:20261124`. Chỉ recreate API Staging, giữ cờ manual billing hiện hành, không đổi cấu hình SePay, Production, Owner Web/Public, database/storage hoặc schema.

Worker `/opt/bhome-deploy/operator-invoice-receiving-20261124/` exit 0. Đã backup DB/release config, kiểm danh mục dump, checksum assembly trong container và protected snapshot trước/sau; HTTPS/auth/CORS/webhook smoke và probe bàn giao/PDF/thanh toán đều PASS. Có đường rollback API/config khi lỗi; chưa diễn tập restore/rollback riêng cho bản này.

Trên đúng hóa đơn: sau deploy API trả **Available**, có QR và mã BH; ngân hàng/số tài khoản khớp tài khoản Owner đã lưu. Hai lần đọc trả cùng mã. Trạng thái tài chính trước/sau hoàn toàn không đổi: **đã trả 0 VND, còn nợ 13.232.000 VND**. Probe chỉ đọc/cấp hướng dẫn, không tạo receipt, phân bổ hay xác nhận đã thanh toán.

Người dùng tải lại màn thanh toán (web dùng Ctrl+F5) rồi mở lại hóa đơn để nhận QR. Tiền chỉ được ghi nhận sau đối soát backend. Không commit/push/merge; lần phát hành chuẩn tiếp theo cần chứa hotfix để không ghi đè.

File sửa trong lượt này: `src/backend/BHome.Application/PaymentsDebt/TransferInstructionsService.cs`, `tests/backend/BHome.IntegrationTests/Compact24/SePayIntegrationTests.cs`, `docs/api/PAYMENTS.md` và báo cáo này. Các thay đổi sẵn có trong working tree được giữ lại.
