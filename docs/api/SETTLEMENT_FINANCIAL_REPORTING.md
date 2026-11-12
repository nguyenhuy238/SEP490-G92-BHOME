# Báo cáo khoản phải thu trả phòng và cọc

Nguồn: BR-15/17/18/19/20/21/22; FE-08, UC-33..35, GBR-10/15/16/18. Dùng API `GET /api/v1/financial-reports` Owner-only hiện có, giữ bộ lọc Location/Room và một transaction RepeatableRead. Không thêm bảng, migration hay endpoint.

`total.issued` gồm hóa đơn Final và khoản phải thu trả phòng đã được Owner duyệt. Dòng hóa đơn đã loại phần ghi nhận trong settlement nên không cộng lại consumption/rent. `outstandingNow` gồm dư nợ hiện tại của các nguồn thuộc kỳ chọn; quyền/lịch sử không phụ thuộc Resident.RoomId hiện tại. `verifiedCollections` chỉ cộng phần ngân hàng verified đã phân bổ, không gồm tiền dư, chưa khớp, simulator, cấn trừ cọc hay hoàn tiền gốc.

Root report và mỗi Location thêm `settlementSources` (tùy chọn khi đọc snapshot cũ):

| Field                   | Nội dung                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| approvedCharges         | Giá trị khoản phải thu trả phòng đã duyệt trong kỳ                                                              |
| outstandingNow          | Dư nợ hiện tại của các khoản đó                                                                                 |
| verifiedBankCollections | Phần receipt ngân hàng verified được phân bổ vào khoản phải thu trong kỳ                                        |
| depositOffsetsApplied   | Cấn trừ cọc được duyệt vào Invoice hoặc receivable trong kỳ, không gồm Holding → Main                           |
| holdingForfeitures      | Cọc Holding không hoàn theo quyết định Tenant tự hủy, kiểm tra ledger nguồn và không có hoàn/phân bổ trái ngược |

Tất cả là decimal string; breakdown không được cộng thêm lần nữa vào các total đã tổng hợp. Không tự đổi công thức lợi nhuận/cashflow hiện có. Holding forfeiture hiển thị riêng; chưa đưa vào các công thức đó. Hoàn cọc giữ trong `verifiedDepositReturns`, không phải OPEX hoặc khoản trừ doanh thu.

Điện/nước và phí cố định dùng `billingPeriod` trong snapshot. Thiệt hại dùng ngày Owner duyệt theo Asia/Ho_Chi_Minh; thu tiền và cấn trừ theo `allocatedAt`, forfeiture theo thời điểm quyết định hủy. Đây là quy ước báo cáo quản trị nội bộ, không phải quy tắc kê khai thuế/kế toán pháp định. Dư nợ và occupancy hiện tại phản ánh snapshot khi tải, không giả là số dư tại ngày cuối kỳ.

Nguồn sai loại, thiếu kỳ, sai Room/Contract hoặc balance ngoài phạm vi hợp lệ trả 409 `settlement_report_sources_require_review`; không bỏ nguồn đó để trả một báo cáo tưởng đã đầy đủ. Owner Web có breakdown, thông báo lỗi, bộ lọc và CSV giữ nguyên decimal string/ô chưa có dữ liệu. What-if đọc baseline; không ghi vào nguồn thực tế.

Kiểm thử dùng PostgreSQL disposable và dữ liệu synthetic: thiệt hại 600.000/cọc 400.000 còn nợ 200.000 sau release; hai receipt phân bổ 50.000 + 150.000, khoản dư 50.000 được hoàn nhưng không tăng revenue; lọc ngày trước approval; unknown source buộc review; Holding forfeiture và principal refund tách riêng. UI component/export là bằng chứng riêng, chưa phải UI E2E/provider thật.
