# Triển khai staging để demo PR #163 — 24/11/2026

## Phạm vi và quyết định

Người dùng yêu cầu đưa code PR #163 lên staging ngay để demo và xử lý CI sau. Đây là triển khai thủ công tạm thời; không sửa/tắt CI, không merge PR vào develop, không push hoặc triển khai Production.

Truy vết: BF-04 / UC-17 (bàn giao phòng), GBR-01/02/04/07 (phân quyền, bằng chứng ký, chỉ số được xác nhận), NFR bảo mật/khôi phục. Kiểm tra AGENTS.md, diff PR, workflow CI/release, controller/service/repository bàn giao và scripts triển khai hiện hữu. Lượt này triển khai code có sẵn, không bổ sung chính sách nghiệp vụ.

Nguồn PR: `member/THuy`, commit `c4860aa44caca6795b55bb4022375dc45d8fd1f5`; PR đang mở vào develop. CI run `45340509056` lỗi ở `dotnet test` và `npm test`; build trước đó đã qua. Chưa điều tra/sửa toàn bộ test lỗi và không coi bộ kiểm tra chọn lọc dưới đây là CI đầy đủ.

Bản dựng riêng lấy archive đúng commit PR và giữ các patch đã triển khai staging cùng ngày: mở mẫu hợp đồng, bỏ cảnh báo mẫu và sửa nhận diện tài khoản nhận tiền Test. Không lấy toàn bộ working tree hiện tại. Patch và checksum nguồn được lưu trong `source-provenance.json` cùng `retained-staging-hotfixes.patch`.

## Thay đổi runtime

- API: `bhome/pr163-api:demo-20261124`, kế thừa `bhome/receiving-account-fixed:20261124`, cập nhật assembly Application/Infrastructure đã build Linux từ nguồn ghép. PR không đổi dependency graph, API host, Domain hoặc schema.
- Owner Web: `bhome/pr163-owner:demo-20261124`, bundle Staging dựng mới, metadata revision đúng commit PR và label ghi rõ hotfix được giữ lại.
- URL: https://owner-staging.103.146.23.157.sslip.io/login
- Chỉ recreate API và Owner Web staging. Không migration/seed; Public, PostgreSQL/MinIO, Production và các container được bảo vệ không recreate theo snapshot.
- Không phát hành Mobile native/EAS update. Các thay đổi Mobile/proxy có trong nguồn dựng riêng và được kiểm thử, không phải một bản ứng dụng native đã cài trên thiết bị.

## Kiểm chứng đã chạy

- Docker API Release build: PASS.
- Docker Owner Web build và `Verify-WebArtifact.cjs`: PASS.
- Application unit: filter `FullyQualifiedName~Handover|FullyQualifiedName~MoveInInventory`: **52 PASS, 0 fail, 0 skip**.
- Owner Web: `OwnerHandoverDraftPanel`, `Handovers`, `Automation`: **71 PASS**.
- Mobile: `contract-detail-types`, `contract-sections`, `meter-flow`, `move-in-draft-handover`, `stagingMobileProxy`, `expoStartup`: **153 PASS**.
- VPS smoke trước/sau: HTTPS, public read, anonymous auth rejection, cross-environment CORS rejection, unsigned SePay webhook rejection, synthetic login/refresh rotation/authorized read/logout: PASS.
- Probe chỉ đọc trước/sau: inbox bàn giao 200; 3 draft và 3 PDF bàn giao đọc thành công; cấu hình hợp đồng và thanh toán ban đầu 200. Hợp đồng fixture đã `Settled` cả trước/sau; không cấp QR mới, ghi giao dịch hoặc kích hoạt để kiểm tra.
- Owner release metadata khớp commit PR; protected snapshot sau triển khai PASS; worker exit 0 và `PR163_STAGING_DEMO_DEPLOY_PASS`.

Đã giữ dump database (kiểm tra danh mục bằng pg_restore), backup private config và manifest/image trước triển khai. Có rollback tự động nếu readiness/smoke/probe lỗi; không kích hoạt rollback trong lần triển khai thành công này. Chưa diễn tập khôi phục database hay rollback của bản PR163.

## Giới hạn và evidence

`fallbackTemplateAvailable=false` đã có trước triển khai và giữ nguyên sau triển khai; cấu hình renderer JSON dự phòng thiếu TemplateId đã được ghi trong báo cáo mở mẫu hợp đồng. Probe bàn giao đọc được PDF thực tế; không khẳng định đã sửa renderer dự phòng hoặc kiểm chứng mọi luồng ký/thanh toán end-to-end.

CI đầy đủ vẫn lỗi và cần xử lý sau demo. Không thay `staging/current.json` của luồng CD chuẩn bằng kết quả CI xanh giả; `deployed.json` riêng ghi rõ đây là operator demo deployment và các image thực tế. Lần CD tiếp theo cần chứa các hotfix còn chưa commit để không ghi đè chúng.

Evidence VPS: `/opt/bhome-deploy/operator-pr163-demo-20261124/`: checksum artifact, nguồn patch/provenance, backup private, manifest trước, protected snapshot, build/deploy logs, probe trước/sau và `deployed.json`. Backup chứa dữ liệu riêng tư chỉ giữ private trên VPS; không đưa vào repository/báo cáo.

Evidence local: `.tools/pr163-staging/`: nguồn dựng riêng, build logs, TRX/test logs và manifest kết quả. Không sửa hoặc checkout đè working tree đang có thay đổi của người dùng.

## Khắc phục màn hình trắng sau triển khai

Người dùng phát hiện trang login trắng. Kiểm tra trình duyệt thật xác nhận các JS/CSS trả 404. Nginx log có `Permission denied`: thư mục assets trong artifact được giải nén dưới umask 077 có mode 700/root; image kế thừa Nginx chạy UID 101 nên không đọc được. HTTP 200 của `/login` và test component trước đó chưa đủ phát hiện lỗi tài nguyên thực tế.

Đã sửa quyền đúng phạm vi static files: thư mục 755, file 644; đóng gói image `bhome/pr163-owner:demo-static-fixed-20261124`, giữ runtime UID 101. Chỉ recreate Owner Web và kiểm tra protected snapshot PASS. Script package cũng chuẩn hóa quyền trong Dockerfile để tránh lặp lỗi. API/data/schema không đổi trong lượt sửa.

Playwright chạy trên URL HTTPS thật ở viewport 1440 và 390: login fields/button hiển thị; mỗi viewport tải 6 JS/CSS thành công, 0 asset failure, 0 page error và không tràn ngang. Đã xem cả hai screenshot `login-fixed-1440.png`, `login-fixed-390.png`; summary tại `.tools/pr163-staging/browser-fixed.json`. Đây là kiểm tra render trang login; không khẳng định đã chạy thêm browser login/dashboard end-to-end trong lượt sửa này.
