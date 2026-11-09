# Tenant Mobile — My Room UI completion

Ngày thực hiện: **07/11/2026**, trên `member/Long`, nền source `1a4dc83` và working tree của lượt này. Phạm vi chỉ Tenant → Phòng của tôi; không thay backend, schema, authentication hoặc authorization. Không commit/push trong lượt này.

## Phạm vi và tiêu chí

Yêu cầu người dùng → FE-07 Tenant self-service, BF-04/UC-17 hợp đồng và bàn giao, GBR-01/02 phân quyền/dữ liệu theo người dùng. ID yêu cầu dựa trên quy ước AGENTS.md và tài liệu repository; không tuyên bố đã nghiệm thu toàn bộ SRS. Nguồn kỹ thuật đã đối chiếu: `ContractsController`, `ContractService.GetAsync/ListAsync/GetHandoverAsync`, DTO `ContractContracts.cs`/`ContractHandoverContracts.cs`, các type/formatter client hiện có và báo cáo audit Tenant My Room ngày 07/11/2026.

Tiêu chí: một hợp đồng hiện trực tiếp; nhiều hợp đồng cần chọn rõ theo ID; không tự chuyển khi lựa chọn mất khỏi danh sách; đọc handover chỉ sau khi detail được cấp quyền đã tải thành công; 404 handover là trạng thái thiếu biên bản, 401/403/404 detail vẫn là lỗi; payload sai không gây crash/render dữ liệu giả; điều hướng đúng hợp đồng/section; giữ dữ liệu tiền ở dạng chuỗi; không hiển thị CCCD hoặc dùng API quản lý phòng Staff.

## A. Files Modified

| File                                                     | Mục đích                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mobile/src/screens/TenantRoomScreen.tsx`            | Thẻ phòng/hợp đồng gọn; ngày và tiền hai cột có wrap; người ở/avatar/badge; summary bàn giao; header refresh; loading/error/empty riêng; pagination chỉ khi hơn một trang.                                                                                                        |
| `src/mobile/src/features/tenant/useTenantTenancy.ts`     | Bám lựa chọn và page theo API instance; chọn rõ khi nhiều hợp đồng; không fallback âm thầm khi lựa chọn mất; gate handover sau detail; refresh ba query. Các read/selection chuyên biệt My Room chỉ bật khi `withDetails=true`; màn tạm trú gọi false giữ luồng không tải detail. |
| `src/mobile/src/services/tenantRoom.ts`                  | Loader read-only kiểm JSON page/detail/handover, ID GUID và ID detail khớp request, ngày/tiền/occupants/snapshot hợp lệ; chỉ xử lý 404 của handover thành null; chặn detail không còn Active hoặc là Holding.                                                                     |
| `src/mobile/src/features/workspace/useWorkspaceQuery.ts` | Thêm loader tùy chọn và tùy chọn tắt toast tự động để My Room có lỗi inline gọn. Mặc định các consumer cũ giữ cách request/hiển thị toast. Giữ AbortController và identity API/path/revision.                                                                                     |
| `src/mobile/src/components/WorkspaceShell.tsx`           | Chỉ với Tenant `tenant-room`: gắn RefreshControl vào ScrollView hiện có, spacing gọn và subtitle trung tính để không gắn nhầm phòng đầu danh sách lên header. Không thêm ScrollView dọc thứ hai, giữ safe-area/bottom tabs; Owner/Staff không bật thay đổi này.                   |
| `src/mobile/src/features/contracts/ContractScreen.tsx`   | Nhận `section` đã kiểm danh sách cho Tenant; mở tab overview/handover đúng intent từ My Room. Reuse LiveContractDetail và quyền workflow hiện có.                                                                                                                                 |
| `tests/mobile/ocr/liveWorkspace-ui.test.tsx`             | Bổ sung case dữ liệu hợp lệ, selection, removal/refresh/paging, missing handover, unauthorized, invalid response, network/server retry, bounded asset preview; cập nhật fixture đủ field cần hiển thị và mock accessibility role.                                                 |
| `src/mobile/src/__tests__/contract-sections.test.tsx`    | Kiểm tra Tenant mở thẳng bàn giao và section không hợp lệ rơi về overview.                                                                                                                                                                                                        |
| `src/mobile/src/__tests__/workspace-navigation.test.tsx` | Kiểm tra pull-to-refresh chỉ ở My Room, cleanup khi rời màn và giữ bottom tabs; giữ test Staff header refresh.                                                                                                                                                                    |
| `docs/development/TENANT_MY_ROOM_UI_2026-11-07.md`       | Bàn giao, mapping và bằng chứng kiểm tra của lượt này.                                                                                                                                                                                                                            |

File audit auth chưa track từ lượt trước được giữ nguyên. Không sửa `TENANT_MY_ROOM_AUDIT_2026-11-07.md` hoặc các snapshot API ngày 06/11.

## B. API Field Mapping

| UI Field            | Backend Property                           | Displayed                                                               |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Room number         | `ContractView.roomNumber`                  | Có, tiêu đề chính của thẻ.                                              |
| Location            | `locationName`                             | Có, dưới số phòng.                                                      |
| Contract status     | `status`                                   | Có, badge nhãn tiếng Việt.                                              |
| Contract type       | `kind`                                     | Có, nhãn tiếng Việt; không đưa Holding vào phòng đang thuê.             |
| Start/end date      | `startDate`, `endDate`                     | Có, formatter `displayContractDate`, hai cột.                           |
| Monthly rent        | `monthlyRent`                              | Có, `formatContractMoney`, tiền Việt; không tính nghĩa vụ thanh toán.   |
| Required deposit    | `requiredDeposit`                          | Có, ghi rõ “Tiền cọc yêu cầu”, không khẳng định cọc đã trả.             |
| Occupants           | `occupants[].id/label/representative`      | Có, ID làm key; label và badge đại diện; null/[] có empty state.        |
| Handover status     | `handover.status`                          | Có, nhãn tiếng Việt trong summary.                                      |
| Handover date       | `snapshot.date`                            | Có, dd/MM/yyyy.                                                         |
| Room condition      | `snapshot.roomCondition`                   | Có.                                                                     |
| Keys/access         | `snapshot.keysAndAccess`                   | Có.                                                                     |
| Electricity         | `snapshot.electricity.value`               | Có, số backend dạng chuỗi + kWh.                                        |
| Water               | `snapshot.water.value`                     | Có, số backend dạng chuỗi + m³.                                         |
| Tenant confirmation | `tenantConfirmedAt`                        | Có, `formatInstant`; null hiện chưa xác nhận.                           |
| Assets              | `snapshot.assets[].name/observedCondition` | Có tổng số và tối đa ba tài sản xem trước; còn lại ở biên bản chi tiết. |

Điều khoản/chữ ký đầy đủ, lịch sử và tài liệu vẫn ở ContractScreen và các tab sẵn có; không sao chép toàn bộ trang hợp đồng vào My Room.

Các API dùng: `GET /api/v1/contracts?page=...&pageSize=20&status=Active`, `GET /api/v1/contracts/{id}`, `GET /api/v1/contracts/{id}/handover`. History/previews tiếp tục được gọi tại chi tiết bằng các endpoint hiện có. Không phát sinh API mới hoặc request ghi từ My Room.

## C. Issues Fixed

- Bỏ ba nhóm nút “Tải lại dữ liệu” full-width; có một refresh icon ở header và pull-to-refresh trên ScrollView của shell. Lỗi thật có nút “Thử lại” nhỏ theo phần lỗi.
- Một hợp đồng trên danh sách đầy đủ hiện trực tiếp, không có dropdown/pagination dư. Nhiều hợp đồng cần chọn rõ; label gồm phòng, cơ sở, kỳ thuê và loại. Khi dữ liệu có nhiều trang, luôn cho chọn rõ vì trang hiện tại không chứng minh chỉ có một hợp đồng thuê trên toàn danh sách.
- Nhớ ID hợp đồng đã chọn; nếu bị loại khi refresh/chuyển trang, ẩn detail cũ và thông báo cần chọn lại, không tự gán hợp đồng đầu trang. Page/lựa chọn không chuyển sang account/API instance mới.
- Bàn giao chỉ tải sau detail đúng ID, Active, không phải Holding đã trả thành công. 404 của đúng endpoint handover được hiểu là chưa có biên bản; 404 detail, 403 và lỗi mạng/server không bị chuyển thành dữ liệu rỗng toàn cục.
- Payload page/detail/handover sai cấu trúc, ID sai, ID detail khác request, ngày/amount sai và handover status lạ trở thành lỗi phản hồi với retry. Không render mã status lạ, raw payload hoặc dữ liệu identity ngoài occupants DTO.
- “Xem chi tiết hợp đồng” gửi `{contractId, section:'overview'}`; “Xem biên bản bàn giao” gửi `{contractId, section:'handover'}` qua route hiện có. Không thêm nút xác nhận Tenant tại summary.
- UI dùng palette/font/components BHOME, card trắng/border, khoảng cách 8/12/16, các cột wrap và minWidth nhỏ để tránh khóa chiều rộng ở thiết bị hẹp; không giữ tên phòng đầu danh sách trên topbar khi người dùng đang chọn phòng khác.

### Giới hạn còn lại

- Tổng trang lấy từ `totalCount` của backend cho các Active contracts, có thể gồm Holding rồi được lọc khỏi lựa chọn tại client. Không gắn tổng này với nhãn “số phòng đang thuê”; chưa có filter kind backend trong endpoint đã kiểm tra. Trang chỉ có Holding có empty state “trên trang này” và vẫn có điều hướng trang nếu cần.
- Khi backend bỏ một lựa chọn khỏi trang, app không kết luận hợp đồng đã bị xóa hoặc tự chọn thay; người dùng chọn lại hoặc mở danh sách hợp đồng.
- Layout được thiết kế bằng style responsive và giữ safe area hiện có, nhưng **chưa được kiểm tra trực quan bằng screenshot trên màn 320/375px hoặc thiết bị thật**. Browser access host và native pipe của công cụ UI đều không khả dụng trong lượt này. Preview synthetic tạm thời đã dừng; không dùng dữ liệu preview làm bằng chứng backend runtime.
- Chưa chạy Mobile → backend → Compact24/storage thật, chưa nghiệm thu Android/iOS hoặc xác nhận bàn giao. Không tuyên bố production acceptance/E2E PASS.

## D. Testing Results

### Các kiểm tra đạt

1. **Targeted tests:**

```powershell
npm run test --workspace ./src/mobile -- ../../tests/mobile/ocr/liveWorkspace-ui.test.tsx src/__tests__/contract-sections.test.tsx src/__tests__/workspace-navigation.test.tsx
```

Kết quả cuối: **3 file, 95 test qua**, exit 0. Tổng này gồm các case nền của ba file, không phải 95 test riêng màn My Room. Coverage bổ sung gồm một/nhiều/không có Active contract, filter Holding, occupants null/[], room/detail/amount/date/navigation, gate handover, handover 404 vs detail 401/403/404, server/network retry, page/detail/handover malformed, ID không hợp lệ/không khớp, selection removal, switch contract và switch account, pagination, asset preview, section whitelist và shell pull-to-refresh.

2. **Lint:** `npm run lint --workspace ./src/mobile` — exit 0, không lỗi/cảnh báo.
3. **Typecheck:** `npm run typecheck --workspace ./src/mobile` — exit 0.
4. **Build web:** từ `src/mobile`, chạy local Node 22 với `../../node_modules/expo/bin/cli export --platform web --output-dir ../../.tools/tenant-room-web` — exit 0; Metro bundle 1.213 modules, xuất web assets/bundles thành công. Đây là kiểm tra đóng gói, không phải kiểm tra giao diện đã render hoặc gọi API thật.
5. **Whitespace:** `git diff --check` — exit 0.

### Kiểm tra hồi quy rộng hơn

```powershell
# Working directory: src/mobile
& ../../.tools/node-v22.23.4-win-x64/node.exe ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

Kết quả: **55 file qua, 1 file lỗi load suite; 594 test đã chạy đều qua; exit 1**. File lỗi là `tests/mobile/ocr/meterScreen.test.tsx`: mock `react-native-paper` thiếu export `MD3LightTheme`, lỗi tại import theme trước khi test chạy. Lỗi này đã được thấy trước task My Room; không sửa test đồng hồ không liên quan để mở rộng scope. 95 targeted tests nằm trong 594, không cộng hai số này.

### Chưa thực thi

- Manual visual trên thiết bị nhỏ, screenshot, gesture pull-to-refresh Android/iOS và kiểm tra trợ năng trên thiết bị.
- API/database/storage E2E và các hành động xác nhận bàn giao.
- Backend tests trong lượt implementation: không đổi backend. Lỗi compile fixture `ChargeInput` ở audit trước không được tuyên bố đã sửa.

### Tài liệu API nền tảng đã đối chiếu

Đã kiểm phiên bản Expo 58 trong package.json và [SDK 58 reference](https://docs.expo.dev/versions/v58.0.0/). Route section dùng local search params theo [Expo Router URL parameters](https://docs.expo.dev/router/reference/url-parameters/); pull-to-refresh dùng control trên ScrollView hiện có theo [React Native RefreshControl](https://reactnative.dev/docs/refreshcontrol).
