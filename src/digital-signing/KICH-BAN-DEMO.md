# Kịch bản demo ký số (chế độ giả lập)

Kịch bản cho phần trình bày chức năng **ký số từ xa** của BHOME trước hội đồng, dùng sandbox ở chế độ
**Viettel giả lập**. Tổng thời gian khoảng **7–8 phút**, gồm 1 phút giới thiệu, 5 phút demo, 1–2 phút
giải thích kỹ thuật. Phần hỏi đáp có sẵn câu trả lời ở cuối.

Chi tiết kỹ thuật: [LUONG-KY-SO-KY-THUAT.md](LUONG-KY-SO-KY-THUAT.md). Cách chạy: [README.md](README.md).

## 1. Chuẩn bị (làm trước buổi bảo vệ ít nhất 1 ngày)

| Việc                              | Cách làm                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cài .NET 8 SDK                    | `winget install Microsoft.DotNet.SDK.8`                                                             |
| Lấy code mới nhất                 | `git switch Nguyenhuy-Dev` rồi `git pull`                                                           |
| Chạy thử một lượt từ đầu tới cuối | Theo mục 3, trên **đúng máy sẽ mang đi bảo vệ**                                                     |
| Chuẩn bị 1 file PDF đẹp           | Ví dụ "Hợp đồng thuê phòng 101", 2 trang, trang cuối có chỗ "Bên A / Bên B" để ký                   |
| Tải sẵn trang trong trình duyệt   | Trang cần internet để tải thư viện xem PDF. Nếu phòng bảo vệ mạng yếu, mở trang trước khi vào phòng |
| Cài Adobe Acrobat Reader          | Để mở file đã ký và cho hội đồng xem bảng chữ ký                                                    |

**Trước giờ demo 5 phút**, mở terminal ở thư mục gốc repo và chạy chế độ giả lập **bắt buộc**
(`-Fake`), để dù máy có lưu tài khoản Viettel cũng không gọi Viettel thật:

```powershell
powershell -ExecutionPolicy Bypass -File src/digital-signing/run-sandbox.ps1 -Fake
```

Mở **http://localhost:5280**. Góc trên phải phải hiện huy hiệu **"Viettel giả lập"**.

> Dữ liệu sandbox nằm trong bộ nhớ: tắt đi bật lại là trắng, đúng như muốn cho buổi demo.
> Không dùng tài khoản Viettel của đơn vị khác khi demo.

## 2. Giới thiệu (≈ 1 phút)

> "Trong BHOME, hợp đồng thuê phòng cần được ký số để có giá trị pháp lý. Chúng em chọn **ký số từ
> xa**: khóa bí mật của người ký nằm trong thiết bị bảo mật (HSM) của nhà cung cấp, người ký chỉ cần
> xác nhận trên điện thoại, không cần USB token.
>
> Chúng em đã tích hợp theo đúng API bất đồng bộ của **Viettel MySign**. Hôm nay chúng em demo ở **chế
> độ giả lập**, vì tài khoản tích hợp Viettel chỉ cấp cho doanh nghiệp có hợp đồng. Toàn bộ phần xử
> lý PDF, chữ ký và quy trình là code thật; chỉ có phần 'người giữ khóa' được thay bằng bản giả lập."

## 3. Demo (≈ 5 phút)

### Bước 1: Khai báo chứng thư số (≈ 45 giây)

1. Giữ vai **Owner** (chủ nhà) ở góc trên.
2. Mục **1. Chứng thư số**, mở **+ Khai báo chứng thư**:
   - Mã thuê bao MySign: `079000000001`
   - Họ tên trên chứng thư: `NGUYỄN VĂN AN` (tên chủ nhà trong kịch bản)
3. Bấm **Khai báo**. Thẻ chứng thư hiện tên, serial, ngày hết hạn, trạng thái **Đang hiệu lực**.

> "Hệ thống hỏi nhà cung cấp chứng thư của thuê bao này và lưu lại **thông tin công khai**: tên,
> serial, hạn dùng. Khóa bí mật không bao giờ đi qua BHOME. Mỗi chứng thư chỉ thuộc về một người."

### Bước 2: Ảnh chữ ký (≈ 20 giây)

1. Mục **2. Ảnh chữ ký**: ô họ tên đã có sẵn, bấm **Tạo từ họ tên**.
2. Ảnh chữ ký màu xanh nền trong suốt hiện ra.

> "Ảnh chữ ký chỉ để hiển thị trên giấy. Giá trị pháp lý nằm ở chữ ký số bên trong file."

### Bước 3: Đặt vị trí và gửi yêu cầu ký (≈ 1 phút)

1. Mục **3. Ký số tài liệu**: chọn file **hợp đồng PDF** đã chuẩn bị.
2. Trang **cuối** tự mở, ảnh chữ ký nằm ở chân trang. **Kéo** chữ ký vào ô "Bên A", chỉnh **Cỡ chữ ký**.
3. Ô "Nội dung hiện trên điện thoại": `Ky hop dong thue phong 101`.
4. Bấm **Ký số**.

> "Lúc này hệ thống chèn một ô chữ ký trống vào file, tính **mã băm SHA-256** và chỉ gửi mã băm này
> cho nhà cung cấp. **Nội dung hợp đồng không rời khỏi BHOME.**"

Chỉ vào dòng trạng thái: _"Đã gửi yêu cầu ký. Xác nhận trên ứng dụng MySign của bạn (còn 4:59)…"_

### Bước 4: Xác nhận trên "điện thoại" (≈ 45 giây)

1. Khung **📱 Điện thoại giả lập** hiện yêu cầu ký kèm nội dung vừa nhập.
2. Bấm **Xác nhận**.
3. Khoảng 2 giây sau: **"✔ Ký số thành công"**.

> "Ở bản thật, thông báo này hiện trên app MySign của chủ nhà. Trang web hỏi lại trạng thái vài giây
> một lần; khi có chữ ký, hệ thống **gắn chữ ký vào đúng file đã băm** và **xác minh lại** trước khi
> lưu."

Nếu mạng phòng bảo vệ cho phép, có thể quét mã QR bằng điện thoại thật để mở trang `phone.html` và
bấm Xác nhận trên điện thoại. Mạng trường thường chặn kết nối giữa các thiết bị, nên **đừng dựa vào
bước này**; khung điện thoại giả lập trên trang là đủ.

### Bước 5: Kết quả (≈ 1 phút)

1. Xem bản PDF đã ký ngay trên trang: chữ ký nằm đúng chỗ đã kéo.
2. Bấm **Tải PDF đã ký**, mở bằng **Adobe Acrobat Reader**, mở bảng **Chữ ký (Signature Panel)**:
   - Adobe báo **tài liệu không bị sửa đổi kể từ khi ký** (toàn vẹn hợp lệ).
   - Adobe báo **chứng thư không tin cậy**. Giải thích ngay:

> "Chứng thư này do chế độ giả lập tự tạo nên Adobe không tin. Với chứng thư Viettel-CA thật, phần
> này sẽ hiển thị người ký và tổ chức cấp hợp lệ. Phần toàn vẹn thì đã đúng: nếu sửa một chữ trong
> file, Adobe sẽ báo chữ ký mất hiệu lực."

> Chưa ai mở thử file đã ký bằng Adobe trên máy demo. Hãy thử trước ở bước chuẩn bị để biết chính xác
> Adobe hiển thị gì.

### Bước 6: Tình huống lỗi (≈ 30 giây, nếu còn thời gian)

1. Bấm **Ký số** lại, lần này ở khung điện thoại bấm **Từ chối**: trang báo **"Người ký đã từ chối"**.
2. Đổi vai sang **Tenant**: không thấy chứng thư của Owner. Chứng thư chỉ ký được cho đúng chủ của nó.

## 4. Giải thích kỹ thuật (≈ 1–2 phút)

Cuộn xuống **Nhật ký gọi API** cuối trang, chỉ vào các dòng:

| Request                                                     | Ý nghĩa                          |
| ----------------------------------------------------------- | -------------------------------- |
| `POST /api/v1/digital-signing/certificates` → 201           | Khai báo chứng thư               |
| `POST /api/v1/digital-signing/transactions` → 202           | Pha 1: chuẩn bị file, gửi mã băm |
| `GET /api/v1/digital-signing/transactions/{id}` → `pending` | Hỏi trạng thái mỗi 2 giây        |
| `GET …/transactions/{id}` → `signed`                        | Pha 2: gắn chữ ký, xác minh, lưu |
| `GET …/transactions/{id}/document` → 200                    | Tải file đã ký                   |

> "Đây chính là các API mà app mobile và web của BHOME sẽ gọi. Kiến trúc tách **nhà cung cấp chữ ký
> số** ra sau một interface: chuyển từ giả lập sang Viettel thật chỉ là **đổi cấu hình**, không sửa
> code. Phần này có 40 unit test, trong đó có test giả lập Viettel bằng HTTP và test ký PDF hai pha."

## 5. Câu hỏi hội đồng hay hỏi

**"Giả lập thì có giá trị gì? Khách hàng thật thì sao?"**

> Giả lập chỉ dùng để phát triển, kiểm thử và demo, không bao giờ dùng cho khách hàng thật. Khi triển
> khai, đơn vị vận hành BHOME (có mã số thuế) ký hợp đồng với nhà cung cấp để có tài khoản tích hợp;
> mỗi chủ nhà, người thuê dùng chứng thư MySign của chính họ. Hệ thống chỉ đổi cấu hình sang `Viettel`.
> Phần băm, gắn và xác minh chữ ký chạy giống hệt.

**"Sao không demo với Viettel thật?"**

> Viettel chỉ cấp tài khoản tích hợp API cho doanh nghiệp có hợp đồng, và hiện chỉ cho một số lĩnh
> vực; nhóm sinh viên không đăng ký được. Chúng em đã liên hệ Viettel-CA và nhận câu trả lời này.

**"Nếu Viettel không phục vụ lĩnh vực nhà trọ?"**

> Thiết kế không khóa vào Viettel. Có thể viết thêm provider cho nhà cung cấp khác (VNPT SmartCA,
> FPT-CA…) theo cùng interface `ISigningProvider`; phần PDF và quy trình không đổi.

**"Gửi file hợp đồng cho Viettel có lộ thông tin không?"**

> Không gửi file. Chỉ gửi mã băm SHA-256 dài 32 byte; từ mã băm không khôi phục được nội dung.

**"Làm sao biết file không bị sửa sau khi ký?"**

> Chữ ký bao trùm toàn bộ các byte của file (ByteRange). Sửa bất kỳ byte nào thì mã băm khác, chữ ký
> mất hiệu lực, và Adobe sẽ báo ngay. Hệ thống cũng tự xác minh lại trước khi lưu.

**"Hai người bấm cùng lúc, hoặc người ký không bấm xác nhận?"**

> Mỗi yêu cầu có trạng thái riêng; lệnh cập nhật có điều kiện trong database bảo đảm chữ ký chỉ được
> gắn một lần. Không xác nhận trong 5 phút thì yêu cầu tự hết hạn.

**"Chữ ký này có giá trị pháp lý không?"**

> Với chứng thư do tổ chức cung cấp dịch vụ chứng thực chữ ký số công cộng như Viettel-CA cấp thì có,
> theo Luật Giao dịch điện tử. Bản giả lập thì không, vì chứng thư do hệ thống tự tạo.

**"Thiếu gì để dùng thật?"**

> Tài khoản tích hợp của đơn vị vận hành; dấu thời gian (timestamp) để chữ ký còn kiểm chứng được lâu
> dài (hiện ở mức PAdES-B-B); lưu file vào MinIO thay vì database; tích hợp màn hình ký vào app mobile.

## 6. Nếu có sự cố khi demo

| Sự cố                               | Xử lý                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Trang không lên                     | Kiểm tra terminal còn chạy; thử `http://127.0.0.1:5280`                                        |
| Báo port 5280 bị chiếm              | Tắt sandbox cũ (`Ctrl+C` ở terminal cũ) rồi chạy lại                                           |
| Không xem trước được PDF            | Mạng chặn thư viện từ CDN: vẫn ký được, chỉ không thấy trang; dùng file PDF dự phòng đã ký sẵn |
| Huy hiệu hiện "Viettel MySign thật" | Tắt, chạy lại với `-Fake`                                                                      |
| Lỗi bất kỳ khác                     | Chuyển sang **file PDF đã ký sẵn** và video quay màn hình (nên quay trước một video dự phòng)  |
