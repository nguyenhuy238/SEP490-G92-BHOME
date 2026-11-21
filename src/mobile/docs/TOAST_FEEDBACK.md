# Toast và phản hồi thao tác BHOME Mobile

Phạm vi: cải thiện phản hồi giao diện cho Owner, Staff và Tenant theo yêu cầu người dùng.
Liên quan FE-02, UC-01/13/15 và các thao tác tác nghiệp đang có. Không đổi API, schema,
quyền truy cập, validation, xác nhận thanh toán hoặc trạng thái nghiệp vụ.

## Công nghệ và lựa chọn

- Expo 58, React Native 0.88, React 19, TypeScript và Expo Router.
- UI: React Native Paper; icon: MaterialCommunityIcons qua `@expo/vector-icons`.
- Đã kiểm tra package và source: chưa có Toast/Snackbar dùng chung trước lượt triển khai này.
- Tái sử dụng Paper, Animated và Safe Area hiện có. Không thêm package, Capacitor hoặc native module.
- Không tích hợp Toast vào Push Notification, inbox hoặc dữ liệu thông báo nghiệp vụ được lưu server.

## Sử dụng

Root Layout bọc SessionProvider và WorkspaceProvider bằng `ToastProvider` bên trong PaperProvider
và SafeAreaProvider. Tất cả role dùng cùng store và renderer.

```tsx
import { showSuccess, showError, showWarning, showInfo } from '../lib/toast';

// Gọi sau khi promise thao tác backend đã thành công, không gọi trong render.
showSuccess('Máy chủ đã lưu thông tin.');
showError('Không thể kết nối máy chủ. Vui lòng thử lại.');
showWarning('Kiểm tra lại chỉ số điện trước khi xác nhận.');
showInfo('Bạn có một nhiệm vụ mới.', 'Công việc');
```

Success/Info tồn tại 3 giây; Warning 4 giây; Error 5 giây, sau đó fade out 180ms.
Có nút đóng 44×44. Toast trắng, radius 16, icon/màu riêng cho từng loại, font Inter và màu BHOME.
Hiển thị dưới top Safe Area 8px, giới hạn chiều rộng 560 và cho text xuống dòng.
Hỗ trợ Reduce Motion, accessibility alert và thông báo screen reader.

Store chỉ giữ một Toast; thông báo mới thay thông báo cũ, thông báo trùng đang hiện không
khởi động lại timer. Callback/timer cũ không được xóa Toast mới. Không phát lại Toast khi re-render.
Toast tiếp tục sau điều hướng; app chuyển nền sẽ xóa Toast và timer.

Native Modal có cửa sổ riêng, nên modal CCCD và hợp đồng đặt cùng `ToastHost modal` bên trong.
Host trên cùng nhận quyền hiển thị; root không hiển thị thêm bản sao. Đóng modal trả Toast còn hạn
về root với cùng ID và thời gian còn lại, không tạo component Toast riêng cho từng màn hình.

## Tích hợp nghiệp vụ hiện hữu

- `useFeedbackState`: giữ feedback ngắn tại màn hình và phát Toast tại thời điểm setter được gọi.
  Xóa lỗi hoặc render lại không tạo Toast. Dùng trong các màn setup, hợp đồng, OCR,
  nhiệm vụ, thông báo, bảo mật và yêu cầu Tenant.
- Lỗi tải dữ liệu qua `useWorkspaceQuery`, scope tiếp nhận và Owner overview cũng được rút gọn.
- Contract Draft: chỉ Success sau response lưu có status Draft; replay đã Cancelled vẫn là lỗi.
  Giữ form khi save lỗi, chống bấm lặp và giữ mutation key. Nếu chuyển PDF lỗi, Warning nói rõ
  bản nháp/DOCX vẫn được giữ; không báo đã có PDF. Màn kết quả và xem lại hợp đồng giữ nguyên.
- Hợp đồng cũ: thao tác thành công báo server đã ghi nhận, không suy ra đã ký/đã thanh toán/đã kích hoạt.
- CCCD: đề xuất OCR là Info/Warning; Success chỉ sau server xác nhận Verified, không áp dụng cho preview.
- Điện nước: Success sau server lưu chỉ số; mọi quy tắc xác nhận/chỉ số giảm giữ nguyên backend.
- Nhiệm vụ: Success sau server lưu thao tác/ảnh/công việc. Tenant gửi điều chỉnh chỉ báo đã gửi,
  vẫn chờ Owner xem xét. Đổi mật khẩu báo thành công sau server xử lý và thu hồi phiên.
- Copy thông tin thanh toán là Info; không biến thao tác copy hoặc đăng ký chuyển khoản thành thanh toán thành công.
- Các màn demo/unavailable vẫn thể hiện đúng trạng thái mẫu/chưa triển khai, không thêm API hoặc Success giả.
- Giữ nguyên Alert xác nhận rời Draft, dialog bỏ thay đổi và các bước xác nhận thao tác quan trọng.

## Lỗi ngắn và bàn phím

`conciseMessage` bỏ phần đường dẫn request, HTTP status và mã truy vết khỏi copy thông thường.
Đối tượng API error gốc vẫn giữ diagnostics cho công cụ chẩn đoán; không sửa transport hoặc retry.
Không hiển thị nguyên văn exception runtime/backend identifier. Thông báo quá dài dùng câu hướng dẫn ngắn;
validation tại ô và các blocker nghiệp vụ riêng trên màn hình vẫn được giữ.
Thêm bản dịch cho các code CCCD `invalid_confirmed_identity` và `invalid_input`, không đổi validation.

`KeyboardFormScrollView` dùng native ScrollView responder để đưa ô focus lên trên bàn phím với
khoảng trống 24px. Đo lại sau keyboardDidShow, hủy frame/listener khi đóng màn hình.
KeyboardAvoidingView dùng padding trên iOS, height trên Android; không cộng thêm keyboard inset iOS
lần thứ hai. Áp dụng ở WorkspaceShell, Login, Page chung, modal CCCD và modal hợp đồng.
Giữ footer và nội dung cuộn trong vùng có xử lý keyboard; không thêm chiều cao bàn phím cố định.

## File tạo mới

- `src/lib/toast.ts`, `src/lib/useFeedbackState.ts`.
- `src/components/ToastHost.tsx`, `src/components/KeyboardFormScrollView.tsx`.
- `src/__tests__/toast.test.ts`, `toast-host.test.tsx`, `keyboard-form.test.tsx`.
- Tài liệu này.

## File tích hợp/chỉnh sửa

- `src/app/_layout.tsx`, `capture.tsx`, `meter.tsx`, `ocr-test.tsx`, `resident.tsx`, `setup.tsx`.
- `src/components/Controls.tsx`, `WorkflowControls.tsx`, `WorkspaceShell.tsx`,
  `WorkspaceQueryState.tsx`, `CameraCapture.tsx`.
- `src/features/contracts/ContractActionForm.tsx`, `ContractDraftForm.tsx`, `ContractEvidence.tsx`,
  `ContractExpiryPanel.tsx`, `ContractHandoverPanel.tsx`, `ContractLifecyclePanel.tsx`,
  `ContractScreen.tsx`, `ContractWorkflowPanel.tsx`, `MainDraftScreen.tsx`, `MainDraftStart.tsx`.
- `src/features/onboarding/IdentityFlowFrame.tsx`, `IdentityWizard.tsx`, `useCaptureScope.ts`.
- `src/features/workspace/useWorkspaceQuery.ts`, `src/lib/api.ts`.
- `src/screens/AccountSecurityScreen.tsx`, `LiveWorkspaceScreens.tsx`, `LoginScreen.tsx`,
  `NotificationsScreen.tsx`, `OnboardingScreen.tsx`, `OperationalTaskScreens.tsx`,
  `OwnerOverviewScreen.tsx`, `SharedScreens.tsx`, `StaffScreens.tsx`, `TenantAdjustmentPanel.tsx`,
  `TenantPaymentPanel.tsx`, `TenantScreens.tsx`, `TenantWorkflowScreens.tsx`.
- Test: `src/__tests__/setup.ts`, `main-draft-screen.test.tsx`,
  `tests/mobile/ocr/liveWorkspace-ui.test.tsx`, `connectivity-ui.test.tsx` (ở thư mục gốc repository).

## Kiểm tra

- Mobile: 322 test PASS, gồm thời gian tự đóng, đóng thủ công, thay/chống trùng, host Modal,
  Safe Area, animation, background cleanup và cuộn ô focus/giải phóng listener.
- Test hợp đồng xác nhận không Success trước response, không gửi save lặp, lỗi giữ form,
  retry đúng key, replay Cancelled không Success, PDF thiếu converter là Warning.
- Test lỗi quyền/không tìm thấy/đổi mật khẩu vẫn kiểm tra từ chối hành động, không giữ dữ liệu cũ,
  không đọc nhầm thông báo và không logout khi backend từ chối; copy mới không chứa HTTP diagnostic.
- TypeScript/lint và Android export PASS. Không cần development build mới cho Expo Go.
- Chưa kiểm tra trực quan trên thiết bị Android/iPhone thật. Native mocks và export không thay thế
  kiểm tra bàn phím, notch, font scale và screen reader trên thiết bị.

Tham chiếu: [Expo 58](https://docs.expo.dev/versions/v58.0.0/),
[KeyboardAvoidingView](https://reactnative.dev/docs/keyboardavoidingview),
[ScrollView](https://reactnative.dev/docs/scrollview), [Animated](https://reactnative.dev/docs/animated).
