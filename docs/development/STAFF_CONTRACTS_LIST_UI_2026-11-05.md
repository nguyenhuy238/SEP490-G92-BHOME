# Staff Mobile — danh sách hợp đồng gọn, 5 hợp đồng/trang

Phạm vi BF-03/04, UC-13..19 và quyền hiện có. Refactor riêng danh sách hợp đồng Staff;
giữ màn Owner/Tenant, API, schema, vòng đời hợp đồng và dữ liệu đang có.

## Giao diện

- Giữ thanh BHOME Staff và bốn tab dưới. Header nội dung gọn: Quay lại, Hợp đồng, icon tải lại.
- Tổng số lấy từ toàn bộ dữ liệu API, phụ đề ngắn và nút `+ Tạo mới` mở luồng nháp Staff hiện có.
- Lịch kiểm tra là một dòng icon/lịch/số lượng/chevron; bấm mở rộng và chọn lịch để vào hợp đồng được giao.
- Tab trạng thái cuộn ngang: Tất cả, Bản nháp, Chờ ký, Chờ kích hoạt, Đang hiệu lực, Đã kết thúc.
  Nhóm cuối dùng các enum Terminated/Superseded/Cancelled hiện có, không thêm enum Backend.
- Thẻ trắng viền nhẹ, padding 12, radius 14; phòng/tiền thuê nổi bật, cơ sở/kỳ thuê nhỏ hơn,
  badge theo trạng thái và chevron. Bấm cả thẻ để mở chi tiết, bỏ nút lớn lặp lại.
- Chỉ render tối đa năm thẻ trong ScrollView hiện có; không lồng FlatList dọc vào ScrollView dọc.
  Chỉ tab trạng thái cuộn ngang. Pagination có đệm cuối nội dung và bottom navigation nằm ngoài vùng cuộn.

## Tìm kiếm, sắp xếp và phân trang

- API hiện có `page/pageSize=20`, chưa hỗ trợ tìm kiếm/sắp xếp theo yêu cầu.
  `loadStaffContracts` tải đủ các trang của tài khoản Staff rồi mới tính số đếm và phân trang UI.
- Thứ tự: tìm kiếm + trạng thái → sắp xếp → lấy tối đa 5 thẻ/trang.
- Tìm theo phòng, ID hợp đồng, cơ sở, loại hợp đồng; không phân biệt hoa/thường và dấu tiếng Việt.
  Số đếm trên tab tương ứng tập kết quả tìm kiếm.
- Sắp xếp theo ngày bắt đầu thuê mới/cũ hoặc tiền thuê tăng/giảm. ContractSummary không có updatedAt,
  vì vậy không gắn nhãn “Mới cập nhật” cho ngày thuê. Tiền được so sánh bằng chuỗi/BigInt, không mất độ chính xác Number.
- 14 hợp đồng hiện tại: trang 1 có 5, trang 2 có 5, trang 3 có 4; hiển thị khoảng kết quả và số trang.
- Đổi tìm kiếm/trạng thái/sắp xếp trở về trang 1; quay lại từ chi tiết giữ bộ lọc và trang đã chọn.
  Nếu tải lại có ít dữ liệu hơn, trang hiển thị được giới hạn lại cho hợp lệ.
- Loading/error/empty riêng; lỗi tải không bị báo là “không có hợp đồng”. Nếu một trang API không tiến triển
  hoặc totalCount đổi trong lúc tải, yêu cầu tải lại thay vì đưa số đếm sai.
- Lỗi lịch kiểm tra không chặn danh sách hợp đồng. Refresh dùng lại các GET hiện có, không ghi dữ liệu nghiệp vụ.

## File chính

- `src/mobile/src/features/contracts/StaffContractsList.tsx`: giao diện và tải dữ liệu danh sách Staff.
- `src/mobile/src/features/contracts/staffContractList.ts`: tải đủ trang, tìm kiếm/sắp xếp/phân trang, màu trạng thái.
- `src/mobile/src/features/contracts/ContractScreen.tsx`: chọn danh sách Staff mới; giữ create/draft/detail và context trang khi quay lại.
- `src/mobile/src/components/WorkspaceHeaderContext.ts`: đăng ký action tải lại của danh sách trong header shell.
- `src/mobile/src/components/WorkspaceShell.tsx`: header gọn riêng Staff signing, giữ safe area/tab bar và màn khác.
- Test: `staff-contract-list.test.tsx`, `contract-sections.test.tsx`, `workspace-navigation.test.tsx`.

Các callback mở nháp, hợp đồng, hồ sơ onboarding và lịch kiểm tra dùng lại luồng hiện có.
Chi tiết hợp đồng, ký/kích hoạt, bàn giao, gia hạn/trả phòng và phân quyền Backend không thay đổi.

## Kiểm chứng

- Mobile suite: 44 files / 449 tests đạt; typecheck, lint, Prettier và git diff --check đạt.
- Expo export Web/iOS/Android đạt tại `.tools/staff-contracts-compact-export` (bundle, chưa phải APK/IPA đã cài trên máy).

- Kiểm thử 14 kết quả ra 5 + 5 + 4, giới hạn nút trước/sau và reset khi đổi bộ lọc.
- Kiểm thử search/status/sort đồng thời, tiếng Việt không dấu, ID, số tiền lớn, empty/error/loading,
  tải đủ nhiều trang API, dữ liệu thay đổi khi tải, refresh, giữ context khi quay lại chi tiết.
- Kiểm thử callback tạo/xem hợp đồng, mở lịch CT208, header refresh và giữ bốn tab Staff.
- Đối chiếu helper và client thật với HTTPS API: 14 hợp đồng, tab Draft 2/PendingSigning 1/
  PendingActivation 1/Active 7/đã kết thúc 3, ba trang 5/5/4, tìm CT208 ra 1, lịch được giao 1.
  Không thay đổi dữ liệu hợp đồng/database trong lượt refactor.
- Công cụ Computer Use/browser không kết nối được; chưa kiểm chứng trực quan hoặc tương tác thật
  trên điện thoại Android/iOS. Test DOM/native mock và bundle không thay thế nghiệm thu thiết bị.
