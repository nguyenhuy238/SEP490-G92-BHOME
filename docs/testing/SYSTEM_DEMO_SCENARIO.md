# BHOME — Kịch bản demo hệ thống và nghiệp vụ cần hoàn thiện

Ngày rà soát: **09/11/2026**. Source: nhánh `member/QHuy`, HEAD `2707940`.

Có thể tổ chức buổi demo các luồng đã nối API trên Owner Web và Mobile. **Chưa đủ căn cứ công bố toàn bộ hệ thống hoàn thiện hoặc đã nghiệm thu E2E**: còn màn mock/chưa nối, thiết lập Mobile lệch API và tích hợp bên ngoài chưa được xác minh. Tài liệu này là kế hoạch chạy demo, không phải biên bản chạy thành công.

## 1. Căn cứ và cách đọc

- [Checklist 62 mục](TEAM_FEATURE_CHECKLIST.md): trạng thái nối UI/API; tất cả dòng kiểm thử thủ công đang là **Chưa test**.
- [Audit Mobile ngày 08/11](../development/MOBILE_FE_BE_CHECKLIST_AUDIT_2026-11-08.md): các luồng theo vai trò và lỗi thiết lập Owner Mobile.
- [API Location → Room hiện tại](../api/LOCATION_ROOM_API.md): ghi nhận quyết định bỏ Chain/RoomType và contract API thay thế.
- SRS gốc: `docs/reports/BHome_Report-3_Software Requirement Specification.docx`; đối chiếu GBR-04, GBR-06, GBR-07, GBR-17, GBR-18 và OQ-01..08.
- Các source cụ thể trong mục 7. Những báo cáo audit cũ có nội dung đã lạc hậu; sự hiện diện của controller/service không chứng minh luồng đã chạy trên môi trường demo.

Nhãn sử dụng trong kịch bản:

| Nhãn                         | Ý nghĩa                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Có thể đưa vào buổi chạy thử | Có UI gọi API và backend liên quan; phải rehearsal trước khi trình diễn chính thức.   |
| Qua API / dữ liệu chuẩn bị   | UI chưa đầy đủ; nếu dùng API phải nói rõ đó là trình diễn backend hoặc bước chuẩn bị. |
| Phụ thuộc cấu hình           | Cần OCR, storage, worker hoặc nhà cung cấp thực sự hoạt động.                         |
| Chưa đủ UI                   | Không đưa vào danh sách chức năng đã hoàn tất trên giao diện.                         |

## 2. Chuẩn bị trước buổi demo

### 2.1 Môi trường và phiên đăng nhập

1. Dùng môi trường demo/test riêng với dữ liệu tổng hợp. Xác nhận API, PostgreSQL, private object storage và client cùng trỏ về một môi trường. Không reset hoặc seed vào database đang làm việc của nhóm để chuẩn bị buổi thuyết trình.
2. Owner Web đặt `VITE_API_MODE=api`, API base URL chính xác. Mặc định Web là mock. Chế độ API cũng không làm các màn dùng repository cũ tự có API; chúng có thể báo chưa hỗ trợ.
3. Mobile đăng nhập thật; không dùng role preview. Chuẩn bị các phiên Owner, Staff, Tenant ở thiết bị/profile riêng để đổi vai nhanh.
4. Kiểm tra tải lên rồi tải lại ảnh/PDF qua quyền của người dùng. Native cần API có thể truy cập và chứng chỉ được thiết bị tin cậy.
5. Ghi rõ chế độ ký: mô phỏng Development hay MySign thật; ngân hàng: Owner xác minh thủ công hay provider; thông báo: inbox, SMTP hay push. Không ghi mô phỏng thành tích hợp thật.
6. Nếu demo OCR phải bật và kiểm model trước. Nếu demo job phải bật worker và cấu hình ngày chạy/Owner opt-in; `Jobs:Enabled` và `Ocr:Enabled` mặc định đều `false` trong appsettings đã đọc.

Hướng dẫn khởi động: [Local development](../development/LOCAL_DEVELOPMENT.md) và [Mobile network](../development/MOBILE_NETWORK_DEVELOPMENT.md). Bộ script [Initialize-ContractDemo.ps1](../../scripts/Initialize-ContractDemo.ps1) / [Start-ContractDemo.ps1](../../scripts/Start-ContractDemo.ps1) là điểm xuất phát cho môi trường hợp đồng riêng, **chưa được chạy/xác minh trong lượt rà soát này**. Launcher contract hiện tắt jobs và OCR, bật mô phỏng ký khi khởi tạo cấu hình mới; không mặc định dùng nó để chứng minh OCR/automation. Cần kiểm cấu hình/runtime và dữ liệu sẵn có trước khi dùng lại.

### 2.2 Bộ dữ liệu đề xuất

| Dữ liệu                                                                                             | Mục đích                                                                                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cơ sở A và B; Staff A chỉ được giao A, Staff B chỉ được giao B                                      | Kiểm phạm vi và thu hồi phân công khi đang đăng nhập.                                                          |
| Phòng A101 còn trống, có tài sản, công tơ điện/nước hoạt động, biểu giá và lịch hóa đơn hợp lệ      | Luồng tiếp nhận → hợp đồng → bàn giao → hóa đơn.                                                               |
| Tenant đại diện T1 và người ở cùng T2 có tài khoản liên kết; Tenant T3 ở phòng/cơ sở khác           | Nhiều người cùng phòng; quyền hóa đơn chung; kiểm chéo Tenant. Chỉ những người có quyền theo backend được xem. |
| Hợp đồng riêng đang ở thời điểm đủ điều kiện gia hạn                                                | Demo gia hạn mà không đổi thời gian hệ thống hoặc làm hỏng luồng trả phòng.                                    |
| Bộ phòng/hợp đồng riêng cho Holding và sự cố; hai trường hợp trả phòng không thiệt hại/có thiệt hại | Các nhánh độc lập, tránh tái sử dụng đối tượng đã đóng hoặc đổi trạng thái.                                    |
| Ảnh tổng hợp cho OCR/bằng chứng; mã giao dịch giả duy nhất; số tiền do backend tính                 | Không dùng CCCD, tài khoản ngân hàng, chứng từ hoặc thông tin cá nhân thật.                                    |

Giá phải có hiệu lực đúng kỳ; API hiện chặn tạo biểu giá hồi tố. Chuẩn bị trước ngày hiệu lực cần dùng thay vì sửa DB hoặc lùi giờ máy để vượt kiểm tra. Số tiền demo chọn trong các phương thức tính đã hỗ trợ, không coi ví dụ là chính sách kinh doanh được duyệt.

Nên có hai bộ: **bộ mới để thao tác live** và **bộ dự phòng ở trạng thái rõ ràng**. Nếu chuyển sang bộ dự phòng, nói rõ trạng thái nào đã chuẩn bị; không trình bày như vừa chạy toàn bộ chuỗi.

## 3. Kịch bản đầy đủ đề xuất 60–75 phút

Thời lượng là gợi ý tổ chức buổi demo, không phải kết quả đo hiệu năng. Đi theo câu chuyện: **chuẩn bị vận hành → tiếp nhận người thuê → vào ở → thu tiền → xử lý vận hành → kết thúc thuê**.

| Bước / thời gian | Người thao tác và kênh                           | Thao tác trình diễn                                                                                                                                   | Kết quả cần quan sát / giới hạn hiện tại                                                                                                                                                                                               | Truy vết                                                   |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1 · 3 phút       | Owner Web, Staff/Tenant Mobile                   | Đăng nhập đúng vai trò; thử sai mật khẩu; cho thấy menu và dữ liệu theo quyền.                                                                        | Owner vào Portal; Staff/Tenant không được vào chức năng Owner. Có phiên thật, không preview.                                                                                                                                           | FE-02, UC-01, GBR-01..03; checklist 1–5.                   |
| 2 · 4 phút       | Owner, API rồi Web giá/phí                       | Giới thiệu cơ sở/phòng/tài sản/Staff đã chuẩn bị; đọc giá hiệu lực và lịch lập hóa đơn.                                                               | Web CRUD cơ sở/phòng/tài sản/Staff chưa nối đầy đủ. Nếu cần tạo live, dùng API hiện hữu và công bố rõ kênh. Không dùng màn setup Mobile đang lệch API.                                                                                 | BF-01, UC-04..07, GBR-08; BF-02, UC-08; checklist 6–11.    |
| 3 · 5 phút       | Staff Mobile                                     | Tiếp nhận T1/T2; nhập hoặc OCR thông tin tổng hợp; sửa và xác nhận; chọn người đại diện.                                                              | Mỗi người có hồ sơ riêng. OCR chỉ là đề xuất, có nhập tay; xác nhận không đồng nghĩa lưu ảnh CCCD dài hạn.                                                                                                                             | BF-03, UC-13..15, GBR-05/07/13; checklist 16–18.           |
| 4 · 7 phút       | Owner Web; Owner/Tenant ký theo kênh hỗ trợ      | Tạo Main Draft, duyệt nội dung, sinh/xem PDF, ký và đồng bộ trạng thái; thử kích hoạt khi còn thiếu điều kiện.                                        | PDF khớp nội dung đã duyệt; thiếu chữ ký/cọc phải bị chặn. Ký sandbox/mô phỏng phải được giới thiệu rõ.                                                                                                                                | BF-03, UC-15..16, GBR-04, DBR-02; checklist 19–21.         |
| 5 · 4 phút       | Owner Web, Staff/Tenant Mobile                   | Owner xác minh cọc theo luồng hiện có và kích hoạt; Staff lập bàn giao, ảnh/tài sản/chìa khóa/chỉ số đầu; Tenant xác nhận.                            | Backend quyết định Active/Occupied. Biên bản giữ các xác nhận Staff/Tenant; Owner không bấm thay hai bên.                                                                                                                              | UC-16..17; checklist 21.                                   |
| 6 · 2 phút       | Tenant Mobile, Owner Web                         | Tenant cập nhật kết quả đăng ký tạm trú với bằng chứng tổng hợp; Owner xác nhận đúng người ở.                                                         | BHOME theo dõi kết quả; đăng ký chính thức thực hiện bên ngoài qua VNeID. Staff không đăng ký/duyệt. Owner xác nhận qua Web, chưa có thao tác Mobile tương ứng.                                                                        | BF-04, UC-18, GBR-06; checklist 27.                        |
| 7 · 5 phút       | Staff Mobile, Owner theo dõi automation          | Mở task điện và nước riêng; chụp/đọc OCR hoặc nhập tay; thử số nhỏ hơn kỳ trước; sửa và xác nhận.                                                     | Đúng công tơ/kỳ; có người xác nhận. Không dùng OCR chưa xác nhận để tính tiền. JOB-09 cần được cấu hình và chạy trước nếu muốn chứng minh task tự sinh.                                                                                | BF-05, UC-20, GBR-07/08, JOB-09; checklist 28–31.          |
| 8 · 4 phút       | Owner Web, Tenant Mobile                         | Tạo Draft từ dữ liệu hợp lệ, kiểm các dòng tiền; Tenant xem; Owner Final và Tenant tải lại.                                                           | Thiếu dữ liệu giữ Pending/Draft; Final không sửa trực tiếp. Muốn demo JOB-10 cần đến lịch và Owner cho phép tự Final, không chỉ bấm tạo thủ công.                                                                                      | BF-05, UC-21, GBR-09, DBR-06/07, JOB-10; checklist 32–33.  |
| 9 · 5 phút       | Tenant Mobile, Owner Web                         | Tenant xem QR; Owner ghi nhận/xác minh giao dịch giả và phân bổ một phần, sau đó phần còn lại; T1/T2 tải lại hóa đơn.                                 | QR không chứng minh đã trả. Nợ cập nhật từ backend; cùng hóa đơn không thu trùng. Bank tự động hiện chưa có provider được cấu hình trong DI đã đọc.                                                                                    | BF-06, UC-22/23/25, GBR-10/18; checklist 34–38.            |
| 10 · 3 phút      | Tenant Mobile, Owner Web                         | Trên hóa đơn riêng, Tenant yêu cầu điều chỉnh kèm lý do/ảnh; Owner duyệt hoặc từ chối; đọc lại số dư.                                                 | Hóa đơn Final gốc giữ nguyên; thay đổi sau Final có Adjustment. Tránh dùng lại hóa đơn đã thanh toán xong nếu muốn tránh nhánh tiền dư còn cần xem xét.                                                                                | BF-06, UC-24, DBR-07; checklist 39–40.                     |
| 11 · 3 phút      | Owner/Staff Mobile                               | Owner tạo/giao công việc vận hành; Staff bắt đầu, tiến độ/ảnh, gửi hoàn thành; Owner yêu cầu làm lại hoặc nghiệm thu.                                 | Đúng người phụ trách, lịch sử và trạng thái được lưu; Staff không tự nghiệm thu. Web hiện chủ yếu đọc list/detail. Đây là OperationalTask, tách với Work Order bảo trì.                                                                | BF-02, UC-10..12; checklist 12–15.                         |
| 12 · 6 phút      | Tenant, Owner, Staff Mobile                      | Tenant báo sự cố; Owner review/giao Work Order; Staff đề xuất thời gian/chi phí; Owner duyệt; Staff xử lý/gửi nghiệm thu; Owner xác minh.             | Thể hiện Assigned → Pending Approval → In Progress → Pending Verification → Verified. Chưa duyệt không bắt đầu; chưa nghiệm thu đủ Work Order không đóng sự cố. Owner Web còn dùng màn repository cũ.                                  | BF-07, UC-26..30, GBR-11/12; checklist 42, 44–47.          |
| 13 · 2 phút      | Tenant/Staff/Owner Mobile                        | Dùng một báo cáo Emergency riêng: kiểm inbox đúng cơ sở; Staff tiếp nhận và ghi hành động sơ bộ.                                                      | Chứng minh lưu thông báo/ghi nhận trước; email/push là nhánh riêng cần provider. Dùng tình huống giả, không tạo cảnh báo thật; khẩn cấp đe dọa an toàn cần dịch vụ công cộng trước.                                                    | BF-07, UC-26..30; checklist 43.                            |
| 14 · 3 phút      | Owner Web, Tenant theo dõi                       | Mở hợp đồng sắp hết hạn khác; tạo gia hạn, kiểm phiên bản/lịch sử và điều kiện ký/kích hoạt tương ứng.                                                | Gia hạn có luồng và dữ liệu riêng; chưa khẳng định ký gia hạn E2E đã được nghiệm thu. Nếu provider chưa sẵn sàng, công bố dừng ở pending.                                                                                              | BF-04, UC-19, JOB-02; checklist 23.                        |
| 15 · 6 phút      | Tenant Mobile, Owner Web, Staff Mobile           | Tenant yêu cầu trả phòng; Owner xử lý/lên lịch; Staff kiểm tra/chỉ số cuối; Owner duyệt biên bản, quyết toán, hoàn cọc rồi hoàn tất khi đủ điều kiện. | Chạy nhánh không thiệt hại trước. Nhánh thiệt hại chỉ dùng khoản TenantDamage được Owner duyệt, đủ ảnh và trong số cọc còn lại. Nợ hoặc hoàn tiền chưa xử lý phải chặn đóng; Owner chuyển tiền ngoài hệ thống rồi ghi nhận bằng chứng. | BF-04/BF-06, UC-19, OQ-01/05; checklist 24–26, 41.         |
| 16 · 3 phút      | Owner Web                                        | Ghi đầu tư/OPEX; mở Reports theo kỳ/cơ sở; chạy What-if và tải lại dữ liệu nghiệp vụ.                                                                 | Dùng Reports đã nối API; Dashboard Web còn repository cũ. What-if không đổi giá/hợp đồng/hóa đơn/tiền thật. **Báo cáo loại payment demo khỏi verifiedCollections**, nên không yêu cầu doanh thu tăng từ giao dịch gắn nhãn demo.       | FE-08, UC-31..34, GBR-15/16; checklist 48–51.              |
| 17 · 2 phút      | Guest qua API; trình bày khoảng trống Public Web | Owner publish/unpublish nội dung bằng API; Guest đọc API public trước/sau. Nếu chưa chuẩn bị phần này, chỉ báo cáo phạm vi còn thiếu.                 | Backend có public/publish; Public Web hiện chỉ route trang chủ, chưa có list/detail. Phải kiểm cách cache hết hiệu lực khi thử ẩn. Không có Guest enquiry/booking/payment.                                                             | UC-37, GBR-17; checklist 55–56.                            |
| 18 · 3 phút      | Các vai trò                                      | Mở inbox, đánh dấu đọc; thử Tenant T3 đọc dữ liệu T1, Staff A đọc cơ sở B và tải file ngoài quyền.                                                    | Bị từ chối phù hợp, không lộ dữ liệu; thông báo vẫn lưu khi gửi ngoài thất bại. Không dùng việc ẩn nút để thay bằng chứng kiểm quyền backend.                                                                                          | FE-07, UC-35..36, GBR-01..03/18; checklist 4–5, 52–54, 60. |

Tổng thời lượng theo bảng khoảng 70 phút; thêm thời gian đệm nếu dùng nhiều thiết bị. Các bước dùng API là giới hạn sản phẩm cần công bố, không thay cho nghiệm thu giao diện còn thiếu.

### Bản trình bày ngắn 25–30 phút

Chuẩn bị cơ sở/phòng/Staff và bộ tài sản trước. Tập trung bước 1 → 3 → 4–5 → 7–9 → 12 → 15 → 16. Rút gọn từng bước bằng các phiên đã đăng nhập và các đối tượng riêng chuẩn bị đúng trạng thái. Giới thiệu tạm trú, gia hạn, thông báo và Public trong phần phạm vi/giới hạn; không tuyên bố bản ngắn đã trình diễn toàn bộ nghiệp vụ.

### Các nhánh bổ sung nếu muốn bao phủ checklist 62 mục

- **Holding**: tạo/Owner duyệt → ký/xác minh Holding Deposit → kiểm readiness → Active/On Hold → chuyển sang Main và chuyển cọc một lần; kiểm hủy/hết hạn/trùng phòng. Backend đã có implementation và ledger, nhưng UI chưa đủ; cần chuẩn bị qua API và chốt chính sách còn mở trước khi công bố hoàn chỉnh.
- **Thiếu/thừa/unmatched payment**: tiền thiếu giữ nợ; tiền thừa giữ phần chưa phân bổ để Owner xử lý; giao dịch chưa khớp không tự ghi có; gửi lặp cùng giao dịch không cộng hai lần. Hoàn tiền thừa có nguồn/chứng từ riêng với hoàn Security Deposit.
- **OCR/failure**: ảnh mờ, OCR timeout/không đọc được → nhập tay → xác nhận; không coi fallback thành bằng chứng đã chạy OCR. Camera thật và kiểm xóa ảnh CCCD tạm cần kiểm chứng riêng.
- **Automation**: cấu hình kỳ trước khi chạy, ghi lại lần chạy một và hai; không tạo trùng task/Final Invoice/thông báo. Việc bấm nút hai lần bị khóa ở UI chưa chứng minh idempotency ở server.
- **Phiên và lỗi**: đăng xuất/token hết hạn, refresh lỗi, mất mạng khi lưu, stale version, upload lỗi/quá cỡ. Tải lại để xác định thao tác đã commit trước khi thử lại.

## 4. Nghiệp vụ và giao diện cần tiếp tục hoàn thiện

Ưu tiên dưới đây là đề xuất để đạt demo xuyên suốt; không phải phân công đã được team phê duyệt. P0 = ảnh hưởng trực tiếp kịch bản demo chính; P1 = cần để bao phủ toàn phạm vi và vận hành; P2 = mở rộng kênh/UX theo phạm vi đã chốt.

| Ưu tiên | Khoảng trống đã thấy                                                                                                                         | Việc cần hoàn thiện / tiêu chí hoàn tất                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0      | **Owner Mobile setup lệch contract API**: còn gọi `/capture/chains`, `/room-types`, `/chain` và gửi `chainId`/`roomTypeId`.                  | Sửa theo Location → Room; kiểm tải danh sách và tạo/sửa cơ sở/phòng thật, không lỗi route/payload. Không dựng lại API cũ chỉ để khớp UI.                                                                              |
| P0      | **Owner Web cơ sở/phòng/tài sản/Staff và phân công chưa nối**; còn dữ liệu/mô hình cũ.                                                       | Nối endpoint hiện hữu; tạo → tải lại → sửa → xác nhận persistence; kiểm Staff theo ngày và cơ sở. Đây là việc ở frontend/tích hợp, không phải toàn bộ backend chưa có.                                                |
| P0      | **Chưa có kết quả chạy thử E2E mới cho bộ demo này**; 62 dòng checklist thủ công chưa test.                                                  | Chạy cùng API/DB/storage trên dataset riêng; ghi kết quả, lỗi, bằng chứng từng bước; kiểm đường bình thường, bị chặn và gửi lặp. Chỉ tick Đạt sau khi thực hiện.                                                      |
| P0      | **Chế độ OCR/ký/thanh toán/thông báo/worker dễ bị hiểu sai khi trình bày**.                                                                  | Chốt bảng cấu hình của môi trường demo, gắn nhãn mô phỏng/thủ công/thật; rehearsal đúng launcher. Thiếu provider thật phải ghi rõ; không tự thay requirement ký qua provider bằng ký nội bộ.                          |
| P1      | **Owner Web công việc thiếu thao tác**, sự cố/Work Order còn dùng repository cũ.                                                             | Nối tạo/giao/duyệt/làm lại/nghiệm thu theo API hiện có. Trước khi hoàn tất, demo các thao tác này qua Owner Mobile.                                                                                                   |
| P1      | **Lịch ca Staff chưa có dữ liệu ca/API ca riêng được xác định**; màn hiện chỉ tải cơ sở.                                                     | Chốt và thực hiện lát cắt lịch ca theo SRS: Owner lập/phân công, Staff xem đúng lịch. Không bổ sung đổi ca/chuyển việc giữa Staff ngoài scope.                                                                        |
| P1      | **Holding UI chưa đầy đủ**, các thời hạn/chính sách còn cần đối chiếu quyết định.                                                            | Nối vòng đời backend đã có, kiểm cạnh tranh giữ cùng phòng, hết hạn/hủy và chuyển cọc một lần. Xác nhận OQ-03 và các quyết định liên quan trước nhánh tranh chấp.                                                     |
| P1      | **Public Website chưa list/detail qua API; quản lý xuất bản Web chưa nối**.                                                                  | Owner duyệt/ẩn → Guest chỉ thấy nội dung đã xuất bản và ảnh được cho phép; kiểm private/PII. Không thêm form Guest, booking hoặc thanh toán.                                                                          |
| P1      | **Ngân hàng tự động chưa có provider được cấu hình trong DI đã đọc; MySign/SMTP/push thật chưa được nghiệm thu**.                            | Hoàn thiện adapter/cấu hình đúng môi trường, kiểm xác thực, retry, trạng thái pending và callback idempotency theo provider được chọn. Luồng Owner đối soát thủ công và inbox vẫn là các khả năng riêng cần chạy thử. |
| P1      | **Quyết toán chưa bao phủ bù nợ bằng cọc, phí vượt cọc, Tenant Credit và tiền dư do Adjustment sau Paid** theo tài liệu module.              | Cần quyết định nghiệp vụ được ghi nhận và bổ sung regression trước khi triển khai phần thiếu; giữ blocker thay vì tự đóng hợp đồng hoặc tự hoàn/khấu trừ.                                                             |
| P1      | **Automation cần kiểm chứng theo job**, chưa tìm thấy đầy đủ JOB-07 nhắc deadline ở các module StaffOperations/Operations đã dò.             | JOB-06 đã có template API và handler sinh việc, không ghi là chưa có toàn bộ. Kiểm worker/UI/configuration, dedupe, thiếu người được giao; xác định phần JOB-07 còn thiếu. JOB-08 phải chốt phạm vi nhắc theo GBR-06. |
| P1      | **Chưa nghiệm thu camera/OCR/native/storage và quyền tải file trên môi trường demo**.                                                        | Chạy thiết bị thật, ảnh mờ, manual fallback, không lưu CCCD dài hạn, ảnh/PDF ngoài quyền, mất mạng/refresh và gửi lại. Benchmark OCR/performance cần bộ dữ liệu và phép đo riêng.                                     |
| P2      | **Owner Mobile chưa thao tác khấu trừ/hoàn cọc/xác nhận tạm trú**; deep link thông báo chưa bao phủ mọi loại.                                | Nếu scope kênh yêu cầu thì bổ sung thao tác hiện đã có ở Web/API; ánh xạ và kiểm quyền lại khi mở notification target. Không coi thiếu một kênh là backend hoàn toàn thiếu.                                           |
| P2      | **Dashboard Web còn repository cũ**; báo cáo lịch sử lấp đầy toàn chuỗi/tổng nghĩa vụ cọc/chỉ tiêu khác chưa đầy đủ theo tài liệu tài chính. | Nối dashboard với nguồn thật; chốt phạm vi báo cáo và kiểm đối chiếu. Hiện dùng Reports đã nối API, hiển thị rõ unavailable và các khoản demo bị loại; không tự bù số liệu mẫu.                                       |

**Thứ tự nên làm:** sửa setup Mobile và nối Web cấu hình cơ bản → rehearsal luồng hợp đồng/thu tiền/trả phòng → nối Web công việc/sự cố và Public → hoàn thiện Holding/lịch ca/job → nghiệm thu provider thật và các nhánh quyết toán sau khi có quyết định. Kiểm quyền và kiểm dữ liệu là điều kiện của từng phần, không đợi cuối mới kiểm.

## 5. Các quyết định còn mở cần phân biệt với lỗi lập trình

SRS chứa OQ-01..08 ở trạng thái Open. Repository đã có triển khai một số nhánh theo ủy quyền được mô tả trong [Payments](../api/PAYMENTS.md) và [Deposit deductions](../api/DEPOSIT_DEDUCTIONS.md); điều đó không tự đóng tất cả câu hỏi chính sách.

| Nhóm     | Cần xác nhận trước khi mở rộng                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| OQ-01/05 | Quyết toán cọc khi còn nợ/thiệt hại, chọn cách thu thiệt hại, khoản vượt cọc, tránh tính hai lần. Không tự đặt mức phạt/khấu hao. |
| OQ-02    | Loại điều chỉnh và ngưỡng duyệt nếu có. Không thêm ngưỡng tiền do nhóm phát triển tự chọn.                                        |
| OQ-03    | Hiệu lực Holding và thời hạn nộp Holding Deposit.                                                                                 |
| OQ-04    | Mục tiêu thời gian tiếp nhận/phản ứng Normal và Emergency.                                                                        |
| OQ-06    | Đầu vào chi phí/lương Staff cho phân tích tài chính; không tự coi đã có payroll.                                                  |
| OQ-07    | Thời hạn giữ/xóa/ẩn danh thông tin định danh sau kết thúc thuê.                                                                   |
| OQ-08    | Email người ở cùng và ai nhận thông báo hóa đơn. Quyền đọc hóa đơn chung trong code không tự quyết định nghĩa vụ nhận email.      |

UC-18/JOB-08 còn xung đột về hỗ trợ/nhắc của Staff: giữ nguyên nguyên tắc Tenant đăng ký ngoài BHOME, Owner xác nhận theo GBR-06; không mở quyền Staff đăng ký. UC-37 có flow form liên hệ cũ trái GBR-17: không coi việc chưa có form Guest là nghiệp vụ còn thiếu phải bổ sung.

## 6. Bằng chứng và điều kiện chốt demo

Mỗi bước lưu: môi trường/commit, người chạy và vai trò, ID dữ liệu tổng hợp, thời điểm, trạng thái trước/sau, kết quả mong đợi/thực tế, ảnh màn hình đã che thông tin nhạy cảm và bug nếu có. Bằng chứng API không kèm token; không đưa `.env`, runtime secrets hoặc ảnh CCCD thật vào hồ sơ demo.

Điều kiện đề xuất để chốt buổi demo:

- Luồng chính đã rehearsal từ dữ liệu mới và đọc lại sau reload/đăng nhập lại; không dùng mock ở những bước công bố đã tích hợp.
- Thiếu chữ ký/cọc không kích hoạt; thiếu chỉ số không tự tính chính thức; Final không sửa trực tiếp; thanh toán lặp không ghi có hai lần; còn nghĩa vụ chưa xử lý không trả phòng.
- Staff chéo cơ sở, Tenant chéo hồ sơ/hóa đơn/PDF/ảnh đều bị chặn; thu hồi assignment có hiệu lực ở request tiếp theo theo kiểm tra server.
- Phân biệt thanh toán cọc với doanh thu; hoàn gốc cọc không tự thành OPEX; What-if không sửa số liệu thật.
- Các phần chưa đủ UI, provider chưa cấu hình, OCR/native chưa đo và nhánh policy chưa duyệt được nêu rõ. Có API hoặc unit test không thay cho nghiệm thu toàn hệ thống.

**Kiểm tra trong lượt tạo tài liệu:** đọc source và tài liệu; kiểm định dạng Markdown và các liên kết tương đối theo kết quả báo cáo khi bàn giao. Không chạy build, unit/integration/E2E, API, native, OCR, storage hoặc provider; không seed/sửa DB, `.env` hoặc code nghiệp vụ. Số test cũ trong checklist là bằng chứng của lượt trước, không phải kết quả ngày 09/11.

## 7. Source để xác minh khi triển khai tiếp

- API/mock và repository dùng chung: [config.ts](../../src/owner-web/src/services/config.ts), [PortalProvider.tsx](../../src/owner-web/src/app/PortalProvider.tsx).
- Thiết lập Mobile và lịch Staff: [setup.tsx](../../src/mobile/src/app/setup.tsx), [StaffScheduleScreen.tsx](../../src/mobile/src/screens/StaffScheduleScreen.tsx).
- Các màn Web cần nối: [LocationsListPage.tsx](../../src/owner-web/src/features/locations/pages/LocationsListPage.tsx), [TasksPage.tsx](../../src/owner-web/src/features/tasks/pages/TasksPage.tsx), [IncidentsPage.tsx](../../src/owner-web/src/features/incidents/pages/IncidentsPage.tsx), [PublicContentPage.tsx](../../src/owner-web/src/features/public-content/pages/PublicContentPage.tsx), [DashboardPage.tsx](../../src/owner-web/src/features/dashboard/pages/DashboardPage.tsx).
- Public Web: [AppRouter.tsx](../../src/public-web/src/app/router/AppRouter.tsx).
- Staff/residence/public/recurring templates: [OperationsControllers.cs](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs), [RecurringOperationsJob.cs](../../src/backend/BHome.Infrastructure/Modules/Operations/RecurringOperationsJob.cs).
- Holding, settlement: [ContractHoldingService.cs](../../src/backend/BHome.Application/Contracts/ContractHoldingService.cs), [CompactContractHoldingLedger.cs](../../src/backend/BHome.Infrastructure/Contracts/CompactContractHoldingLedger.cs), [SettlementCalculation.cs](../../src/backend/BHome.Application/Contracts/SettlementCalculation.cs), [Contract lifecycle](../api/CONTRACT_LIFECYCLE.md).
- Sự cố và thao tác Mobile: [IncidentService.cs](../../src/backend/BHome.Application/IncidentMaintenance/IncidentService.cs), [IncidentActions.tsx](../../src/mobile/src/features/incidents/IncidentActions.tsx).
- Provider đăng ký và cấu hình mặc định: [DependencyInjection.cs](../../src/backend/BHome.Infrastructure/DependencyInjection.cs), [appsettings.json](../../src/backend/BHome.Api/appsettings.json).
- Quy tắc tài chính/automation: [Finance](../api/FINANCE.md), [Billing automation](../api/BILLING_AUTOMATION.md), [Payments](../api/PAYMENTS.md), [Deposit deductions](../api/DEPOSIT_DEDUCTIONS.md), [Refunds](../api/REFUNDS.md).
