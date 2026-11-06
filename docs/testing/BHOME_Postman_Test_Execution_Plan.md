# KẾ HOẠCH & HƯỚNG DẪN KIỂM THỬ POSTMAN CHI TIẾT

## HỆ THỐNG QUẢN LÝ VÀ VẬN HÀNH CHUỖI NHÀ TRỌ THÔNG MINH BHOME

### SPRINT 2: XÁC THỰC, PHÂN QUYỀN (RBAC) & CẤP TÀI KHOẢN NHÂN VIÊN

**Căn cứ đặc tả**: SRS v1.3 (`FE-02: Identity & Access Control`, `UC-01: Sign In`, `UC-08: Staff Management`, `GBR-01: 3 Roles`, `GBR-02: Isolation`, `NFR 2.3: Security`)  
**Tài liệu đối chiếu**: Report 5.1 (Unit Test) — Sheet `Login`, `ResourceAccess`, `StaffRegistration`  
**Base URL**: `https://localhost:7240` (hoặc `http://localhost:5240`)  
**Tài khoản Test cố định (Mật khẩu: `Bhome!Test12345`)**:

- **Owner**: `owner.dev@example.invalid`
- **Staff**: `staff.dev@example.invalid`
- **Tenant**: `tenant.dev@example.invalid`

---

## ⚡ CÁCH 1: NHẬP COLLECTION TỰ ĐỘNG VÀO POSTMAN (1 CLICK)

1. Mở Postman $\rightarrow$ Chọn nút **Import** (ở góc trên bên trái).
2. Kéo thả file: [**`d:\BHOME\Bhome\test-plan\BHOME_Postman_Collection.json`**](file:///d:/BHOME/Bhome/test-plan/BHOME_Postman_Collection.json).
3. Postman sẽ tạo thư mục **`BHOME API Test Suite - Sprint 2`** với đầy đủ các Request, Headers, JSON Body và Script tự động lưu Token.
4. **Cài đặt SSL trong Postman**: Vào `Settings` (icon bánh răng) $\rightarrow$ Tab `General` $\rightarrow$ Tắt **SSL certificate verification** (chuyển sang `OFF` để gọi được `https://localhost:7240`).

---

## 🛠️ CÁCH 2: HƯỚNG DẪN THỰC THI POSTMAN THỦ CÔNG TỪNG BƯỚC

### PHẦN 1: BỘ KỊCH BẢN ĐĂNG NHẬP (POST /api/v1/auth/login)

#### Kịch bản 1.1: Đăng nhập Staff thành công (UTC001 - Normal)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Headers**: `Content-Type: application/json`
- **Body (raw JSON)**:
  ```json
  {
    "email": "staff.dev@example.invalid",
    "password": "Bhome!Test12345",
    "device": "Postman Desktop"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `200 OK`
  - **Response**: Có `accessToken` (chuỗi JWT), `roles: ["Staff"]`, `sessionId`, `refreshToken`.
- **Thao tác**: Copy chuỗi `accessToken` này để dùng cho các bước test của Staff.
- 📸 **Tên file Evidence**: `UTC001_Login_Staff_Success_200.png`

---

#### Kịch bản 1.2: Đăng nhập Owner thành công (UTC002 - Normal)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Headers**: `Content-Type: application/json`
- **Body (raw JSON)**:
  ```json
  {
    "email": "owner.dev@example.invalid",
    "password": "Bhome!Test12345",
    "device": "Pixel 7 - Chrome"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `200 OK`
  - **Response**: Có `accessToken`, `roles: ["Owner"]`, `sessionId`.
- **Thao tác**: Copy chuỗi `accessToken` này làm **`<Token_Owner>`** để test quyền hạn cấp cao.
- 📸 **Tên file Evidence**: `UTC002_Login_Owner_Success_200.png`

---

#### Kịch bản 1.3: Nhập sai mật khẩu (UTC010 - Security / Abnormal)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Body (raw JSON)**:
  ```json
  {
    "email": "owner.dev@example.invalid",
    "password": "WrongPassword@2026"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `401 Unauthorized`
  - **Response**:
    ```json
    {
      "type": "https://tools.ietf.org/html/rfc9110#section-15.5.2",
      "title": "Sign-in failed.",
      "status": 401
    }
    ```
  - _Hệ thống bảo mật tuyệt đối, không tiết lộ mật khẩu hay sự tồn tại của tài khoản._
- 📸 **Tên file Evidence**: `UTC010_Login_WrongPassword_401.png`

---

#### Kịch bản 1.4: Email để null hoặc rỗng (UTC003 - Validation)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Body (raw JSON)**:
  ```json
  {
    "email": null,
    "password": "Bhome!Test12345"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `400 Bad Request`
  - **Response Message**: Chứa thông báo `"The Email field is required."`
- 📸 **Tên file Evidence**: `UTC003_Login_NullEmail_400.png`

---

#### Kịch bản 1.5: Email sai định dạng (UTC004 - Validation)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Body (raw JSON)**:
  ```json
  {
    "email": "khong-phai-email",
    "password": "Bhome!Test12345"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `400 Bad Request`
  - **Response Message**: `"The Email field is not a valid e-mail address."`
- 📸 **Tên file Evidence**: `UTC004_Login_InvalidEmailFormat_400.png`

---

#### Kịch bản 1.6: Mật khẩu để chuỗi rỗng (UTC005 - Validation)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Body (raw JSON)**:
  ```json
  {
    "email": "owner.dev@example.invalid",
    "password": ""
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `400 Bad Request`
  - **Response Message**: `"The Password field is required."`
- 📸 **Tên file Evidence**: `UTC005_Login_EmptyPassword_400.png`

---

#### Kịch bản 1.7: Email vượt quá 256 ký tự (UTC007 - Boundary)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/login`
- **Body (raw JSON)**: Chuỗi email 257 ký tự (`"a".repeat(240) + "@bhome.invalid"`).
- **Kỳ vọng (Expected)**:
  - **Status**: `400 Bad Request`
  - **Response Message**: `"The field Email must be a string with a maximum length of 256."`
- 📸 **Tên file Evidence**: `UTC007_Login_EmailExceed256_400.png`

---

### PHẦN 2: BỘ KỊCH BẢN KIỂM TRA DANH TÍNH (GET /api/v1/auth/me)

#### Kịch bản 2.1: Xác thực danh tính Owner qua Token

1. Chọn Method: `GET`, URL: `https://localhost:7240/api/v1/auth/me`
2. Tab **Authorization**: Chọn **Bearer Token** $\rightarrow$ Dán `<Token_Owner>`.
3. Bấm **Send**:
   - **Status**: `200 OK`
   - **Response Body**:
     ```json
     {
       "userId": "a3425ba6-84f3-48aa-a8be-127119101d11",
       "sessionId": "...",
       "roles": ["Owner"]
     }
     ```

- 📸 **Tên file Evidence**: `ME01_GetMe_Owner_200.png`

---

#### Kịch bản 2.2: Xác thực danh tính Staff qua Token

1. Chọn Method: `GET`, URL: `https://localhost:7240/api/v1/auth/me`
2. Tab **Authorization**: Chọn **Bearer Token** $\rightarrow$ Dán `<Token_Staff>`.
3. Bấm **Send**:
   - **Status**: `200 OK`
   - **Response Body**:
     ```json
     {
       "userId": "b4725ba6-84f3-48aa-a8be-127119101d22",
       "sessionId": "...",
       "roles": ["Staff"]
     }
     ```

- 📸 **Tên file Evidence**: `ME02_GetMe_Staff_200.png`

---

#### Kịch bản 2.3: Chặn khi không gửi Token hoặc Token không hợp lệ

1. Method: `GET`, URL: `https://localhost:7240/api/v1/auth/me`
2. Tab **Authorization**: Chọn `No Auth` (hoặc dán token giả mạo).
3. Bấm **Send**:
   - **Kỳ vọng**: `Status: 401 Unauthorized`

- 📸 **Tên file Evidence**: `ME03_GetMe_NoToken_401.png`

---

### PHẦN 3: CẤP TÀI KHOẢN NHÂN VIÊN & PHÂN QUYỀN RBAC (POST /api/v1/capture/staff)

#### Kịch bản 3.1: Owner cấp tài khoản Staff mới thành công (TC-REG-01 - Normal)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Authorization**: `Bearer <Token_Owner>`
- **Body (raw JSON)**:
  ```json
  {
    "userName": "staff_hn_08",
    "email": "staff_hn_08@example.invalid",
    "password": "Bhome!Test12345"
  }
  ```
  _(Lưu ý: Thay đổi số `08` sang số mới nếu đã tồn tại trong CSDL)_
- **Kỳ vọng (Expected)**:
  - **Status**: `200 OK`
  - **Response Body**:
    ```json
    {
      "id": "e58b1920-5f21-4ea9-a864-7cf6eb942f9b"
    }
    ```
- 📸 **Tên file Evidence**: `TC_REG_01_Owner_CreateStaff_Success_200.png`

---

#### Kịch bản 3.2: Chặn Staff tự tạo tài khoản Staff khác (TC-REG-02 - RBAC Security)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Authorization**: `Bearer <Token_Staff>` _(Dùng Token của Staff)_
- **Body (raw JSON)**: Giống Kịch bản 3.1.
- **Kỳ vọng (Expected)**:
  - **Status**: `403 Forbidden`
  - _Hệ thống từ chối do nhân viên không có quyền cấp tài khoản (Vi phạm phân quyền RBAC)._
- 📸 **Tên file Evidence**: `TC_REG_02_Staff_CreateStaff_Forbidden_403.png`

---

#### Kịch bản 3.3: Chặn tạo tài khoản khi chưa đăng nhập (TC-REG-03)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Authorization**: `No Auth`
- **Body (raw JSON)**: Giống Kịch bản 3.1.
- **Kỳ vọng (Expected)**:
  - **Status**: `401 Unauthorized`
- 📸 **Tên file Evidence**: `TC_REG_03_CreateStaff_Unauthenticated_401.png`

---

#### Kịch bản 3.4: Trùng Username hoặc Email đã tồn tại (TC-REG-04)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Authorization**: `Bearer <Token_Owner>`
- **Body (raw JSON)**:
  ```json
  {
    "userName": "staff.dev",
    "email": "staff.dev@example.invalid",
    "password": "Bhome!Test12345"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `400 Bad Request`
  - **Response Body**:
    ```json
    {
      "type": "https://httpstatuses.com/400",
      "title": "Invalid HTTP request.",
      "status": 400,
      "code": "staff_account_not_created"
    }
    ```
- 📸 **Tên file Evidence**: `TC_REG_04_CreateStaff_Duplicate_400.png`

---

### PHẦN 4: PHÂN QUYỀN QUẢN LÝ CƠ SỞ TRỌ (POST /api/v1/capture/locations)

#### Kịch bản 4.1: Chặn Staff tự ý tạo cơ sở trọ mới (RBAC GBR-01..02)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/locations`
- **Authorization**: `Bearer <Token_Staff>`
- **Body (raw JSON)**:
  ```json
  {
    "name": "Nhà trọ trái quyền",
    "address": "Số 1 Cầu Giấy, Hà Nội"
  }
  ```
- **Kỳ vọng (Expected)**:
  - **Status**: `403 Forbidden` _(Chỉ Owner mới có quyền tạo Location)._
- 📸 **Tên file Evidence**: `LOC02_Staff_CreateLocation_Forbidden_403.png`

---

### PHẦN 5: ĐĂNG XUẤT VÀ THU HỒI TOKEN (POST /api/v1/auth/logout)

#### Kịch bản 5.1: Đăng xuất phiên làm việc hiện tại

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/auth/logout`
- **Authorization**: `Bearer <Token_Owner>`
- **Kỳ vọng (Expected)**:
  - **Status**: `204 No Content`
- 📸 **Tên file Evidence**: `SESS02_Logout_Success_204.png`

---

#### Kịch bản 5.2: Kiểm tra Token bị thu hồi sau đăng xuất

- **Method**: `GET`
- **URL**: `https://localhost:7240/api/v1/auth/me`
- **Authorization**: Dùng lại chính `<Token_Owner>` vừa đăng xuất.
- **Kỳ vọng (Expected)**:
  - **Status**: `401 Unauthorized` _(Phiên làm việc đã bị hủy trong DB)._
- 📸 **Tên file Evidence**: `SESS03_GetMe_RevokedToken_401.png`

---

## 📊 BẢNG TỔNG HỢP DANH MỤC EVIDENCE CHỤP ẢNH BÁO CÁO

| STT | Mã Kịch Bản | Method & Endpoint                          |   Status Kỳ Vọng   | Tên File Ảnh Evidence                           |
| :-: | :---------: | :----------------------------------------- | :----------------: | :---------------------------------------------- |
|  1  | **UTC001**  | `POST /api/v1/auth/login` (Staff)          |      `200 OK`      | `UTC001_Login_Staff_Success_200.png`            |
|  2  | **UTC002**  | `POST /api/v1/auth/login` (Owner)          |      `200 OK`      | `UTC002_Login_Owner_Success_200.png`            |
|  3  | **UTC010**  | `POST /api/v1/auth/login` (Wrong Pass)     | `401 Unauthorized` | `UTC010_Login_WrongPassword_401.png`            |
|  4  | **UTC003**  | `POST /api/v1/auth/login` (Null Email)     | `400 Bad Request`  | `UTC003_Login_NullEmail_400.png`                |
|  5  | **UTC004**  | `POST /api/v1/auth/login` (Invalid Format) | `400 Bad Request`  | `UTC004_Login_InvalidEmailFormat_400.png`       |
|  6  | **UTC005**  | `POST /api/v1/auth/login` (Empty Pass)     | `400 Bad Request`  | `UTC005_Login_EmptyPassword_400.png`            |
|  7  |  **ME-01**  | `GET /api/v1/auth/me` (Owner Token)        |      `200 OK`      | `ME01_GetMe_Owner_200.png`                      |
|  8  |  **ME-02**  | `GET /api/v1/auth/me` (Staff Token)        |      `200 OK`      | `ME02_GetMe_Staff_200.png`                      |
|  9  | **REG-01**  | `POST /api/v1/capture/staff` (Owner)       |      `200 OK`      | `TC_REG_01_Owner_CreateStaff_Success_200.png`   |
| 10  | **REG-02**  | `POST /api/v1/capture/staff` (Staff)       |  `403 Forbidden`   | `TC_REG_02_Staff_CreateStaff_Forbidden_403.png` |
| 11  | **REG-03**  | `POST /api/v1/capture/staff` (No Auth)     | `401 Unauthorized` | `TC_REG_03_CreateStaff_Unauthenticated_401.png` |
| 12  | **REG-04**  | `POST /api/v1/capture/staff` (Duplicate)   | `400 Bad Request`  | `TC_REG_04_CreateStaff_Duplicate_400.png`       |
| 13  | **LOC-02**  | `POST /api/v1/capture/locations` (Staff)   |  `403 Forbidden`   | `LOC02_Staff_CreateLocation_Forbidden_403.png`  |
| 14  | **SESS-02** | `POST /api/v1/auth/logout`                 |  `204 No Content`  | `SESS02_Logout_Success_204.png`                 |
| 15  | **SESS-03** | `GET /api/v1/auth/me` (Post-logout)        | `401 Unauthorized` | `SESS03_GetMe_RevokedToken_401.png`             |
