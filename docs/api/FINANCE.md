# Tài chính Owner trên Compact24

Nguồn: SRS FE-08, UC-31..34, GBR-01/02/15/16/18; yêu cầu triển khai 05/11/2026. Đây là các API mới cho module còn thiếu, không thay contract của routes hiện hữu. Owner có quyền toàn chuỗi theo mô hình single-Owner hiện tại. Staff/Tenant trả 403; anonymous 401. Service kiểm tra role lại bên trong. Số tiền VND được truyền dạng chuỗi số nguyên để giữ chính xác.

## Expenses UC-31

| Method | Route | Input / kết quả |
| --- | --- | --- |
| GET | `/api/v1/expenses` | Query `locationId,from,to,expenseType,category,page,pageSize`; `{items,total,page,pageSize}` |
| GET | `/api/v1/expenses/{id}` | `ExpenseView`, 404 nếu thiếu |
| POST | `/api/v1/expenses` | `ExpenseInput`, header UUID `Idempotency-Key`; trả bản ghi đã lưu |
| PUT | `/api/v1/expenses/{id}` | `{expense: ExpenseInput,expectedVersion,reason}`; trả bản đã cập nhật |

`ExpenseInput`: `{locationId,roomId?,expenseType,category,amount,occurredOn,note}`. `expenseType` là `INITIAL_INVESTMENT` hoặc `OPERATING`, category 1–60 ký tự, amount nguyên VND >0 và <10^18, ngày bắt buộc ISO, note 1–4000 ký tự. Location phải tồn tại; Room nếu có phải thuộc Location. List có page>=1, pageSize 1–100, ngày đầu không vượt ngày cuối; category lọc chính xác.

`ExpenseView` bổ sung `id,version,canEdit`. Tạo trùng cùng actor/key/payload trả cùng ID; đổi payload dùng lại key trả 409. Sau khi tạo, Location/Room/type bất biến; Owner sửa category/amount/date/note kèm reason 1–1000 ký tự và expectedVersion. Mỗi sửa lưu before/after/actor/UTC/reason bằng JSON append-only trong history. Hai sửa cùng version chỉ một thành công. Khoản chi có source do nghiệp vụ khác quản lý không được sửa qua API này. Không có DELETE. Evidence/asset/task/incident/source links đã có trong DB được giữ nguyên khi sửa.

Persistence: repository dùng truy vấn có tham số trên bảng `expenses`, projection trên Locations/Rooms Compact24, transaction, advisory lock cho create và row lock cho update. Không thêm bảng/cột, không migration phá hủy, không đăng ký legacy DbContext.

Ví dụ tổng hợp (thay UUID bằng cơ sở fixture):

```json
{"locationId":"00000000-0000-0000-0000-000000000001","roomId":null,"expenseType":"OPERATING","category":"Vệ sinh","amount":"200000","occurredOn":"2026-11-01","note":"Tham chiếu chứng từ tổng hợp"}
```

Owner Web `/expenses` và mục đầu tư trong Location dùng `ExpensesApiPage` khi `VITE_API_MODE=api`. Load/list/filter/detail/create/update gọi shared client `packages/client-core/src/finance.ts`, JWT/refresh/error từ client hiện hữu. API lỗi được hiển thị; không dùng demo fallback. Có loading/error/empty/success, khóa submit, giữ key khi retry lỗi không rõ kết quả. Khởi tạo danh sách cơ sở qua GET `/api/v1/capture/locations`. Mobile không có màn hình quản lý tài chính Owner mở rộng trong slice này.

Handoff: **INITIAL_API_UI_READY**, Vũ Xuân Trường review UI/UX; chưa phải FRONTEND_READY/E2E_PASSED. Test fixture: `Compact24ExpenseTests` tạo server/database disposable với dữ liệu tổng hợp, tự tạo Owner/Staff/Tenant/Location. Chạy bằng biến `BHOME_COMPACT24_TEST_ADMIN` trỏ loopback admin database `postgres`; không trỏ database làm việc. Browser/native E2E và upload/download chứng từ riêng chưa được triển khai trong slice này. Note chỉ là tham chiếu chứng từ, không phải ảnh chứng minh thanh toán.
