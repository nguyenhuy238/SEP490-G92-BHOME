# Owner Web — Đánh giá & nguyên tắc UX cho Tài chính & Hóa đơn

## Phạm vi

Thiết kế lại cách **Owner hoàn thành công việc**, không thay đổi nghiệp vụ BF-05/06,
UC-20..25, JOB-09/10, API, quy tắc giá, việc phê duyệt hay nguyên tắc xác minh thanh toán.
Các số liệu tài chính và trạng thái nghiệp vụ luôn lấy từ backend.

## Các vấn đề tìm thấy khi đọc giao diện và luồng hiện tại

| Tình huống              | Ma sát trước đây                                                          | Hướng xử lý                                                                                    |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Owner mới vào Tài chính | 9 mục ngang hàng, không có điểm bắt đầu theo nhiệm vụ                     | Trang `/finance` tổ chức theo chu kỳ và các tình huống thường gặp, đường dẫn có nhãn công việc |
| Xem hóa đơn             | Chọn dòng nhưng chi tiết nằm dưới bảng, dễ tưởng nút không hoạt động      | Mở chi tiết sát với thao tác bằng Drawer; giữ danh sách và bộ lọc                              |
| Lịch tự động            | Nhật ký, hàng đợi, cấu hình và nháp cạnh tranh cùng một màn hình          | Ưu tiên bước cần kiểm tra; phần chẩn đoán chỉ hiện khi mở                                      |
| Thu tiền/công nợ        | Nhiều hành động xử lý rủi ro hoặc ngoại lệ xuất hiện cùng lúc             | Phân biệt thao tác chính và ngoại lệ, đưa thông tin xác minh lên trước xác nhận                |
| Điều chỉnh              | Xem chi tiết ở rất xa danh sách                                           | Drawer để xem và xử lý, đóng để trở lại đúng bộ lọc                                            |
| Ghi khoản chi           | Phòng/tài sản/Work Order được hỏi trước số tiền và nội dung               | Trường cốt lõi trước, liên kết bổ sung ở sau                                                   |
| Báo cáo                 | Người dùng phải tự chọn ngày; bảng phân loại và ghi chú tài chính dày đặc | Phím tắt kỳ tháng, dữ liệu chính trước, đối chiếu chuyên sâu qua vùng mở rộng                  |
| What-if                 | Bảy biến số lẫn lộn, sau khi chạy khó tìm thấy kết quả                    | Nhóm doanh thu/chi phí, gợi ý kỳ nền đủ tháng, đưa focus/scroll đến kết quả                    |

## Mô hình thông tin đề xuất

**Chu kỳ thu tiền:** Chỉ số → Hóa đơn nháp/phát hành → Lịch xử lý tự động → Thanh toán/Đối soát.
Đây là hướng dẫn điều hướng, không tự gán trạng thái hoặc cưỡng ép trình tự kỹ thuật.

**Xử lý phát sinh:** Công nợ, Điều chỉnh hóa đơn, Giá & biểu phí.

**Quản trị:** Đầu tư & chi phí, Báo cáo kinh doanh, What-if.

Mọi đường dẫn vẫn mở màn hình nghiệp vụ gốc. Việc phát hành/đối soát/phê duyệt chỉ xảy ra
theo quy trình xác nhận đang có, không kích hoạt từ trang điều hướng.

## Quy tắc áp dụng khi chỉnh bất kỳ màn hình tài chính nào

1. Tiêu đề trả lời **mình đang ở đâu**, mô tả ngắn trả lời **mình làm được việc gì**.
2. Mỗi ngữ cảnh có một hành động chính rõ ràng. Các lựa chọn ít gặp hoặc mang tính kỹ thuật
   nằm ở vùng có thể mở khi cần (progressive disclosure), không che giấu dữ liệu quan trọng.
3. Nhấn vào danh sách phải thấy kết quả ở gần con trỏ hoặc mở Drawer/Dialog, có đường đóng
   dễ thấy, ESC và khả năng quay lại bộ lọc.
4. Không bắt người dùng nhập mã định danh kỹ thuật khi có thể chọn bằng tên/phòng/kỳ.
5. Mọi trạng thái gồm **đang tải**, **chưa có dữ liệu**, **có lỗi**, **cần xử lý**, **đã hoàn tất**
   phải rõ ràng. Không hiển thị số liệu demo như dữ liệu thực.
6. Mẫu nhập: thông tin bắt buộc trước; các liên kết bổ sung sau; dùng ngôn ngữ Owner hiểu.
   Không tự điền số tiền hoặc tự xác minh chuyển khoản.
7. Trước hành động tài chính không thể hoàn tác phải cho xem chính xác mục tiêu, kết quả dự kiến,
   lý do và yêu cầu xác nhận đã có; giữ idempotency/version check đang hoạt động.
8. Khi thay bộ lọc một báo cáo đã tải, cần chỉ rõ số liệu đang hiển thị vẫn thuộc kỳ cũ.
9. Các lối tắt và màn hình Drawer sử dụng được bằng bàn phím, có focus rõ và nút bấm đủ lớn.
10. Ưu tiên màn hình điện thoại: nội dung chính và CTA trước, bảng/chi tiết hiển thị phù hợp
    chiều rộng. Không tạo thao tác chỉ có thể dùng bằng hover.

## Kiểm thử chấp nhận ngoài test tự động

- **Người mới**: vào `/finance`, tìm cách lập hóa đơn, kiểm tra công nợ và xem báo cáo
  mà không cần được giới thiệu cấu trúc menu trước.
- **Xem hóa đơn**: chọn một hóa đơn nháp, xem chi tiết, đóng và xác nhận bộ lọc/dòng
  đang xem được giữ. Lặp lại với hóa đơn Final và liên kết thanh toán/điều chỉnh.
- **Lịch tự động**: tìm nháp thiếu dữ liệu, xem thông báo nguyên nhân và đi tới nơi kiểm tra;
  không bấm phát hành nếu chưa qua kiểm tra bắt buộc.
- **Thu tiền**: nhập/chọn giao dịch và xem nguồn nhận tiền, kết quả đối soát;
  test riêng chuyển khoản không khớp, trả thiếu, trả thừa và lỗi API.
- **Điều chỉnh**: xem một yêu cầu, đóng Drawer/nhấn ESC, quay lại cùng bộ lọc;
  khi quyết định vẫn cần xác nhận con người và phiên bản tài chính mới nhất.
- **Chi phí**: ghi một khoản chi không gắn phòng/tài sản, rồi ghi khoản có liên kết Work Order.
  Các trường bắt buộc xuất hiện trước trường tùy chọn.
- **Báo cáo**: tải tháng trước; đổi bộ lọc nhưng chưa bấm tải lại phải có tín hiệu rõ rằng
  số liệu hiện tại chưa cập nhật.
- **What-if**: chọn nhanh kỳ nền, điền giả định, phân tích và nhận biết kết quả mới; sau đó
  lưu/so sánh. Không có thay đổi vào sổ thực tế.
- Kiểm thử thực tế ở **desktop ~1440px**, **tablet ~768px**, **mobile ~390px**, zoom 200%,
  chỉ dùng bàn phím, lỗi mạng và dữ liệu trống. Unit test không thay thế các phép thử này.

## Tài liệu UX đã tham khảo

- Nielsen Norman Group — **10 Usability Heuristics**:
  https://www.nngroup.com/articles/ten-usability-heuristics/
  (visibility, recognition rather than recall, minimalism, error prevention).
- GOV.UK Design System — **Patterns**:
  https://design-system.service.gov.uk/patterns/
  (task-first entry points, step by step, confirmation, error handling).
- W3C WAI — **WCAG 2.2**:
  https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
  (visible keyboard focus, focus not obscured, accessible target size).
