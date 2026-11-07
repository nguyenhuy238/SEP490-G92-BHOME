# Dữ liệu và các phần kiểm tra hợp đồng Mobile — 05/11/2026

Cập nhật giao diện Staff: danh sách hiện dùng tab trạng thái, tìm kiếm/sắp xếp và 5 hợp đồng/trang,
thay cho các nhóm lớn xếp dọc. Xem [bản redesign danh sách Staff](STAFF_CONTRACTS_LIST_UI_2026-11-05.md).
Các nhóm và phòng mẫu bên dưới vẫn mô tả bộ dữ liệu, không phải số thẻ được render cùng lúc.

Phạm vi BF-03/04, UC-13..19, GBR-01..04: thêm dữ liệu tổng hợp local để Staff/Owner xem vòng đời
hợp đồng và chia màn hình hiện có thành các phần. Không thay schema, endpoint, quyền, tiền cọc
hoặc chính sách quyết toán. Đây là tình huống minh họa trạng thái, không phải bằng chứng đã
hoàn thành quy trình ký/kích hoạt/thanh toán thật.

## Cách xem

Dữ liệu đã được thêm vào database local `bhome`, cơ sở `BHOME MOBILE TEST`.
Giữ nguyên M101, tài khoản/mật khẩu test hiện có và mọi chỉnh sửa người dùng đã thao tác.

Đăng nhập Staff hoặc Owner, tải lại **Hợp đồng & Vòng đời**. Danh sách hiện có 14 hợp đồng,
gồm M101 cũ và 13 hợp đồng mới trong 11 phòng CT201..CT211. Năm nhóm trên trang hiện tại:

- Hồ sơ nháp: 1.
- Chờ ký / kích hoạt: 2.
- Đang thuê: 6 (bao gồm M101).
- Bản gia hạn: 2.
- Đã kết thúc / hủy: 3.

Các số nhóm tính trên trang API đang mở; phân trang và bộ lọc trạng thái hiện có vẫn giữ nguyên.

## Các phòng mẫu

- **CT201:** nháp hợp đồng thuê, chưa có chữ ký.
- **CT202:** trạng thái chờ ký, dùng để xem phần ký và các điều kiện còn thiếu.
- **CT203:** trạng thái chờ kích hoạt; chưa có chữ ký/xác minh cọc, để xem blocker thực tế.
- **CT204:** đang thuê, có biên bản bàn giao Draft với chỉ số điện 100 kWh/nước 10 m³ và ảnh
  tổng hợp có nhãn `SYNTHETIC TEST ONLY`. Chưa xác nhận Tenant hoặc Staff hoàn tất.
- **CT205:** đang thuê, ngày hết hạn cách ngày tạo fixture 10 ngày.
- **CT206:** hợp đồng gốc đang thuê và một bản gia hạn Draft kế tiếp, không sửa bản gốc.
- **CT207:** đang thuê, có yêu cầu trả phòng Requested.
- **CT208:** yêu cầu trả phòng Approved, giao Staff test kiểm tra lúc 10:00 ngày 07/11/2026
  theo Asia/Ho_Chi_Minh khi seed ngày 05/11. Chưa có baseline/kiểm tra thực tế; UI báo rõ điều kiện còn thiếu.
- **CT209:** tình huống hợp đồng Terminated trong quá khứ.
- **CT210:** hợp đồng Cancelled.
- **CT211:** một bản Main Superseded và bản Renewal Active kế tiếp, không chồng thời hạn.

Các hợp đồng đều đánh dấu `IsDevelopmentDemo`, điều khoản ghi rõ dữ liệu minh họa. Không tạo
ContractSignature, giao dịch/xác minh cọc hoặc giả xác minh danh tính; Resident mới vẫn Pending.
Các trạng thái Active/PendingActivation/Terminated là snapshot tổng hợp, không chứng minh
các precondition nghiệp vụ thực tế đã hoàn tất.

Đã thêm 12 công tơ/tác vụ Initial cho các phòng đang thuê trong bộ fixture. Hai tác vụ CT204
được xác nhận bằng API thật với ảnh tổng hợp; các tác vụ còn lại để Staff thử thao tác.
Ảnh bàn giao CT204 cũng ghi rõ không phải ảnh thực tế; không có ảnh CCCD hoặc dữ liệu cá nhân thật.

## Năm phần trong chi tiết

- **Tổng quan:** kỳ thuê, người ở, tiền thuê/cọc, điều khoản và tiến trình.
- **Ký & kích hoạt:** chữ ký, tài liệu/cọc/điều kiện theo quyền; Staff không được cấp thêm quyền Owner/Tenant.
- **Bàn giao:** biên bản, ảnh và chỉ số; chỉ mở thao tác khi hợp đồng đã kích hoạt.
- **Gia hạn & trả phòng:** bản gia hạn, yêu cầu, lịch kiểm tra, hiện trạng và quyết toán theo quyền/trạng thái.
- **Lịch sử:** các phiên bản và sự kiện; sự kiện tạo fixture được ghi rõ là dữ liệu minh họa.

Các form được tái sử dụng từ code hiện có. Đổi phần sẽ đóng action chưa gửi; khóa đổi phần khi đang upload ảnh.
Không dùng fixture FE để thay dữ liệu API.

## Công cụ tạo lại có kiểm soát

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-MobileContractOverview.ps1
. ./scripts/Use-LocalTools.ps1
node scripts/Seed-MobileContractHandoverExample.cjs
```

Seed chỉ hỗ trợ Development + PostgreSQL loopback + database `bhome`, đúng bộ Mobile test gốc
và Staff còn phân công hiệu lực. Khóa seed bằng advisory lock, dùng transaction, ID cố định,
kiểm tra va chạm và không ghi đè fixture đã tồn tại. Chạy lại đã kiểm tra: thêm 0 hợp đồng.
Các Tenant riêng của phòng CT dùng mật khẩu ngẫu nhiên không xuất ra log; không thay mật khẩu
Tenant test cũ và không cấp Tenant cũ quyền xem các hợp đồng CT.

Script bàn giao dùng API HTTPS từ `BHOME_MOBILE_TEST_API` hoặc `.tools/cloudflare/api-url.txt`,
chỉ thao tác hợp đồng demo CT204 có đúng ID/cơ sở. Nếu đã có biên bản thì giữ nguyên.
Ảnh tổng hợp và manifest upload ở `.tools/mobile-contract-overview`, Git ignore.

Đã sao lưu database trước lần thêm dữ liệu vào `.tools/private-backups`, ACL chỉ tài khoản Windows hiện tại.

## Kiểm chứng

- LocalDevelopment build đạt, 0 warning/error; seed lần đầu thêm 13 hợp đồng, chạy lại thêm 0.
- HTTPS live: Staff/Owner đều thấy 14 hợp đồng, đủ năm nhóm; GET chi tiết 13 hợp đồng mới trả 200.
- Staff thấy lịch CT208; move-out CT207/CT208 trả Requested/Approved.
- Tenant test vẫn chỉ thấy M101; truy cập hợp đồng CT của Tenant khác bị 404.
- CT204 upload ảnh/xác nhận meter/tạo biên bản dùng API hiện có; kết quả Draft version 1, không xác nhận thay Tenant.
- Mobile suite đạt 43 files / 425 tests; có 10 test bổ sung cho nhóm/section, quyền và ngữ cảnh action.
- Typecheck, lint và Expo export Web/iOS/Android đạt; bundle chưa phải APK/IPA đã nghiệm thu thiết bị.
- Chạy lại script bàn giao CT204 giữ nguyên version/chỉ số; không tạo lại ảnh hoặc biên bản.
- Chưa thực hiện ký provider, thanh toán/đối soát ngân hàng hoặc nghiệm thu UI trên điện thoại thật trong lượt này.
