# BHOME Tenant — Form báo sự cố và tích hợp API

Ngày 07/11/2026. Phạm vi: Tenant báo sự cố, lựa chọn phòng/tài sản, ảnh, gửi báo cáo và đường vào theo dõi. Liên quan BF-07, UC-26..30, GBR-11..12 và yêu cầu quyền/isolation của AGENTS.md; đối chiếu controller, IncidentContracts, IncidentService và IncidentRepository hiện có. Không sửa backend, database, API contract hoặc quy tắc nghiệp vụ. Giữ UI/form Staff hiện tại qua nhánh cũ của IncidentReportForm.

## 1. UI và component

- Tenant dùng form riêng `TenantIncidentReportForm`; Staff tiếp tục dùng ReportForm cũ.
- Header gọn: nút back, một tiêu đề “Báo cáo sự cố”, shortcut “Đã gửi” tới `tenant-requests`. WorkspaceShell bỏ hàng “Quay lại” trùng chỉ tại form Tenant, không đổi back control Staff. Subtitle tổng quát tránh tải contracts chỉ để lấy nhãn header.
- Bốn phần rõ ràng: vị trí, mức độ, mô tả, ảnh. Một CTA “Gửi báo cáo”; trạng thái gửi nằm trong nút. Không có nút reload toàn chiều rộng hoặc nút lịch sử lớn ở cuối.
- Dùng font Inter từ typography chung, title 22/30 bold, heading 16/22 semibold, label 13/20 medium, body 13/20 và helper 12/18. Navy #173654, primary #2563EB, background #F5F7FB, card radius 16 và input radius 12.
- Form nằm trong KeyboardFormScrollView của WorkspaceShell, không thêm ScrollView lồng trong form. Dialog có vùng scroll riêng qua Portal. Giữ keyboard handling, safe areas và bottom navigation hiện có; CTA trong vùng nội dung có padding đáy của shell.
- Mô tả multiline có minHeight 132 và textAlignVertical top. Counter theo văn bản thực; không cắt im lặng ở 8.000 ký tự. Inline validation đỏ xuất hiện sau tương tác/blur; helper giải thích trạng thái CTA chưa hợp lệ.

## 2. Nguồn dữ liệu phòng/cơ sở/tài sản

Chỉ dùng lookup dành cho quyền báo sự cố:

- `GET /api/v1/incidents/reporting-rooms?page=1&pageSize=20`
- `GET /api/v1/incidents/reporting-assets?locationId=...&roomId=...&page=1&pageSize=20`
- Với khu vực chung, không gửi roomId vào asset lookup; lọc các asset có roomId null và commonArea khớp khu vực đã nhập trong kết quả được phép.

Room response có roomId, roomNumber, locationId, locationName. Asset response có assetId, name, category, status, locationId, roomId/commonArea. Client validate page shape, GUID và scope location/room trước khi dùng.

Chỉ tự chọn khi backend trả **totalCount=1 và đúng một item**. Có nhiều phòng thì bắt buộc người dùng chọn rõ. Khi đã bắt đầu nhập/chọn ảnh, khóa lựa chọn tự động thành snapshot bản nháp: refresh nền không âm thầm chuyển báo cáo sang phòng khác. Nếu lookup xác định phòng cũ không còn hợp lệ, CTA bị chặn và yêu cầu chọn lại, giữ mô tả/ảnh.

Phân trang nằm trong dialog “Chọn phòng”/“Chọn tài sản”: “Tải thêm” chỉ tải trang tiếp theo khi được bấm, giữ các trang đã mở. Không tải hết danh sách và không đặt page controls trong form chính. Không thêm tham số tìm kiếm backend chưa hỗ trợ.

Room và asset lookup dùng shared useWorkspaceQuery/cache của phiên: staleTime 10 phút, GC 20 phút không có subscriber. Loader identity/path giống nhau giúp form và dialog dùng chung page 1/promise. Không dùng useIncidentQuery reload-on-focus cho lookup của form mới. Không tạo cache thứ hai hoặc cài thêm thư viện.

## 3. Validation và scope payload

- Có locationId được lấy từ room lookup có quyền.
- Trong phòng: roomId hợp lệ, commonArea null.
- Khu vực chung: roomId null, commonArea trim từ 1–200 ký tự; cơ sở lấy từ lựa chọn có quyền. Đổi phạm vi xóa commonArea/asset không tương thích.
- assetId tùy chọn, chỉ từ asset lookup phù hợp phạm vi. Không chọn thì null. Đổi phòng/scope bỏ asset cũ, không xóa mô tả hoặc ảnh.
- Severity chỉ Normal/Emergency. Emergency có nhãn và màu riêng, không hứa gọi dịch vụ khẩn cấp.
- Mô tả trim tối thiểu 10, văn bản tối đa 8.000 ký tự. Quá giới hạn vẫn giữ nguyên nội dung để người dùng sửa.
- Tối đa 5 ảnh, kiểu PNG/JPEG thật theo header, contentType phải khớp byte; kết quả cuối không vượt **5.000.000 byte/ảnh** (không phải 5 MiB).
- Busy/picking khóa form và các lần bấm gửi tiếp theo. Session/API/quyền backend vẫn là nguồn quyết định cuối; client không suy ra quyền từ route ID.

## 4. Camera, gallery và upload ảnh

`TenantIncidentPhotos` dùng expo-image-picker đã cài: camera qua launchCameraAsync với permission request, gallery qua system photo picker. Không xin broad library permission không cần thiết. Có hai nút compact, counter, thumbnail grid, xem lớn và xóa từng ảnh. Cancel, lỗi quyền hoặc lỗi một batch không bỏ những ảnh hợp lệ đã chọn trước.

Đọc byte native bằng File.bytes; web đọc File.arrayBuffer hoặc URI blob/data cục bộ do SDK tạo. Không đưa file:// URI, tên file gốc hoặc chuỗi base64 vào multipart. Preview dùng URI local, payload dùng byte.

Đối chiếu IncidentFiles/ImagePreprocessor cho thấy backend còn giới hạn **12.000.000 pixel, tối đa 16.000px mỗi cạnh**. Ảnh có metadata vượt pixel/cạnh hoặc dung lượng được đưa qua expo-image-manipulator hiện có, resize giữ tỷ lệ với cạnh dài tối đa 1920 (không phóng to) và save JPEG chất lượng 0.85. Đây là render/mã hóa ảnh thật, không đổi đuôi file. Native shared objects được release trong finally; byte đầu ra vẫn phải qua kiểm tra PNG/JPEG và giới hạn 5.000.000 byte. Ảnh không thể chuẩn hóa/đọc hợp lệ sẽ bị từ chối trước upload. HEIC/WebP/GIF không được nhận như thể chúng là JPG/PNG.

API dùng nguyên incidentClient/incidentMultipart hiện có:

`POST /api/v1/incidents`, multipart/form-data với locationId, roomId hoặc commonArea, assetId nếu có, severity numeric 0/1 theo ASP.NET enum, description UTF-8 và nhiều phần `images`.

Multipart được tạo bằng byte và boundary gắn với operation key. Content-Type chứa đúng boundary, tên file sinh evidence-N.png/.jpg theo nội dung, Bearer do MobileApi gắn. Không dùng FormData rồi ghi đè boundary sai.

Mỗi lượt upload có deadline client 90 giây và nối AbortSignal từ mutation. Timeout/gián đoạn không được hiểu là rollback server: báo chưa xác định kết quả, giữ draft và key để người dùng retry. Không tự retry POST.

## 5. Idempotency, thành công và theo dõi

Tái sử dụng useIncidentMutation với lock đồng bộ và Idempotency-Key GUID. Fingerprint gồm payload đã chuẩn hóa và IDs/type/length của các ảnh bất biến trong draft. Retry nguyên payload sau lỗi dùng lại key và boundary; sửa nội dung/phòng/mức độ/ảnh tạo signature khác và key khác. Không đổi key tự động khi mạng lỗi.

Backend Submit hiện trả HTTP 201 và IncidentCommandResult. Client kiểm tra incidentId là GUID không rỗng và shape các ID nullable trước khi toast/navigation. Response lỗi hoặc malformed không được coi là thành công.

Sau kết quả hợp lệ: toast “Đã gửi báo cáo sự cố thành công”, reset draft **sau** xác nhận rồi đi route `incident-detail` bằng ID server. Không đặt InProgress, Staff assignment hay hạn hoàn thành tại frontend.

MobileApi invalidation cho POST root incidents được thu hẹp về incidents/notifications; không tải lại invoice/contract/meter hoặc Staff task summaries không thay đổi. Giữ refresh event incident hiện có để list/tracking dùng source backend mới. “Đã gửi” tiếp tục mở `tenant-requests`.

Theo dõi tiếp tục dùng:

- `GET /api/v1/incidents`
- `GET /api/v1/incidents/{id}`
- `GET /api/v1/incidents/{id}/history`
- `GET /api/v1/incidents/{id}/evidence`
- `GET /api/v1/incidents/{id}/evidence/{imageId}` (binary authenticated)

Tenant detail không gọi work orders/expenses/emergency cost APIs. Thêm guard chỉ render evidence kind Report cho Tenant, ngay cả khi response bất thường chứa loại nội bộ. Backend vẫn kiểm quyền tải từng ảnh.

## 6. File trong lượt này

File mới:

- `src/mobile/src/features/incidents/TenantIncidentReportForm.tsx`
- `src/mobile/src/features/incidents/IncidentLookupDialog.tsx`
- `src/mobile/src/features/incidents/TenantIncidentStyle.ts`
- `src/mobile/src/components/TenantIncidentPhotos.tsx`
- `src/mobile/src/services/tenantIncidentReport.ts`
- `src/mobile/src/__tests__/tenant-incident-report.test.tsx`

File cập nhật:

- `src/mobile/src/features/incidents/IncidentReportForm.tsx`: tách nhánh Tenant; giữ Staff form.
- `src/mobile/src/features/incidents/IncidentScreens.tsx`: guard loại ảnh Tenant.
- `src/mobile/src/features/incidents/useIncidentData.ts`: success message tùy chọn; mặc định Staff giữ nguyên.
- `src/mobile/src/components/WorkspaceShell.tsx`: bỏ header trùng chỉ tại Tenant form, subtitle không gọi contracts.
- `src/mobile/src/lib/queryPolicies.ts`: invalidation riêng khi tạo incident.
- `src/mobile/src/__tests__/incident-integration.test.tsx`
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`

Working tree có nhiều task trước chưa commit; toàn bộ diff so với HEAD không phải chỉ của task này. `git diff --name-only -- src/backend` không có thay đổi.

## 7. Kiểm chứng

Node 22.23.4, runtime `.tools`:

- `npm run typecheck --workspace ./src/mobile`: PASS.
- `npm run lint --workspace ./src/mobile`: PASS, max-warnings 0.
- Targeted 4 file incident/form/live UI/navigation: **172 test PASS**.
- Full mobile suite: **702 test PASS, 60 file PASS; 1 suite lỗi import**. `tests/mobile/ocr/meterScreen.test.tsx` có mock react-native-paper thiếu MD3LightTheme từ trước lượt này; không gọi toàn bộ suite xanh.
- Expo web export: PASS, `.tools/tenant-incident-report-web`.
- `git diff --check`: PASS; cảnh báo CRLF/LF của file route thuộc working tree trước đó.

Các case được thực thi dùng mocked HTTP/native APIs: auth header và raw multipart UTF-8, ảnh/byte limit, chọn phòng trang 2, không tải thừa page 1, scope chung bỏ roomId/asset cũ, validation 8.001 ký tự không truncate, khóa double submit, retry exact key/body, edited payload đổi key, lỗi 400/401/403/404/409/413/500, timeout, malformed result/lookup, cache/account isolation, không tự chuyển phòng khi refresh, camera permission denial, preview/remove, bộ ảnh quá số lượng/không hỗ trợ, thao tác re-encode vượt pixel và guard ảnh nội bộ Tenant.

## 8. Giới hạn còn lại

- Chưa gửi báo cáo lên API/database/storage thật; không seed/migrate hoặc ghi dữ liệu người dùng. Test HTTP giả lập không chứng minh file đã được lưu E2E.
- Camera/gallery/permission dialogs, native JPEG encoding, upload interruption, keyboard/safe-area và chất lượng hiển thị cần manual trên Android/iOS thật. Web build không thay thế kiểm thử thiết bị.
- Lookup hiện chỉ trả phòng đủ điều kiện theo hợp đồng Active, TenantUserId và thời gian cư trú của người đại diện. Không mở rộng quyền cho mọi người cùng phòng khi backend chưa cho phép; empty state không sinh phòng giả.
- Tenant chỉ xem báo cáo của mình và ảnh Report; không có ảnh Inspection/Completion hoặc chi phí/work order Staff trong quyền Tenant hiện tại.
- Common area là text theo contract hiện có; không có danh mục khu vực chung/search endpoint mới. Asset tùy chọn, có thể để null.
- Draft/bytes ở RAM theo account/component; giữ khi picker hoặc focus tạm thời, không hứa khôi phục sau process termination. Cache server data không chứa ảnh draft, token hoặc giấy tờ. Ảnh/preview SDK sử dụng app cache tạm của hệ điều hành, không thêm kho lưu trữ persistent của ứng dụng.
- Khi quyền hoặc danh mục đổi sau lần đọc cache, backend vẫn revalidate lúc submit; client xử lý lỗi và giữ draft, không bypass authorization.

Đã đối chiếu [Expo ImagePicker SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/), [FileSystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/) và [ImageManipulator](https://docs.expo.dev/versions/v58.0.0/sdk/imagemanipulator/).
