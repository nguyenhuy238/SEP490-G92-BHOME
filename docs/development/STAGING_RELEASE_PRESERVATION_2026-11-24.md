# Giữ cấu hình và hotfix Staging qua các release — 24/11/2026

## Phạm vi

Người dùng yêu cầu source sau khi merge develop và các lần thành viên khác cập nhật develop không làm mất cấu hình/hotfix đang demo trên Staging. Truy vết NFR phát hành/bảo mật/khôi phục, GBR-01/02/07/10/18 và các hồi quy BF-04/UC-17, BF-05/UC-20/21, BF-06/UC-22. Đối chiếu AGENTS.md, CI/release scripts, các báo cáo demo cùng ngày và script/config thực tế trên VPS.

Không thay nghiệp vụ, schema hoặc dữ liệu tài chính. Toàn bộ hotfix source đã giữ sau pull develop vẫn nằm trong working tree. Lượt này bổ sung cơ chế phát hành và kiểm tra bắt buộc.

## Cấu hình bền vững và preflight

- `/opt/bhome-config/compose.staging-runtime.yml` là private overlay riêng, đặt trước release image override trong Compose. CD không ghi đè file này; không đọc cấu hình staging từ máy thành viên.
- Commission lần đầu chỉ lấy giá trị manual billing đang có trên API Staging (false nếu trước đó chưa có), không sao chép secret từ container. File được tạo exclusive, mode 600. Nếu operator đã tạo file, helper giữ nguyên.
- Release image overlay vẫn được sinh lại với ba image API/Owner/Public. Trước ghi đè file hoặc recreate container, `release-config.py` so toàn bộ cấu hình Compose đã resolve; chỉ cho thay chính xác ba image đã xác minh. Mất cờ, đổi secret, mount/network, image database hoặc service đều chặn trước khi cập nhật ứng dụng. Không in diff chứa secret.
- Những cấu hình private khác vẫn ở các overlay/env-file hiện hành. Nếu có override cũ chưa chuyển khỏi release file, preflight từ chối thay vì âm thầm bỏ nó. Việc thay cấu hình operator cần thao tác riêng, không ghép vào một release chỉ đổi image.
- Rollback giữ lại runtime overlay và dùng release image manifest cũ. Kiểm thử Compose thật đã chạy hai release liên tiếp và phục hồi manifest cũ.

## Hotfix source và image cũ

CI kiểm báo cáo TRX thật bằng `Verify-StagingRegressions.py`. Chín nhóm bắt buộc gồm scope tài khoản Test, runtime payment, manual billing, QR hóa đơn, QR thanh toán ban đầu, ký session/OTP bàn giao và mẫu hợp đồng. Thiếu nhóm, thiếu case theory, skip, fail hoặc chỉ lặp báo cáo của cùng case đều không được chấp nhận.

Job build image phụ thuộc backend/frontend CI. API image có nhãn `io.bhome.staging-regressions=v1`; guard trên VPS từ chối API image cũ thiếu/sai nhãn trước thay container. Build từ source cũ chưa có cơ chế này sẽ bị chặn, giữ bản demo hiện tại. Không sửa label/guard để bỏ qua test. Khi đổi tên/cấu trúc test hợp lệ cần review và cập nhật policy tương ứng.

Đây là bảo vệ trong quy trình deploy bình thường và các hồi quy đã định nghĩa, không thay thế review, bảo vệ nhánh hoặc CI toàn bộ. Để các member thừa hưởng cơ chế này, cần commit/merge **đầy đủ hotfix, test, workflow và scripts mới**; chỉ commit file deploy sẽ khiến guard CI phát hiện thiếu test.

## Hotfix riêng trên VPS được giữ thêm

Đối chiếu checksum trước cài đặt phát hiện `release-safety.py` trên VPS có một sửa đổi chưa có trong Git: chuẩn hóa đường dẫn `/usr/bin/libreoffice` và `/usr/bin/pdftoppm` do Release image cung cấp, tránh coi việc thêm công cụ PDF mặc định là thay private config. Đã đưa phần này vào source và thêm hai test. Chỉ normalize đường dẫn canonical; executable tùy ý vẫn bị từ chối. Không ghi đè mất bản sửa riêng của operator.

## Kiểm chứng đã chạy

| Kiểm tra                                                                                                                                                          | Kết quả                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Python deployment suite trong Linux container, bao gồm Docker Compose thật, private-file permissions, preflight, backup/rollback guards, image label và TRX guard | 46 PASS, 0 skip                               |
| Node deployment suite, gồm CI dependency và image label                                                                                                           | 21 PASS, 0 skip                               |
| Test hotfix backend trên PostgreSQL disposable: runtime/scope unit và các luồng bàn giao, invoice/initial QR, manual billing, DOCX/PDF review/release             | 24 unit + 17 integration PASS, 0 skip         |
| Kiểm tra TRX thực của 41 test trên bằng guard mới                                                                                                                 | PASS đủ 9 nhóm                                |
| Bash syntax cho toàn bộ `deploy/vps/*.sh`                                                                                                                         | PASS                                          |
| Commission trên VPS: Compose trước và candidate image manifest mới                                                                                                | Chỉ image được phép thay; cấu hình giữ nguyên |
| Snapshot environment/protected containers và ID/image/start time của API/Owner/Public trước/sau commission                                                        | Giữ nguyên                                    |

Tổng các suite local đã nêu: **108 test PASS**, không skip. Guard đọc TRX thật xác nhận đủ chín nhóm bắt buộc. Smoke HTTPS/auth/CORS/webhook sau cài guard trên VPS PASS; capability preview HTTP 200 với manual=true, worker=false, Staff/Tenant vẫn 403. Probe không phát sinh nghiệp vụ thanh toán/lập hóa đơn.

Lệnh Python đầu trên Windows gặp App Execution Alias chưa có Python trên PATH; đã dùng runtime Python và chạy suite đầy đủ trong Linux với Bash/Docker Compose. Lần đối chiếu script VPS đầu từ chối do checksum khác Git; đã review và giữ hotfix PDF-tool nêu trên trước khi cài lại. Guard TRX chạy với bộ báo cáo cũ thiếu test mẫu hợp đồng bị từ chối đúng; đã chạy lại đủ nhóm và guard PASS. Không coi các lần bị từ chối là deployment thành công.

Evidence local: `.tools/staging-release-preservation-20261124/` (logs, TRX, checksum, manifests). Không chạy lại CI toàn bộ/GitHub Actions trong lượt này.

## Trạng thái VPS

Đã cài bản cập nhật `deploy-release.sh`, `release-config.py`, `release-safety.py` **riêng staging** và tạo persistent runtime overlay với manual billing **true** theo API đang chạy. Thư mục evidence/backup private: `/opt/bhome-deploy/operator-release-preservation-20261124/`, có `commissioned.json`, `guard-installed.json`, cấu hình Compose resolved và các script trước/sau. Cấu hình chứa secret chỉ giữ private trên VPS, không tải về repository.

Không pull image, chạy Compose up, recreate/restart ứng dụng hoặc deploy lại bản API/Web; không migration/seed/chuyển tiền/ký. Image demo API/Owner/Public và các container Production/database/storage giữ nguyên. Bản demo tiếp tục chạy trong khi chờ source được review/commit/merge. Không commit/push/merge trong lượt này.

Production scripts trên VPS chưa được cập nhật trong lượt này. Khi được duyệt cập nhật chúng sau này, phải cài `release-config.py` cùng `deploy-release.sh`; runtime overlay Staging không áp dụng cho Production.

## File thay đổi

`deploy/vps/deploy-release.sh`, `deploy/vps/release-config.py`, `deploy/vps/release-safety.py`, `deploy/vps/compose.staging-runtime.example.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/Verify-StagingRegressions.py`, `.env.staging.example`, `docs/development/BHOME_STAGING_DEPLOYMENT.md`, báo cáo này và bốn file test deployment liên quan. Những thay đổi source/demo sẵn có được giữ nguyên.
