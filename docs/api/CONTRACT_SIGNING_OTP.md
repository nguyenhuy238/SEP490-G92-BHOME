# Ký hợp đồng bằng OTP email (chữ ký điện tử)

Cập nhật **09/11/2026**. Kế hoạch và các quyết định còn mở: `D:\BHOME\Plan\BHOME_OTP_Signing_Plan.md`.

## Mục đích

Owner và Tenant ký hợp đồng ngay trong BHOME bằng **chữ ký điện tử**, gồm:
- hình chữ ký: Owner tải lên hoặc vẽ trên web, Tenant vẽ tay trên mobile;
- **mã OTP gửi qua email**;
- nhật ký bằng chứng.

Sau mỗi lượt ký, BHOME **đóng dấu PDF (PAdES) bằng chứng thư của hệ thống**, ghi nối thêm vào cuối file (incremental), nên chữ ký trước đó vẫn hợp lệ và mọi chỉnh sửa sau này đều bị phát hiện.

- SRS v1.3: UC-14/15/16 yêu cầu *electronically sign* và lưu trạng thái, bằng chứng (DBR-03). *Certified digital signature* nằm ngoài MVP.
- Luật Giao dịch điện tử 2023, Điều 23 khoản 1: chữ ký điện tử có hiệu lực pháp lý. Chữ ký này **không** tương đương chữ ký số (khoản 2).
- Viettel MySign vẫn còn trong backend, bật hoặc tắt bằng cấu hình.

## Cấu hình

```json
"ContractSigning": {
  "Methods": { "Otp": true, "ViettelMySign": false },
  "Otp": { "Length": 6, "TtlSeconds": 300, "MaxAttempts": 5, "ResendSeconds": 60, "Secret": null, "DevelopmentLogCode": false },
  "Seal": { "PfxPath": null, "PfxPassword": null }
}
```

| Khóa | Ý nghĩa |
|---|---|
| `Methods.Otp` | Bật ký OTP. Mặc định trong code là `false`; `appsettings.Development.json` bật `true` |
| `Methods.ViettelMySign` | Mặc định `true`, giữ hành vi cũ. Khi `false`: `/digital-signing/certificates` và `/digital-signing/settings/viettel` trả **404 `signing_method_disabled`** |
| `Otp.Secret` | Khóa HMAC để băm mã OTP, ít nhất 32 ký tự. Nếu bỏ trống thì dùng `DigitalSigning:SecretKey`. Development/Testing tự sinh khóa theo tiến trình |
| `Otp.DevelopmentLogCode` | **Chỉ dùng ở Development:** khi kênh email ở chế độ `Sandbox` (không gửi thật), mã OTP được in ra log server để thử ở máy. Production không bao giờ in mã |
| `Seal.PfxPath` / `PfxPassword` | Chứng thư đóng dấu của BHOME (PKCS#12). Đặt bằng biến môi trường hoặc user-secrets, **không commit**. Development/Testing nếu không cấu hình thì dùng chứng thư tự ký tạm, tên `BHOME Seal (Development - not trusted)`. Production thiếu chứng thư thì trả 503 `signing_seal_not_configured` |

Khi `ContractWorkflow:SimulatedSigningEnabled = true` (chế độ demo giả lập), chỉ còn cách ký `SIMULATED`.

**Gửi email:** dùng kênh có sẵn `NotificationChannels`. Muốn nhận mã thật thì đặt `Mode = "Smtp"` và điền `SmtpHost`, `SmtpPort`, `SmtpUser`, `SmtpPassword`, `FromAddress`. Ví dụ dùng Mailtrap khi dev, hoặc Gmail App Password khi demo. Nếu kênh email chưa cấu hình, bước bắt đầu ký trả 503 `otp_email_unavailable` trước khi lưu gì.

## API

Tất cả cần Bearer token của **Owner** hoặc **Tenant**, và người gọi phải là một bên ký của hợp đồng.

| Method / route | Mô tả |
|---|---|
| `GET /api/v1/contracts/signing-methods` | `{ methods: ["OTP", …], default: "OTP" }`. UI chỉ hiện các cách ký có trong danh sách |
| `PUT /api/v1/digital-signing/signature-image` | (có sẵn) Lưu ảnh chữ ký PNG của người đang đăng nhập. Mobile gửi ảnh Tenant vừa vẽ |
| `GET /api/v1/contracts/{id}/signing/layout`, `GET …/signing/pages/{n}` | (có sẵn) Trang PDF và ô ký gợi ý |
| `POST /api/v1/contracts/{id}/signing` + `Idempotency-Key` | Body `{ "method": "OTP", "certificateId": "00000000-0000-0000-0000-000000000000", "placement": {…}?, "usePicture": true }`. Chuẩn bị PDF (chèn ảnh và dòng *"Ký điện tử bởi … / Ngày ký … / Xác thực: mã OTP qua email"*), **gửi OTP**, trả lượt ký ở trạng thái `Pending` |
| `GET /api/v1/contracts/{id}/signing/otp` | `{ signatureId, status: "Sent"\|"Locked", maskedEmail, expiresAt, resendAfterSeconds }` |
| `POST /api/v1/contracts/{id}/signing/otp/resend` | Gửi mã mới (sau `ResendSeconds`); cũng dùng khi email đầu tiên gửi lỗi |
| `POST /api/v1/contracts/{id}/signing/otp/confirm` + `Idempotency-Key` | Body `{ "code": "482915" }`. Đúng mã: đóng dấu PDF, lượt ký `Signed`; khi đủ hai bên, hợp đồng → `PendingActivation` |
| `GET /api/v1/contracts/{id}/document` | (có sẵn) Tải PDF đã ký |

### Lỗi

| HTTP / code | Khi nào |
|---|---|
| 400 `otp_invalid_format` | Mã không đúng độ dài hoặc có ký tự không phải chữ số |
| 400 `otp_incorrect` | Mã sai, vẫn còn lượt thử |
| 409 `otp_expired` | Mã đã hết hạn hoặc không còn tồn tại. Bấm gửi lại mã |
| 409 `otp_resend_too_soon` | Gửi lại trước thời gian chờ |
| 409 `otp_locked` | Đã sai quá `MaxAttempts`, lượt ký bị đánh dấu `Failed`. Phải bấm Ký lại từ đầu |
| 409 `signer_email_required` | Tài khoản người ký chưa có email |
| 503 `signing_method_disabled` | Cách ký đang tắt trong cấu hình |
| 503 `otp_email_unavailable` / `signing_seal_not_configured` / `otp_secret_not_configured` | Máy chủ thiếu cấu hình email, chứng thư đóng dấu hoặc khóa OTP |

## Dữ liệu và bằng chứng

- Không thêm bảng hay migration.
- **Lượt ký** nằm ở `contract_signings`: `provider_code = 'BHOME_OTP'`, `signing_status`, `snapshot_hash`, `prepared_*`, `signed_object_key`, `signed_hash`, `signed_at`; chi tiết trong `signing_data.compactState` (`credentialId = "BHOME-OTP"`, `providerUserId` = người ký, chuỗi chứng thư đóng dấu).
- **Lịch sử:** audit `ContractSigningPrepared`, `…Requested`, `…OtpResent`, `…OtpRejected`, `ContractSignatureVerified`.
- **Mã OTP** chỉ lưu **HMAC-SHA256** trong `IDistributedCache` (bộ nhớ, hoặc Redis nếu được đăng ký), kèm hạn dùng, số lần sai và thời điểm gửi. Mã chỉ dùng một lần, không trả qua API, không ghi log (trừ cờ `DevelopmentLogCode` ở Development). Nếu chạy nhiều instance API thì phải dùng cache chung (Redis).
- **Email:**
  - *Mã xác nhận* chỉ gửi khi người ký bấm **Ký**.
  - *Bạn có hợp đồng cần ký* gửi cho bên còn lại sau khi một bên ký xong.
  - *Hợp đồng đã được ký đủ* gửi cho cả hai bên.
  - Email không chứa CCCD, số tiền hay file PDF.

## Giới hạn hiện tại

- Chứng thư đóng dấu Development là chứng thư tự ký, nên Adobe sẽ báo *chưa xác minh được người ký*. Khi demo, import chứng thư BHOME vào danh sách tin cậy của Adobe.
- Chưa có "hạn lời mời ký" (đề xuất 72 giờ, quyết định D5) và chưa có API Tenant từ chối ký. Hai phần này còn chờ chốt với nhóm.
- Chưa có màn hình web và mobile cho OTP (P3, P4 trong plan).
