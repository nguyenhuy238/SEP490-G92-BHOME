# Sửa CI member/Long — 29/11/2026

## Phạm vi và nguồn đối chiếu

Yêu cầu: checkout `member/Long`, cập nhật remote, hợp nhất `develop` theo cấu trúc mới và xử lý lỗi CI để người dùng push nhánh cá nhân, tạo PR vào `develop`.

- Remote Long trước sửa: `49af14aa`; develop được fetch: `21c0396e`.
- Commit hợp nhất: `ee8f74b0`. Giữ backend một project runtime `src/backend/BHome.Api`, các thay đổi OCR đã có trên develop và giao diện mới của Long.
- Bằng chứng trước sửa: [GitHub Actions CI #426](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/46170673821), artifact Backend TRX và log Mobile/format. Run này kiểm tra `3cdd640c`, trước hai commit mới nhất của Long; không coi kết quả cũ là kết quả của HEAD mới.

| Hành vi cần giữ                                                        | Nguồn quy tắc hiện có                                                                   | Thành phần và kiểm chứng                                                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Bản hợp đồng đã duyệt, lịch sử bất biến, ký và thanh toán theo máy chủ | UC-13..16, GBR-04; `docs/api/CONTRACT_LIFECYCLE.md`, `docs/api/CONTRACT_SIGNING_OTP.md` | MainDraftReleaseTests, MainDocxTemplateTests, ContractSigningStep và kiểm thử timeout/polling/khóa thanh toán                         |
| Staff chỉ theo dõi cư trú trong phạm vi được giao; Owner xác nhận      | UC-18, GBR-01/02/06; `docs/api/HOUSEHOLD_RESIDENCE.md`                                  | Compact24ResidenceQueryTests: Pending, InProgress, AwaitingReview, Completed, tìm kiếm phòng, dữ liệu riêng tư và Staff ngoài phạm vi |
| CCCD cần xác nhận Backend trước khi lập hợp đồng                       | UC-13; quy tắc bảo mật CCCD trong AGENTS.md                                             | onboarding-ui, holding-draft: trạng thái từng người, giữ dữ liệu qua Back, chống khôi phục sai người/sai phòng/chưa xác minh          |
| Không giảm cổng CI hoặc phục hồi kiến trúc cũ                          | AGENTS.md §9, §10, §14; workflow hiện tại                                               | Build, format, lint, kiểm thử, discovery, TRX inventory, retained regressions và frontend evidence                                    |

Không thay đổi chính sách nghiệp vụ, phân quyền, DTO, schema hoặc baseline skip/inventory. Không truy cập bộ ảnh CCCD thật, tài khoản thật hoặc cơ sở dữ liệu triển khai để kiểm thử CI.

## Nguyên nhân và thay đổi

1. **Backend — 7 ca thất bại trên CI cũ.** Sáu ca dùng kỳ vọng template version 4 trong khi renderer của Long đã lên 5. Kiểm thử luồng dùng phiên bản renderer hiện hành; kiểm thử DOCX riêng vẫn ghim version 5. Giữ nguyên kiểm tra tài liệu cũ không bị sửa, từ chối bản đã lỗi thời, idempotency và sử dụng đúng PDF đã duyệt. Ca cư trú còn lọc Pending sau khi cả hai người đã được Owner xác nhận; sửa kỳ vọng và kiểm chứng từng trạng thái qua API với PostgreSQL thật, giữ các kiểm tra bảo mật.
2. **Mobile — 56 ca thất bại, một suite không nạp được trên CI cũ.** Selector còn dựa vào nút refresh và nhãn/counter đã bỏ trong giao diện mới; MainDraftStart chưa mock ranh giới native của room picker mới. Cập nhật kiểm thử theo polling và luồng thực tế, xác nhận stage CCCD thay vì tiêu đề cũ. Reset các mock mạng giữa từng ca để hàng đợi phản hồi của một ca không ảnh hưởng ca khác. Không khôi phục các panel trùng lặp đã được Long loại bỏ.
3. **Luồng ký sau timeout.** Poll thành công mới giải phóng trạng thái gửi chưa rõ kết quả; lỗi mạng vẫn khóa gửi lại. Tăng revision khi bắt đầu/kết thúc gửi để phản hồi trạng thái bắt đầu trước hoặc trong lần gửi không thể xóa trạng thái chưa rõ sau timeout. Không tự gửi lại email hoặc cho phép thanh toán dựa trên kết quả gửi email. Thêm kiểm thử trường hợp lời mời đã/chưa được máy chủ ghi nhận và phản hồi cũ đến muộn.
4. **Chọn phòng hợp đồng thuê.** Truyền nhãn và tiêu đề phù hợp khi tái sử dụng HoldingRoomPicker; giữ logic chọn phòng/sức chứa/người đại diện hiện có.
5. **Định dạng.** Chạy Prettier cho các file bị báo lỗi và chuẩn hóa LF cho hai file C# đã sửa. Chín file lỗi format ban đầu được đối chiếu bằng cách format nội dung HEAD rồi so sánh với working tree: khớp hoàn toàn, không sửa chức năng.
6. **Độ ổn định kiểm thử Owner Web.** Lượt toàn bộ đầu tiên có hai truy vấn chờ UI hết hạn 1 giây ở form thực chi và drawer Staff; chạy riêng hai file đạt 30/30. Tăng giới hạn chờ lên 5 giây ở đúng hai truy vấn, không đổi assertion về khóa thao tác khi đang thanh toán, revision tài khoản, trách nhiệm nhân viên hoặc payload API. Đây là thời gian chờ test render, không phải thay đổi timeout hay hành vi của sản phẩm.

## Kết quả

| Hạng mục               | Trước sửa — CI #426                                        | Sau sửa — chạy cục bộ                                                                                                                |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Backend                | 2.821 pass, 7 fail, 32 skip                                | **2.854 pass, 0 fail, 32 skip**, đủ 5 assembly; hai verifier Backend **PASS**                                                        |
| Mobile                 | 1.776 pass, 56 fail; 5 file lỗi (gồm suite không nạp được) | **1.864 pass, 0 fail, 0 skip**, 168 file                                                                                             |
| Owner Web              | Job đạt trên CI cũ                                         | **1.071 pass, 0 fail, 0 skip**, 142 file; lượt đầu cục bộ 1.069 pass/2 timeout, đã sửa thời gian chờ và chạy lại toàn bộ             |
| Public Web             | Job đạt trên CI cũ                                         | **11 pass**, cùng **16 pass** trên trình duyệt thật chạy headless                                                                    |
| Frontend evidence      | Mobile report bị từ chối vì test lỗi                       | **PASS**, cả bốn JUnit report đầy đủ, không fail/skip                                                                                |
| Format/lint            | Prettier lỗi 9 file; lint đạt                              | Prettier toàn repo, ESLint toàn repo và các test sửa cuối: **PASS**; .NET format: **PASS**                                           |
| Build/typecheck/export | Web/API image validation cũ đạt; Mobile job không hoàn tất | Client core, Owner Web, Public Web build; Mobile/Owner typecheck; Expo web export: **PASS**                                          |
| Deployment regressions | Không dùng kết quả cũ thay cho lượt mới                    | **106/106 Python Linux, 26/26 Node, 7/7 email preflight**, không skip; SePay PowerShell, hai Compose config và bash syntax: **PASS** |

Số ca trước/sau khác nhau vì nhánh mới đã hợp nhất các kiểm thử bổ sung trên develop và thêm hồi quy timeout. Không diễn giải tăng số ca pass thành tăng độ chính xác OCR. Backend dùng cùng `ci.runsettings` với workflow, gồm các bộ QA vốn không thuộc merge gate; không thay đổi bộ lọc này.

Chi tiết Backend: Application 796 pass; Domain 115 pass; Infrastructure 267 pass; DigitalSigning 41 pass; Integration 1.635 pass/32 skip, chạy 34 phút 55 giây. `Verify-StagingRegressions.py` xác nhận đủ **26 nhóm hồi quy bắt buộc**. `Verify-BackendTrx.py` đối chiếu đủ 5 assembly với discovery hiện tại, danh tính test/case và danh sách skip được phép; không sửa inventory hay bộ verifier.

Build toàn bộ `src/backend/BHome.sln` ở Release đạt **0 warning, 0 error** sau lượt kiểm thử. Container PostgreSQL và tiến trình thu thập SQL riêng của lượt CI đã được dừng/xóa; môi trường Mobile thử nghiệm trước đó được giữ nguyên.

Các lệnh tương ứng với workflow, chạy với Node 22/.NET 8 và dữ liệu tổng hợp:

```text
dotnet build src/backend/BHome.sln -c Release --no-restore -m:1
dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
python scripts/Capture-BackendDiscovery.py <discovery-directory>
dotnet test src/backend/BHome.CI.slnf -c Release --no-build --settings tests/backend/ci.runsettings --logger trx --results-directory <trx-directory> -m:1
python scripts/Verify-StagingRegressions.py <trx-directory>
python scripts/Verify-BackendTrx.py <trx-directory> tests/backend/ci-test-inventory.json --discovery <discovery-directory>/discovery.json
npm run lint
npm run format:check
npm run typecheck --workspace ./src/mobile
npm run test --workspace ./src/mobile -- --run
npm run test --workspace ./src/owner-web -- --run
npm run test --workspace ./src/public-web -- --run
npm run test:browser --workspace ./src/public-web
npm run build --workspace ./packages/client-core
npm run build --workspace ./src/owner-web
npm run build --workspace ./src/public-web
expo export --platform web --max-workers 2 --output-dir <ignored-output-directory>
python scripts/Verify-FrontendEvidence.py <mobile-junit> <owner-junit> <public-junit> <browser-junit>
```

Mỗi lệnh thực tế ghi log riêng trong `.tools/ci-long-20261129/` (ignored); không commit log HTTP, SQL, TRX chi tiết hoặc thông tin cấu hình. PostgreSQL dành riêng cho lượt CI được tạo trên loopback, mật khẩu ngẫu nhiên trong bộ nhớ; chỉ ghi câu SQL của dữ liệu tổng hợp, tắt giá trị bind parameters và xóa container sau lượt chạy. Linux deployment tests chạy trong container chỉ đọc source, không có mạng, không gắn Docker socket; Docker CLI/Compose trong container chỉ dùng để parse cấu hình.

## Giới hạn

- Đây là kiểm chứng cục bộ; GitHub Actions của commit mới chỉ có thể xác nhận sau khi người dùng push. Chưa push, mở PR, merge vào develop hoặc triển khai.
- Không chạy lại các job build Docker image/phát hành trên HEAD mới; kết quả image validation xanh của CI #426 chỉ áp dụng cho commit cũ. Cần workflow GitHub Actions sau khi push để xác nhận toàn bộ job và môi trường runner Linux.
- Build web lần đầu thiếu `VITE_API_BASE_URL`; đã chạy lại với giá trị placeholder đúng workflow CI. Không dùng endpoint thật cho kiểm thử này.
- Kiểm thử triển khai chạy trực tiếp bằng Python Windows báo lỗi import `fcntl` và bỏ qua các ca POSIX. Lượt Linux cục bộ được dùng để kiểm chứng đúng môi trường thay vì thay đổi kiểm thử cho Windows.
- Kiểm thử Mobile dùng Vitest và Expo export; không thay thế kiểm thử Android/iPhone thật, nghiệm thu OCR ảnh thật hoặc đo độ chính xác/độ trễ OCR thực tế.
