# BHome Digital Signing: ký số từ xa qua Viettel MySign

Đây là bản **clone độc lập** chức năng ký số từ xa (Remote Signing) của dự án `kho-so-tai-chinh`
(Java/Spring), chỉ lấy phần **Viettel MySign**, viết lại bằng .NET 8 theo kiến trúc phân lớp của BHome.

Module này **chưa được gắn vào BHome**: `BHome.sln`, `Program.cs`, `BHomeDbContext` và migration
đều không bị sửa. Module chỉ tham chiếu (đọc) `BHome.Domain` và `BHome.Application` để dùng
`ICurrentUser` và các role Owner/Staff/Tenant.

## Luồng ký

Giải thích kỹ thuật chi tiết (ByteRange, CMS, hai mã băm, API Viettel, máy trạng thái, bảo mật)
xem ở [LUONG-KY-SO-KY-THUAT.md](LUONG-KY-SO-KY-THUAT.md).

```text
Người ký          BHome API                               Viettel MySign
   │ POST transactions (PDF) ──► Pha 1: chèn ô chữ ký trống,
   │                             băm byte range, dựng CMS signed attributes
   │                             ──► login (token theo user_id, cache 1 giờ)
   │                             ──► signHash (async=1, chỉ gửi SHA-256) ──► đẩy thông báo tới app MySign
   │ ◄── 202 pending
   │ GET transactions/{id} (vài giây hỏi một lần)
   │                             ──► requests/status
   │                                 4000 chờ · 4001 hết hạn · 4002 từ chối · 1 đã ký
   │                             Pha 2: gắn chữ ký vào chính file đã băm,
   │                             xác minh lại chữ ký, lưu file đã ký
   │ ◄── signed
   │ GET transactions/{id}/document ──► tải PDF đã ký
```

- Chỉ **mã băm** rời khỏi hệ thống, file PDF không bao giờ được gửi cho Viettel.
- Chữ ký theo chuẩn **PAdES-BASELINE-B** (CAdES detached), không có timestamp vì luồng bất đồng bộ
  của Viettel không trả về timestamp.
- Pha 2 chạy ngay trong request của chính người ký: nếu người ký đóng trình duyệt, yêu cầu ký sẽ
  tự hết hạn sau `TransactionTtlSeconds`.
- Một chữ ký Viettel trả về mà không khớp chứng thư hoặc tài liệu sẽ bị từ chối (`SIGNATURE_INVALID`),
  file lỗi không được lưu.
- Nếu nhiều request cùng hỏi trạng thái, chỉ một request được gắn chữ ký: lệnh `UPDATE` có điều kiện
  `Pending → Signing` quyết định request nào thắng.

## Cấu trúc

| Project                                | Nội dung                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BHome.DigitalSigning.Domain`          | `SigningCertificate`, `SigningTransaction`, trạng thái                                                                                              |
| `BHome.DigitalSigning.Application`     | Các port (`ISigningProvider`, `IPdfSigner`, store), DTO, và 3 service: `SigningCertificateService`, `RemoteSigningService`, `SigningAccountService` |
| `BHome.DigitalSigning.Infrastructure`  | `ViettelMySignProvider` (HttpClient), `ITextPdfSigner` (iText 9), EF Core/Npgsql, mã hóa AES-GCM, `AddDigitalSigning()`                             |
| `BHome.DigitalSigning.Api`             | 3 controller trong `/api/v1/digital-signing`, xử lý lỗi sang ProblemDetails                                                                         |
| `tests/BHome.DigitalSigning.UnitTests` | 34 test xUnit                                                                                                                                       |
| `BHome.DigitalSigning.Sandbox`         | Trang web thử ký tạm cho nhóm (xem mục Sandbox), không deploy                                                                                       |
| `sql/001-digital-signing.sql`          | DDL PostgreSQL sinh từ model EF                                                                                                                     |

Bảng tương ứng với code gốc (Java):

| Java (`kho-so-tai-chinh`)                        | .NET (bản clone)                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `ViettelMysignProvider`, `ViettelMysignMessages` | `Viettel/ViettelMySignProvider.cs`, `ViettelMySignMessages.cs`, `ViettelText.cs` |
| `PdfSigningService` (EU DSS)                     | `Pdf/ITextPdfSigner.cs` (iText)                                                  |
| `DossierSigning` (start/status/complete)         | `RemoteSigningService` (ký một file PDF bất kỳ thay vì một hồ sơ)                |
| `SigningAccounts` + `SigningSettingsController`  | `SigningAccountService` + `SigningSettingsController`                            |
| `SigningCertificates.declare`, `SigningLedger`   | `SigningCertificateService`, `EfDigitalSigningStore`                             |
| bảng `superior_signing_*`                        | `SigningCertificates`, `SigningTransactions`, `SigningSettings`                  |

Phần **không** clone: VNPT SmartCA, ký bằng USB token (plugin), chứng thư/dấu của cơ quan, ảnh chữ ký,
trust store, và luồng duyệt hồ sơ cấp trên.

## API

| Method         | Đường dẫn                                            | Quyền              | Việc                                                                                    |
| -------------- | ---------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| GET            | `/api/v1/digital-signing/certificates`               | Owner/Staff/Tenant | Chứng thư của tôi                                                                       |
| POST           | `/api/v1/digital-signing/certificates`               | Owner/Staff/Tenant | Khai báo `{ providerUserId, serialNumber? }`                                            |
| DELETE         | `/api/v1/digital-signing/certificates/{id}`          | chủ chứng thư      | Gỡ chứng thư                                                                            |
| POST           | `/api/v1/digital-signing/certificates/{id}/lock`     | chủ chứng thư      | `{ locked }`                                                                            |
| POST           | `/api/v1/digital-signing/transactions`               | Owner/Staff/Tenant | multipart: `file`, `certificateId`, `description?`, `page?`, `x?`, `y?`, `width?` → 202 |
| GET            | `/api/v1/digital-signing/transactions/{id}`          | người yêu cầu      | Trạng thái; lần gọi gặp chữ ký sẽ gắn chữ ký luôn                                       |
| GET            | `/api/v1/digital-signing/transactions/{id}/document` | người yêu cầu      | Tải PDF đã ký                                                                           |
| GET/PUT/DELETE | `/api/v1/digital-signing/settings/viettel`           | Owner              | Xem/lưu/bỏ tài khoản Viettel đã lưu                                                     |
| POST           | `/api/v1/digital-signing/settings/viettel/test`      | Owner              | `{ userId }`: thử đăng nhập, không ký gì                                                |

Về ô chữ ký hiển thị: `page` bắt đầu từ 1; `x`, `y`, `width` là tỉ lệ (0..1) của trang, tính từ góc
trên-trái. Chiều cao ô tự tính theo số dòng chữ. Ô ghi "Ký bởi: <tên trên chứng thư>" và
"Ngày ký: dd/MM/yyyy HH:mm:ss" (giờ Việt Nam), font Tinos có dấu tiếng Việt, **cỡ 14pt**
(`SignatureFontSize`, bản Java dùng 10pt). Nếu không gửi các trường này, chữ ký sẽ vô hình.

## Cấu hình

Xem `appsettings.DigitalSigning.example.json`. Các giá trị bí mật (`SecretKey`, `Viettel:ClientSecret`)
đặt qua user-secrets hoặc biến môi trường (`DigitalSigning__Viettel__ClientSecret`), không commit vào repo.
Owner có thể lưu tài khoản Viettel trên màn hình cấu hình. Giá trị đã lưu sẽ ghi đè cấu hình theo
từng trường; client secret được mã hóa AES-256-GCM, và API chỉ trả về 4 ký tự cuối của nó.

## Sandbox: trang thử ký cho cả nhóm

Trong lúc app mobile và web chưa có màn hình ký số, project `BHome.DigitalSigning.Sandbox` dựng một
trang web tạm để thử toàn bộ luồng ký. Sandbox **không bao giờ được deploy**.

```powershell
# Từ thư mục gốc repo. Cần .NET 8 SDK (winget install Microsoft.DotNet.SDK.8)
powershell -ExecutionPolicy Bypass -File src/digital-signing/run-sandbox.ps1
```

Sau đó mở **http://localhost:5280**.

### Ký thật bằng Viettel MySign

1. Ở vai **Owner**, mục **"Tài khoản ký số Viettel MySign"** ở đầu trang: nhập **Client ID** và
   **Client Secret** do Viettel cấp cho phần mềm (người giữ tài khoản gửi riêng, **không** đưa vào
   repo hay nhóm chat chung), bấm **Lưu tài khoản**. Huy hiệu góc trên chuyển thành
   "Viettel MySign thật".
2. Nhập mã thuê bao MySign của mình (thường là **số CCCD**) rồi bấm **Kiểm tra kết nối**: chỉ đăng nhập
   Viettel, không ký gì, không gửi gì tới điện thoại.
3. Khai báo chứng thư bằng mã thuê bao đó; tên trên chứng thư do Viettel trả về.
4. Ký như bên dưới; yêu cầu ký về **app MySign trên điện thoại** (4G cũng được). Mỗi lần ký tốn một
   lượt ký trong gói MySign.

Tài khoản chỉ lưu trên máy đang chạy sandbox, trong `%LOCALAPPDATA%\BHome\DigitalSigningSandbox\`
(secret mã hóa bằng một khóa sinh riêng cho máy đó), nên còn sau khi tắt/bật nhưng mỗi người tự khai
báo trên máy mình. Đây không phải nơi cất secret cho môi trường thật: khóa nằm cạnh dữ liệu nó bảo vệ.
"Xóa tài khoản đã lưu" đưa trang về Viettel giả lập. Chứng thư khai báo ở chế độ giả lập không ký thật
được: gỡ và khai báo lại sau khi đổi chế độ.

### Các bước trên trang

1. **Chứng thư số:** chọn vai Owner/Staff/Tenant (đăng nhập giả lập, không cần mật khẩu), rồi khai báo
   chứng thư bằng mã thuê bao. Ở chế độ giả lập, mã mặc định là `079000000001` (mã nào cũng được, hệ
   thống tự sinh khóa RSA và chứng thư thử cho mã đó; có ô điền họ tên để chứng thư mang đúng tên).
2. **Ảnh chữ ký:** tải PNG nền trong suốt hoặc bấm "Tạo từ họ tên".
3. **Ký số:** chọn file PDF; trang cuối mở sẵn, **kéo ảnh chữ ký** tới chỗ muốn ký, chỉnh cỡ, bấm
   **Ký số**. Trang tự hỏi lại mỗi 2 giây. Ở chế độ giả lập, bấm **Xác nhận/Từ chối** ở khung
   "Điện thoại giả lập" hoặc quét mã QR bằng điện thoại thật (cùng Wi-Fi) để mở `phone.html`, một
   trang giả làm app MySign. Ký xong thì xem trước và tải PDF đã ký.

Cuối trang có **nhật ký gọi API** (method, đường dẫn, mã HTTP, thời gian, JSON trả về), để cả nhóm
thấy đúng các request mà app mobile sau này sẽ gọi. Swagger ở `/swagger`.

| Cấu hình           | Mặc định                                                                                                    | Đổi sang                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Sandbox:Provider` | `Auto`: Viettel thật khi đã có tài khoản (lưu trên trang hoặc biến môi trường), Viettel giả lập khi chưa có | `Fake` (`run-sandbox.ps1 -Fake`): luôn giả lập · `Viettel` (`-Viettel`): luôn Viettel thật |
| `Sandbox:Storage`  | `Memory`: không cần database, mất dữ liệu khi tắt                                                           | `Postgres`: cần `ConnectionStrings__Database` và chạy `sql/001-digital-signing.sql`        |

Ở chế độ giả lập, **phần PDF và chữ ký là thật**: chữ ký được xác minh toàn vẹn bằng iText trước khi
lưu. Chỉ có chứng thư là tự ký, nên Adobe/Foxit sẽ báo chứng thư "không tin cậy". Đây là điều bình
thường. Việc mở file bằng Adobe/Foxit chưa được kiểm thử.

Lưu ý: muốn điện thoại mở được `phone.html` thì máy chạy sandbox phải để mạng Wi-Fi ở chế độ
**Private** (hoặc cho phép `dotnet` qua firewall), và điện thoại phải cùng mạng Wi-Fi.

## Build và test

`global.json` của repo yêu cầu .NET 8 SDK, giống phần backend:

```powershell
dotnet build src/digital-signing/BHome.DigitalSigning.sln
dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests
```

## Khi gắn vào BHome (chưa làm)

1. Thêm các project vào `BHome.sln`; `BHome.Api` tham chiếu `.Api` và `.Infrastructure`.
2. Trong `Program.cs`: gọi `services.AddDigitalSigning(configuration)` và `services.AddDigitalSigningApi()`
   **trước** `AddExceptionHandler<ApiExceptionHandler>()`. Thêm `AddApplicationPart` cho assembly
   chứa controller.
3. Chuyển 3 cấu hình EF vào `BHomeDbContext` (hoặc giữ context riêng) và tạo migration thật.
   File `sql/001-digital-signing.sql` chỉ để tham khảo.
4. Cân nhắc lưu PDF vào MinIO (`IObjectStorage`) thay vì cột `bytea`, và chuyển việc hỏi trạng thái
   sang `IBackgroundJobQueue` nếu cần ký khi người dùng đã đóng trình duyệt.
5. Chốt với nhóm vai trò nào được ký và được cấu hình tài khoản. Hiện tại: mọi role được ký bằng
   chứng thư của chính mình, chỉ Owner được cấu hình.

## Lưu ý quan trọng

- **Giấy phép iText là AGPL-3.0.** Đồ án học tập dùng được, nhưng nếu phát hành thương mại mà không
  công bố mã nguồn thì cần mua giấy phép thương mại, hoặc thay `ITextPdfSigner` bằng thư viện khác.
  Module chỉ phụ thuộc vào interface `IPdfSigner`, nên có thể thay mà không đụng phần còn lại.
- **Chưa chạy thử với Viettel thật.** Provider được viết theo code Java (đã chạy với Viettel ngày
  06/10/2026) và được test bằng HTTP giả lập. Đường dẫn API của Viettel được để trong cấu hình vì tài
  liệu của Viettel mâu thuẫn nhau ở điểm này.
- Font Tinos (Apache-2.0) được copy từ dự án gốc, kèm file `Tinos-LICENSE.txt`.
