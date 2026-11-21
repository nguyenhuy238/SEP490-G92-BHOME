# BHome.PlanIntegrationTests

Integration test xUnit viết **chỉ theo tài liệu** `BHOME_Report-5.2_Integration_Test.xlsx` (mỗi sheet một thư mục).
Bước, dữ liệu và kết quả mong đợi lấy từ sheet. Route/payload mà sheet không ghi thì lấy từ `docs/api` và
Postman collection trong `docs/testing/postman`. Project **không tham chiếu** project backend nào và không dựa vào code
nghiệp vụ: test gọi API đang chạy qua HTTP (hộp đen) và chỉ đọc PostgreSQL ở những bước sheet ghi "Query … in DB".

Vì vậy test fail nghĩa là API hoặc DB **khác với tài liệu test**. Đó có thể là lỗi của hệ thống, hoặc tài liệu cần cập nhật.
Cần xem từng trường hợp trước khi sửa.

| Thư mục                                | Sheet                             |
| -------------------------------------- | --------------------------------- |
| `Authentication/`                      | Authentication (IT-AUTH-*)        |
| `LocationAssignment/`                  | Location & Assignment (ITC-LOC-*) |
| `SecurityTest/`                        | SecurityTest (TC-SEC-*)           |
| `BF01LocationSetup/` … `BF07Incident/` | BF-01 … BF-07 (ITC-BFxx-*)        |

## Chạy

**Mặc định toàn bộ test gọi HTTP/PostgreSQL sẽ Skip** khi chạy `dotnet test` trong CI hoặc solution. Project này thực hiện cả thao tác thay đổi dữ liệu, vì vậy chỉ bật khi đã khởi động **một API riêng và PostgreSQL fixture tạm** (dữ liệu tổng hợp, có thể xóa sau test). Cổng API thông thường `7240` bị chặn ngay cả khi bật opt-in.

1. Tạo PostgreSQL fixture riêng trên cổng khác `5432`, dùng database tên `bhome_plan_it_<32 ký tự hex>`; cấu hình một API test chạy trên cổng riêng, trỏ đúng vào fixture này. Chỉ dùng địa chỉ loopback (`localhost`, `127.0.0.1`, `::1`); không dùng API/DB đang phục vụ người dùng, staging hoặc production.
2. Cấu hình bằng **biến môi trường trong terminal chạy test**. `plan-tests.settings.json` chỉ chứa giá trị mặc định tham khảo; các giá trị trong file **không** mở khóa được test.

| Biến                                                    | Ý nghĩa                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BHOME_IT_ALLOW_EXTERNAL_API_TESTS`                     | Bắt buộc bằng `true` để bật test có tác động bên ngoài                                                                                                                                                        |
| `BHOME_IT_BASE_URL`                                     | Bắt buộc đặt tường minh, chỉ loopback HTTP(S), cổng riêng (khác `7240`)                                                                                                                                       |
| `BHOME_IT_DB`                                           | Bắt buộc đặt tường minh; PostgreSQL loopback, cổng khác `5432`, database tên `bhome_plan_it_<32 ký tự hex>`                                                                                                   |
| `BHOME_IT_INSECURE_TLS`                                 | `true` để chấp nhận chứng chỉ dev                                                                                                                                                                             |
| `BHOME_IT_ACCOUNT_<TÊN>_EMAIL` / `_PASSWORD` / `_PHONE` | Tài khoản theo tên: `OWNER`, `STAFF`, `TENANT` (mặc định lấy từ sheet) và các tài khoản phụ mà test yêu cầu (`STAFF2`, `TENANT2`, `LOCKOUT`…). Thiếu tài khoản thì test đó **Skip** và ghi rõ cần chuẩn bị gì |

3. Chỉ sau khi có API và DB disposable, bật các biến ở **terminal test** rồi chạy (dùng thông tin fixture tổng hợp của bạn):

```powershell
$env:BHOME_IT_ALLOW_EXTERNAL_API_TESTS = 'true'
$env:BHOME_IT_BASE_URL = 'https://127.0.0.1:7258/'
$env:BHOME_IT_DB = 'Host=127.0.0.1;Port=55439;Database=bhome_plan_it_0123456789abcdef0123456789abcdef;Username=<fixture-user>;Password=<fixture-password>'
dotnet test tests/backend/BHome.PlanIntegrationTests --logger "trx;LogFileName=plan-it.trx"
# Một sheet:      --filter "Sheet=BF-07 Incident"
# Một test case:  --filter "TestCase=IT-AUTH-LOGIN-001"
```

Để kiểm tra gate CI an toàn: không thiết lập biến opt-in và chạy cùng lệnh trên. Các test kiểm tra gate chạy PASS, còn các ca phụ thuộc API/DB Skip mà không kết nối ra ngoài. Test chạy tuần tự, không song song, vì dùng chung phiên đăng nhập, rate limit và lockout.

## Test bị Skip

Test bị **Skip** khi chưa có xác nhận opt-in và cấu hình fixture tạm, hoặc khi bước trong sheet không thể làm từ bên ngoài API: tua đồng hồ server, giả lập lỗi storage hoặc notification,
hoặc kích hoạt job mà tài liệu không có route. Test cũng Skip khi chức năng chưa có API trong `docs/api`, hoặc khi thiếu
tài khoản / dữ liệu cấu hình. Lý do được ghi trong kết quả test. Các case này cần chạy tay theo sheet.

## Quy tắc khi sửa

- Không đọc code `src/` để sửa expected result. Muốn đổi kỳ vọng thì sửa **sheet** trước, rồi sửa test theo sheet.
- Mỗi test case một method, `DisplayName` = mã TC + mô tả. `Trait("TestCase", …)` để lọc khi chạy.
- Không dùng tài khoản chính (`owner`/`staff`/`tenant`) cho test khóa tài khoản, đổi mật khẩu hoặc vô hiệu hóa tài khoản.
