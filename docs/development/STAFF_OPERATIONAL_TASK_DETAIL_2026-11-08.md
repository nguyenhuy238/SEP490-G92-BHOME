# Staff — chi tiết công việc vận hành

Ngày 08/11/2026. Phạm vi: màn live Staff `task-detail`, theo yêu cầu redesign đính kèm. Dùng nghiệp vụ BF-02/công việc vận hành và API Staff hiện có; không thay Backend, quyền Owner, Incident Work Order hoặc bố cục danh sách công việc.

## Giao diện đã triển khai

- Header “Chi tiết công việc”, back, tải lại và kéo để cập nhật; giữ bốn tab Staff.
- Tổng quan ngắn: tên tối đa ba dòng, trạng thái tiếng Việt, ưu tiên cao khi có, thời hạn theo giờ Việt Nam.
- PendingVerification ưu tiên “Chờ Owner kiểm tra”, vẫn giữ ngày hạn nhưng không nhấn đỏ quá hạn.
- Yêu cầu công việc giữ đầy đủ nội dung. Nội dung dài có Xem thêm/Thu gọn; nội dung ngắn không bị cắt vĩnh viễn.
- Hình ảnh private tải bằng API có xác thực, grid thumbnail, bấm xem lớn, tải lại ảnh lỗi và trạng thái rỗng.
- Lịch sử thật: ban đầu ba mục; mở rộng và chuyển trang khi có hơn 20 mục. Không hiển thị UUID, version, raw enum hoặc tự gán tên/vai trò cho người thực hiện chỉ từ ID.
- Một nút cố định cuối vùng nội dung, nằm trên tab bar. Assigned mở form bắt đầu với ghi chú tùy chọn; InProgress mở sheet ba lựa chọn; PendingVerification/Completed/Cancelled/trạng thái chưa biết chỉ đọc.
- Mỗi form có nhãn riêng: Nội dung cập nhật, Mô tả khó khăn đang gặp, Kết quả thực hiện. Không hiển thị nhiều form cùng lúc.
- Nội dung tiến độ/vướng mắc được đọc qua lịch sử. Kết quả được hiển thị từ `TaskView.result`, không tự đưa ghi chú tiến độ vào kết quả.
- Camera dùng pipeline Expo Camera hiện có với presentation `evidence`: modal native toàn màn hình, nền đặc, không nằm trong ScrollView. Camera chỉ mount khi đang chụp; sau capture chuyển sang ảnh thật ở chế độ contain, có Chụp lại / Dùng ảnh. Chế độ OCR/meter không đổi.
- Preview giữ ảnh sau upload lỗi; retry chưa rõ kết quả khóa chụp lại để không thay payload. Đóng/Back/background/unfocus giải phóng camera và file tạm; không cho đóng trong lúc đang gửi. Upload trả boolean xác nhận để camera chỉ đóng sau khi PUT và các GET tiếp theo thành công.
- Evidence chỉ đếm metadata do Backend trả về. Lịch sử và các section dùng khoảng cách gọn hơn; ghi chú dài có Xem ghi chú / Thu gọn ghi chú.

## Kết nối và tính nhất quán

`StaffTaskDetailScreen` dùng `useStaffTaskDetail`, shared mobile transport và adapter `operationalTasks`.

- GET detail, history và metadata evidence dùng taskId đang mở, cache theo tài khoản/path/tag `tasks` hiện có.
- POST start/progress/blockers/submit gửi version hiện tại và Idempotency-Key UUID. Chỉ đưa TaskView trả về vào state sau response thành công.
- PUT evidence gửi bytes trực tiếp. Sau upload thành công phải GET TaskView và metadata ảnh thành công trước khi mở lại thao tác ghi; không suy ra version từ số tăng dự kiến.
- Khi lỗi mạng/timeout/5xx chưa rõ kết quả, lưu nguyên payload và Idempotency-Key; thử lại dùng đúng cặp đó, khóa sửa nội dung của lần gửi chưa xác nhận.
- Nếu upload đã trả metadata nhưng GET sau đó lỗi, thử lại chỉ đọc trạng thái/metadata; không upload lần hai.
- Khi 409: giữ ghi chú, đọc lại dữ liệu, yêu cầu người dùng đánh dấu đã kiểm tra dữ liệu mới rồi xác nhận gửi lại bằng version mới. Nếu trạng thái/phân công mới không cho phép, không gửi tiếp.
- Khóa đồng thời việc upload/action, chặn double tap, bắt buộc ảnh khi backend yêu cầu. Buffer ảnh retry chỉ giữ trong bộ nhớ và được xóa sau hoàn tất/unmount.
- Thao tác Staff chỉ mở khi là đúng người phụ trách hiện tại, responsibilityAvailable, kind AdHoc và trạng thái phù hợp. Unknown status không phát sinh action.
- Focus, refresh và chu kỳ 30 giây khi app active đọc lại trạng thái. Lỗi truy cập dùng cơ chế xóa cache dữ liệu riêng tư hiện có. Lỗi hiển thị tiếng Việt, không kèm đường dẫn API/stack trace.
- Modal có keyboard avoidance, scroll form và safe area dưới. Không thêm thư viện UI.

## Kiểm chứng

- `npm run typecheck --workspace ./src/mobile`: PASS.
- `npm run lint --workspace ./src/mobile`: PASS.
- Bốn file test liên quan: **181 test PASS** — `liveWorkspace-ui`, `workspace-navigation`, `document-camera`, `capture-scope`.
- Bao phủ state/action, cập nhật từ TaskView, lưu progress/blockers vào lịch sử, khóa nút khi thiếu ảnh, payload/version/key, giữ nội dung khi 409, retry upload/action không trùng, đọc lại version sau upload, không ghi khi mất quyền/phân công, PendingVerification/Completed/Cancelled/unknown read-only.
- Đã kiểm tra trên Android emulator: header, overview, requirements, evidence rỗng, sticky action bar và sheet ba lựa chọn hiển thị đúng với API thật. Ảnh tại `.tools/bhome-staff-task-detail.png` và `.tools/bhome-staff-task-actions.png`.
- Kiểm tra tích hợp thật bằng **adapter và transport FE được bundle từ source hiện tại** trên cơ sở BHOME MOBILE TEST: tạo công việc mới “TEST UI — Chi tiết công việc”, start → progress → blockers → upload bytes → GET version mới → submit → GET lại. Version 1→2→3→4→5→6, một ảnh private đọc lại khớp bytes, lịch sử đủ sáu sự kiện gồm tạo việc; trạng thái cuối PendingVerification. Submit thiếu ảnh và cập nhật khi chờ Owner bị BE từ chối 409 như mong đợi.
- Kết quả máy đọc được: `.tools/mobile-test/task-detail-qa-result.json`. Task QA được giữ ở trạng thái chờ Owner để kiểm tra; không nghiệm thu thay Owner, không sửa các task mẫu cũ trong kiểm tra tích hợp này.
- Kiểm tra bổ sung luồng camera native trên emulator 1080×2340: mở modal → chụp → xem lại → chụp lại → dùng ảnh → upload thật → quay về chi tiết có 1 ảnh → mở ảnh từ Backend → Back. Đã thêm một ảnh camera emulator vào task tổng hợp “Kiểm tra phòng M102 (test)”. Không gửi kết quả/nghiệm thu task này. Ảnh `.tools/bhome-task-camera-full.png`, `.tools/bhome-task-photo-preview.png`. Android Back camera/preview, denied permission, background, upload lỗi, giữ ảnh và chống double tap được kiểm tra tự động.
- Thử đổi emulator sang 360×720 dp đã làm activity khởi tạo lại; chưa hoàn tất kiểm tra camera ở kích thước này. Đã khôi phục kích thước/mật độ ban đầu 1080×2340/440. Không khẳng định đã xác minh camera trên mọi kích thước nhỏ.

Giới hạn kiểm chứng: kiểm tra lỗi mạng/409 và chống gửi trùng qua test có transport giả lập; luồng API thật qua service FE, kiểm tra giao diện trên Android. Không khẳng định đã chạy mọi tổ hợp camera/quyền/bàn phím trên mọi thiết bị iOS/Android.
