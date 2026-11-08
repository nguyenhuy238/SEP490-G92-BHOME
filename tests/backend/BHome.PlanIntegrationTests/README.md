# BHome.PlanIntegrationTests

Integration test xUnit viết **chỉ theo tài liệu** `BHOME_Report-5.2_Integration_Test.xlsx` (mỗi sheet một thư mục).
Bước, dữ liệu và kết quả mong đợi lấy từ sheet. Route/payload mà sheet không ghi thì lấy từ `docs/api` và
Postman collection trong `docs/testing/postman`. Project **không tham chiếu** project backend nào và không dựa vào code
nghiệp vụ: test gọi API đang chạy qua HTTP (hộp đen) và chỉ đọc PostgreSQL ở những bước sheet ghi "Query … in DB".

Vì vậy test fail nghĩa là API hoặc DB **khác với tài liệu test**. Đó có thể là lỗi của hệ thống, hoặc tài liệu cần cập nhật.
Cần xem từng trường hợp trước khi sửa.

| Thư mục | Sheet |
| --- | --- |
| `Authentication/` | Authentication (IT-AUTH-*) |
| `LocationAssignment/` | Location & Assignment (ITC-LOC-*) |
| `SecurityTest/` | SecurityTest (TC-SEC-*) |
| `BF01LocationSetup/` … `BF07Incident/` | BF-01 … BF-07 (ITC-BFxx-*) |

## Chạy

1. Chạy API (mặc định `https://localhost:7240`, theo sheet *Test Cases*) với database có sẵn tài khoản test.
2. Cấu hình bằng `plan-tests.settings.json` hoặc biến môi trường. Biến môi trường được ưu tiên hơn file:

| Biến | Ý nghĩa |
| --- | --- |
| `BHOME_IT_BASE_URL` | Địa chỉ API |
| `BHOME_IT_DB` | Connection string PostgreSQL của API. Không đặt thì các test cần kiểm tra DB sẽ **Skip** |
| `BHOME_IT_INSECURE_TLS` | `true` để chấp nhận chứng chỉ dev |
| `BHOME_IT_ACCOUNT_<TÊN>_EMAIL` / `_PASSWORD` / `_PHONE` | Tài khoản theo tên: `OWNER`, `STAFF`, `TENANT` (mặc định lấy từ sheet) và các tài khoản phụ mà test yêu cầu (`STAFF2`, `TENANT2`, `LOCKOUT`…). Thiếu tài khoản thì test đó **Skip** và ghi rõ cần chuẩn bị gì |

3. Chạy:

```powershell
dotnet test tests/backend/BHome.PlanIntegrationTests --logger "trx;LogFileName=plan-it.trx"
# Một sheet:      --filter "Sheet=BF-07 Incident"
# Một test case:  --filter "TestCase=IT-AUTH-LOGIN-001"
```

Test chạy tuần tự, không song song, vì dùng chung phiên đăng nhập, rate limit và lockout.

## Test bị Skip

Test bị **Skip** khi bước trong sheet không thể làm từ bên ngoài API: tua đồng hồ server, giả lập lỗi storage hoặc notification,
hoặc kích hoạt job mà tài liệu không có route. Test cũng Skip khi chức năng chưa có API trong `docs/api`, hoặc khi thiếu
tài khoản / dữ liệu cấu hình. Lý do được ghi trong kết quả test. Các case này cần chạy tay theo sheet.

## Quy tắc khi sửa

- Không đọc code `src/` để sửa expected result. Muốn đổi kỳ vọng thì sửa **sheet** trước, rồi sửa test theo sheet.
- Mỗi test case một method, `DisplayName` = mã TC + mô tả. `Trait("TestCase", …)` để lọc khi chạy.
- Không dùng tài khoản chính (`owner`/`staff`/`tenant`) cho test khóa tài khoản, đổi mật khẩu hoặc vô hiệu hóa tài khoản.
