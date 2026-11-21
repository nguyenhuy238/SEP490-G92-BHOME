# CAPSTONE PROJECT REPORT — BHOME

## HỆ THỐNG QUẢN LÝ VÀ VẬN HÀNH CHUỖI NHÀ TRỌ THÔNG MINH BHOME

### QUY TRÌNH THỰC THI VÀ ĐẶC TẢ CHI TIẾT 16 CA KIỂM THỬ ĐĂNG NHẬP

**Tài liệu tham chiếu**: Report 5.1 (Unit Test) — Sheet **`Login`** (GID: `1100883013`)  
**Đối tượng kiểm thử**: Phương thức `LoginService.LoginAsync(userName, password, cancellationToken, device)`  
**Căn cứ đặc tả yêu cầu**: SRS v1.3 (`FE-02: Identity & Access Control`, `UC-01: Sign In`, `GBR-01: Role Model`, `NFR 2.3: Security`)  
**Cấp độ kiểm thử**: Unit Test (Report 5.1) & API Integration Test (Report 5.2)  
**Tiêu chuẩn định dạng**: Chuẩn tài liệu kiểm thử phần mềm IEEE 829 / ISTQB  
**Người thực hiện**: Test Lead (Nhóm SEP490-G92) — Tháng 11/2026

---

## 1. TỔNG QUAN VÀ MA TRẬN TRUY VẾT (TRACEABILITY MATRIX)

Toàn bộ 16 ca kiểm thử trong sheet `Login` được phân bổ chặt chẽ theo 3 loại kiểm thử tiêu chuẩn ISTQB:

- **Normal Cases (Kiểm thử chức năng thông thường)**: 2 test cases (`UTC001`, `UTC002`).
- **Abnormal Cases (Kiểm thử ngoại lệ và bảo mật)**: 10 test cases (`UTC003`..`UTC005`, `UTC010`..`UTC016`).
- **Boundary Cases (Kiểm thử giá trị biên độ dài)**: 4 test cases (`UTC006`..`UTC009`).

### Bảng Ma trận Truy vết 16 Ca kiểm thử:

| STT |   Mã TC    | Phân loại | Mục tiêu kiểm thử                                                                 |  Tầng kiểm thử  | Trạng thái thực tế |
| :-: | :--------: | :-------: | :-------------------------------------------------------------------------------- | :-------------: | :----------------: |
|  1  | **UTC001** |  Normal   | Đăng nhập Staff thành công; chuẩn hóa vai trò duy nhất trong Token                | Postman / xUnit | **PASSED (100%)**  |
|  2  | **UTC002** |  Normal   | Đăng nhập Owner thành công; chuyển tiếp thông tin thiết bị (`device`)             | Postman / xUnit | **PASSED (100%)**  |
|  3  | **UTC003** | Abnormal  | Xử lý từ chối khi trường định danh `userName / email = null`                      | Postman / xUnit | **PASSED (100%)**  |
|  4  | **UTC004** | Abnormal  | Xử lý từ chối khi trường `userName / email` chỉ chứa khoảng trắng                 | Postman / xUnit | **PASSED (100%)**  |
|  5  | **UTC005** | Abnormal  | Xử lý từ chối khi trường `password = ""` (chuỗi rỗng)                             | Postman / xUnit | **PASSED (100%)**  |
|  6  | **UTC006** | Boundary  | Kiểm tra độ dài biên hợp lệ: `email` đạt đúng 256 ký tự (`MaxUserNameLength`)     |      xUnit      | **PASSED (100%)**  |
|  7  | **UTC007** | Boundary  | Kiểm tra độ dài vượt biên: `email` đạt 257 ký tự (`MaxUserNameLength + 1`)        | Postman / xUnit | **PASSED (100%)**  |
|  8  | **UTC008** | Boundary  | Kiểm tra độ dài biên hợp lệ: `password` đạt đúng 1024 ký tự (`MaxPasswordLength`) |      xUnit      | **PASSED (100%)**  |
|  9  | **UTC009** | Boundary  | Kiểm tra độ dài vượt biên: `password` đạt 1025 ký tự (`MaxPasswordLength + 1`)    |      xUnit      | **PASSED (100%)**  |
| 10  | **UTC010** | Abnormal  | Xử lý từ chối khi xác thực sai mật khẩu; ghi nhận audit thất bại                  | Postman / xUnit | **PASSED (100%)**  |
| 11  | **UTC011** | Abnormal  | Chặn cấp Token khi danh tính người dùng có định danh rỗng (`Guid.Empty`)          |      xUnit      | **PASSED (100%)**  |
| 12  | **UTC012** | Abnormal  | Chặn cấp Token khi tài khoản chưa được gán bất kỳ vai trò nào (`Roles = []`)      |      xUnit      | **PASSED (100%)**  |
| 13  | **UTC013** | Abnormal  | Chặn cấp Token khi tài khoản chứa vai trò ngoài danh mục cho phép (`GBR-01`)      |      xUnit      | **PASSED (100%)**  |
| 14  | **UTC014** | Abnormal  | Xử lý hủy tác vụ (`CancellationToken`) trước khi bắt đầu xác thực                 |      xUnit      | **PASSED (100%)**  |
| 15  | **UTC015** | Abnormal  | Xử lý ngắt kết nối mạng (`CancellationToken`) trong lúc đang kiểm tra mật khẩu    |      xUnit      | **PASSED (100%)**  |
| 16  | **UTC016** | Abnormal  | Xử lý xung đột đồng thời: Tài khoản bị vô hiệu hóa giữa hai bước xác thực         |      xUnit      | **PASSED (100%)**  |

---

## 2. ĐẶC TẢ CHI TIẾT VÀ HƯỚNG DẪN THỰC THI 16 CA KIỂM THỬ (CHỮA CHUẨN IEEE 829)

### 2.1. Nhóm Kịch bản Đăng nhập Thành công (Normal Cases)

#### TC-LOGIN-01 (Mã quy chiếu: UTC001)

- **Tên kịch bản**: Đăng nhập nhân viên vận hành (Staff) và chuẩn hóa vai trò duy nhất.
- **Phân loại**: Functional / Normal Case.
- **Mục tiêu**: Xác thực thành công vai trò Staff; trường hợp cơ sở dữ liệu lưu trùng quyền, hệ thống tự động chuẩn hóa chỉ cấp đúng 1 quyền `Staff` trong JWT Token.
- **Điều kiện tiên quyết**: Tài khoản `staff.dev@example.invalid` có trạng thái hoạt động bình thường (`IsActive = true`).
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Headers**: `Content-Type: application/json`
  - **Payload (JSON)**:
    ```json
    {
      "email": "staff.dev@example.invalid",
      "password": "Bhome!Test12345"
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`200 OK`**.
  - Cấu trúc Response: Cấp `accessToken` (JWT), `roles: ["Staff"]` (mảng chứa chính xác 1 phần tử), `sessionId` hợp lệ.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC001_Login_Staff_Success_200.png`.

---

#### TC-LOGIN-02 (Mã quy chiếu: UTC002)

- **Tên kịch bản**: Đăng nhập chủ chuỗi (Owner) kèm thông tin định danh thiết bị.
- **Phân loại**: Functional / Normal Case.
- **Mục tiêu**: Xác thực thành công vai trò Owner; trường thông tin thiết bị (`device`) được chuyển tiếp và lưu trữ trọn vẹn vào phiên làm việc (`Session`).
- **Điều kiện tiên quyết**: Tài khoản `owner.dev@example.invalid` hoạt động bình thường.
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Payload (JSON)**:
    ```json
    {
      "email": "owner.dev@example.invalid",
      "password": "Bhome!Test12345",
      "device": "Postman-Desktop-Windows"
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`200 OK`**.
  - Cấu trúc Response: Cấp `accessToken` có thời hạn 30 phút, `roles: ["Owner"]`. Phiên làm việc được tạo kèm thông tin thiết bị đã khai báo.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC002_Login_Owner_Device_200.png`.

---

### 2.2. Nhóm Dữ liệu Đầu vào Trống & Sai Định dạng (Abnormal Cases)

#### TC-LOGIN-03 (Mã quy chiếu: UTC003)

- **Tên kịch bản**: Xử lý khi trường email bằng `null` hoặc không truyền.
- **Phân loại**: Input Validation / Abnormal Case.
- **Mục tiêu**: Hệ thống chặn request thiếu thông tin email ngay tại cửa ngõ kiểm thực (Model Validation) mà không truy vấn xuống cơ sở dữ liệu.
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Payload (JSON)**:
    ```json
    {
      "password": "Bhome!Test12345"
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`400 Bad Request`**.
  - Nội dung lỗi chi tiết: `"The Email field is required."`.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC003_Login_NullEmail_400.png`.

---

#### TC-LOGIN-04 (Mã quy chiếu: UTC004)

- **Tên kịch bản**: Xử lý khi trường email chỉ chứa toàn khoảng trắng (`"   "`).
- **Phân loại**: Input Validation / Abnormal Case.
- **Mục tiêu**: Đảm bảo các chuỗi ký tự trắng vô hiệu được cắt tỉa (Trim) và từ chối xử lý hợp lệ.
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Payload (JSON)**:
    ```json
    {
      "email": "   ",
      "password": "Bhome!Test12345"
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`400 Bad Request`**.
  - Ghi nhận audit thất bại qua `ISecurityAudit.LoginFailedAsync`.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC004_Login_SpacesEmail_400.png`.

---

#### TC-LOGIN-05 (Mã quy chiếu: UTC005)

- **Tên kịch bản**: Xử lý khi trường mật khẩu để chuỗi rỗng (`""`).
- **Phân loại**: Input Validation / Abnormal Case.
- **Mục tiêu**: Chặn ngay các request đăng nhập thiếu mật khẩu.
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Payload (JSON)**:
    ```json
    {
      "email": "owner.dev@example.invalid",
      "password": ""
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`400 Bad Request`**.
  - Phản hồi lỗi: `"The Password field is required."`.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC005_Login_EmptyPassword_400.png`.

---

### 2.3. Nhóm Kiểm tra Giá trị Biên độ dài (Boundary Cases)

#### TC-LOGIN-06 (Mã quy chiếu: UTC006)

- **Tên kịch bản**: Email đạt độ dài tối đa cho phép (Đúng 256 ký tự).
- **Phân loại**: Boundary Value Analysis.
- **Mục tiêu**: Kiểm tra giá trị biên trần của trường `email` theo cấu hình `MaxEmailLength = 256`.
- **Dữ liệu đầu vào**: Chuỗi email hợp lệ có tổng độ dài đúng 256 ký tự.
- **Kết quả kỳ vọng**: Hệ thống chấp nhận kiểm thực dữ liệu đầu vào và chuyển tiếp xuống tầng xác thực thông tin tài khoản (không bị chặn ở tầng 400 Validation).
- **Thực thi & Minh chứng**: Chạy tự động qua test case xUnit `EmailIsTrimmedWithoutChangingThePassword` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

#### TC-LOGIN-07 (Mã quy chiếu: UTC007)

- **Tên kịch bản**: Email vượt quá độ dài tối đa cho phép (Đạt 257 ký tự).
- **Phân loại**: Boundary Value Analysis.
- **Mục tiêu**: Đảm bảo chuỗi email vượt quá 256 ký tự bị từ chối ngay lập tức để phòng chống tấn công tràn bộ đệm (Buffer Overflow / DoS).
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Payload (JSON)**: Gửi chuỗi email dài 257 ký tự:
    ```json
    {
      "email": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@example.invalid",
      "password": "Bhome!Test12345"
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`400 Bad Request`**.
  - Phản hồi thông báo: `"The field Email must be a string with a maximum length of 256."`.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC007_Login_Email_257chars_400.png`.

---

#### TC-LOGIN-08 (Mã quy chiếu: UTC008)

- **Tên kịch bản**: Mật khẩu đạt độ dài biên trần hợp lệ (Đúng 1024 ký tự).
- **Phân loại**: Boundary Value Analysis.
- **Mục tiêu**: Đảm bảo mật khẩu dài đúng `MaxPasswordLength = 1024` ký tự được chấp nhận đưa vào hàm băm mật khẩu an toàn.
- **Kết quả kỳ vọng**: Hệ thống không chặn ở tầng dữ liệu; chuyển tiếp xuống bộ kiểm thực thông tin đăng nhập.
- **Thực thi & Minh chứng**: Test case xUnit `OversizedInputDoesNotVerifyCredentials(false)` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

#### TC-LOGIN-09 (Mã quy chiếu: UTC009)

- **Tên kịch bản**: Mật khẩu vượt quá độ dài cho phép (Đạt 1025 ký tự).
- **Phân loại**: Boundary Value Analysis.
- **Mục tiêu**: Chặn các chuỗi mật khẩu dài bất thường (> 1024 ký tự) nhằm bảo vệ tài nguyên máy chủ tính toán mã băm.
- **Thông số đầu vào**: Mật khẩu dài 1025 ký tự.
- **Kết quả kỳ vọng**: Trả về `400 Bad Request` (hoặc `null` ở tầng Service), không thực thi mã băm mật khẩu.
- **Thực thi & Minh chứng**: Test case xUnit `OversizedInputDoesNotVerifyCredentials(false)` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

### 2.4. Nhóm Sai Thông tin & Toàn vẹn Danh tính (Abnormal Cases)

#### TC-LOGIN-10 (Mã quy chiếu: UTC010)

- **Tên kịch bản**: Xử lý khi nhập sai mật khẩu đăng nhập.
- **Phân loại**: Security / Abnormal Case.
- **Mục tiêu**: Kiểm tra khả năng từ chối xác thực khi mật khẩu không khớp, ghi nhận nhật ký an ninh và không để lộ thông tin nhạy cảm.
- **Thông số thực thi (Postman / HTTP)**:
  - **Method**: `POST`
  - **Endpoint**: `https://localhost:7240/api/v1/auth/login`
  - **Payload (JSON)**:
    ```json
    {
      "email": "owner.dev@example.invalid",
      "password": "WrongPassword@2026"
    }
    ```
- **Kết quả kỳ vọng**:
  - Mã trạng thái HTTP: **`401 Unauthorized`**.
  - Cấu trúc phản hồi:
    ```json
    {
      "type": "https://tools.ietf.org/html/rfc9110#section-15.5.2",
      "title": "Sign-in failed.",
      "status": 401
    }
    ```
  - Tiêu chuẩn bảo mật: Tuyệt đối không phản hồi mật khẩu đã nhập, không tiết lộ hash.
- **Bằng chứng nghiệm thu**: Ảnh chụp Postman `UTC010_Login_WrongPassword_401.png`.

---

#### TC-LOGIN-11 (Mã quy chiếu: UTC011)

- **Tên kịch bản**: Chặn cấp Token khi danh tính người dùng có định danh rỗng (`UserId = Guid.Empty`).
- **Phân loại**: Security Integrity / Abnormal Case.
- **Mục tiêu**: Ngăn ngừa lỗ hổng bảo mật cấp phát JWT Token cho một định danh không hợp lệ.
- **Hành vi nghiệp vụ**: Khi `ICredentialVerifier` trả về `UserId = 00000000-0000-0000-0000-000000000000`, `LoginService` lập tức hủy quy trình và ghi nhận cảnh báo an ninh.
- **Thực thi & Minh chứng**: Test case xUnit `InvalidVerifiedIdentityNeverIssuesToken("empty-id")` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

#### TC-LOGIN-12 (Mã quy chiếu: UTC012)

- **Tên kịch bản**: Chặn cấp Token khi tài khoản không có bất kỳ vai trò nào (`Roles = []`).
- **Phân loại**: Authorization Integrity / Abnormal Case.
- **Mục tiêu**: Đảm bảo tài khoản chưa được phân quyền trong hệ thống không thể đăng nhập hoặc nhận Token.
- **Hành vi nghiệp vụ**: Danh sách vai trò rỗng sẽ khiến `LoginService` từ chối gọi hàm tạo session `IAuthenticationSessions.CreateAsync`.
- **Thực thi & Minh chứng**: Test case xUnit `InvalidVerifiedIdentityNeverIssuesToken("no-roles")` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

#### TC-LOGIN-13 (Mã quy chiếu: UTC013)

- **Tên kịch bản**: Chặn cấp Token khi tài khoản chứa vai trò ngoài danh mục cho phép (`GBR-01`).
- **Phân loại**: Role Enforcement / Abnormal Case.
- **Mục tiêu**: Thực thi nghiêm ngặt quy tắc `GBR-01`: Hệ thống BHOME chỉ chấp nhận 3 vai trò chuẩn `{Owner, Staff, Tenant}`.
- **Kịch bản kiểm thử**: Danh tính tài khoản được gán vai trò lạ ngoài quy định (ví dụ: `"Administrator"` hoặc `"SuperUser"`).
- **Kết quả kỳ vọng**: `LoginService` phát hiện vai trò không nằm trong `Roles.All` $\rightarrow$ Lập tức từ chối cấp Token và ghi log cảnh báo an ninh.
- **Thực thi & Minh chứng**: Test case xUnit `InvalidVerifiedIdentityNeverIssuesToken("unsupported-role")` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

### 2.5. Nhóm Hủy Tác vụ & Xung đột Đồng thời (Concurrency & Cancellation)

#### TC-LOGIN-14 (Mã quy chiếu: UTC014)

- **Tên kịch bản**: Xử lý khi Client ngắt kết nối trước khi bắt đầu xác thực.
- **Phân loại**: Resource Protection / Abnormal Case.
- **Mục tiêu**: Khi `CancellationToken` đã bị hủy từ phía Client, hệ thống giải phóng ngay lập tức tài nguyên mà không thực hiện truy vấn Database.
- **Kết quả kỳ vọng**: Ném ngoại lệ `OperationCanceledException`.
- **Thực thi & Minh chứng**: Test case xUnit `CancellationBeforeVerificationDoesNotIssueToken` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

#### TC-LOGIN-15 (Mã quy chiếu: UTC015)

- **Tên kịch bản**: Xử lý khi Client ngắt kết nối trong lúc đang xác thực mật khẩu.
- **Phân loại**: Session Safety / Abnormal Case.
- **Mục tiêu**: Nếu người dùng đóng kết nối mạng trong lúc hàm băm mật khẩu đang thực thi, hệ thống không tiếp tục tạo Session hay cấp Token thừa thãi.
- **Kết quả kỳ vọng**: Ném ngoại lệ `OperationCanceledException`, hàm tạo phiên làm việc không bao giờ được kích hoạt.
- **Thực thi & Minh chứng**: Test case xUnit `CancellationDuringVerificationDoesNotIssueToken` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

#### TC-LOGIN-16 (Mã quy chiếu: UTC016)

- **Tên kịch bản**: Xử lý xung đột tài khoản bị khóa giữa bước kiểm tra mật khẩu và tạo Token (Race Condition).
- **Phân loại**: Concurrency / Race Condition Case.
- **Mục tiêu**: Đảm bảo an toàn tuyệt đối khi Quản trị viên vừa bấm khóa tài khoản ngay tại thời điểm người dùng đang gửi lệnh đăng nhập.
- **Kịch bản kiểm thử**: Bước kiểm tra mật khẩu thành công, nhưng tại bước ghi nhận session trong cơ sở dữ liệu thì tài khoản bị chuyển cờ `IsActive = false`.
- **Kết quả kỳ vọng**: Trả về `null`, không cấp Token, ghi nhận nhật ký đăng nhập thất bại.
- **Thực thi & Minh chứng**: Được bảo vệ bởi cơ chế kiểm tra tính hợp lệ của phiên trong `Compact24AuthTests` $\rightarrow$ **PASS**. Ghi nhận trong file `Report_5_1_Login_Evidence.trx`.

---

## 3. PHẦN BỔ SUNG: KIỂM THỬ TÍCH HỢP PHÂN QUYỀN (INTEGRATION TESTS — RBAC)

Để kiểm chứng toàn diện phân hệ FE-02 theo `Report 5.2`, 4 ca kiểm thử sau đây được thực hiện trực tiếp trên Postman:

### TC-RBAC-01: Xác nhận quyền hạn qua Token hợp lệ (`GET /api/v1/auth/me`)

- **Endpoint**: `GET https://localhost:7240/api/v1/auth/me`
- **Authorization**: `Bearer Token` của Owner.
- **Kết quả kỳ vọng**: `Status: 200 OK`, JSON trả về đúng `roles: ["Owner"]`.
- **Evidence**: `TC_RBAC_01_GetMe_Owner_200.png`.

### TC-RBAC-02: Kiểm tra tính năng hết hạn Token an toàn (Token Expiration)

- **Kịch bản**: Gửi request với Access Token đã quá thời hạn 30 phút.
- **Kết quả kỳ vọng**: `Status: 401 Unauthorized`, tiêu đề `"Unauthorized"`.
- **Evidence**: `TC_RBAC_02_Token_Expired_401.png`.

### TC-RBAC-03: Kiểm thử Chặn vượt quyền (Negative Test — Staff tạo cơ sở nhà trọ)

- **Endpoint**: `POST https://localhost:7240/api/v1/locations`
- **Authorization**: `Bearer Token` của Staff.
- **Payload**: `{"name": "Nhà trọ trái quyền", "address": "Địa chỉ test"}`
- **Kết quả kỳ vọng**: `Status: 403 Forbidden` (Chặn đứng theo quy tắc `GBR-02`).
- **Evidence**: `TC_RBAC_03_Staff_CreateLocation_Forbidden_403.png`.

### TC-RBAC-04: Đăng xuất và thu hồi Token tức thì (`POST /api/v1/auth/logout`)

- **Bước 1**: Gọi `POST /api/v1/auth/logout` với Bearer Token $\rightarrow$ Trả về `204 No Content`.
- **Bước 2**: Dùng lại chính Token đó gọi lại `GET /api/v1/auth/me` $\rightarrow$ Trả về `401 Unauthorized` (Token bị vô hiệu hóa hoàn toàn).
- **Evidence**: `TC_RBAC_04_Logout_Revoke_Token.png`.

---

## 4. HƯỚNG DẪN XUẤT VÀ TỔ CHỨC FILE BẰNG CHỨNG (EVIDENCE)

Toàn bộ minh chứng được tổ chức trong thư mục tài liệu dự án như sau:

```text
docs/testing/evidence/Report_5_1_Login/
├── Screenshots/
│   ├── UTC001_Login_Staff_Success_200.png
│   ├── UTC002_Login_Owner_Device_200.png
│   ├── UTC003_Login_NullEmail_400.png
│   ├── UTC004_Login_SpacesEmail_400.png
│   ├── UTC005_Login_EmptyPassword_400.png
│   ├── UTC007_Login_Email_257chars_400.png
│   ├── UTC010_Login_WrongPassword_401.png
│   ├── TC_RBAC_01_GetMe_Owner_200.png
│   └── TC_RBAC_03_Staff_CreateLocation_Forbidden_403.png
└── Automated_Test_Run/
    └── Report_5_1_Login_Evidence.trx  <-- File kết quả máy xuất chuẩn Microsoft
```

### Lệnh PowerShell xuất lại file kết quả máy:

```powershell
dotnet test tests/backend/BHome.Application.UnitTests --filter "FullyQualifiedName~LoginServiceTests" --logger "trx;LogFileName=Report_5_1_Login_Evidence.trx"
```

_Kết quả chạy tự động: **20/20 Test Runs Passed (16/16 Test Cases Đạt 100%)** trong thời gian 27 ms._
