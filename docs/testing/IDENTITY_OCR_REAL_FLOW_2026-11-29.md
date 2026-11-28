# CCCD gắn chip: kiểm tra luồng thực tế ngày 29/11/2026

## Phạm vi và trạng thái nghiệm thu

Chỉ hỗ trợ tối ưu bố cục CCCD gắn chip trong bốn ảnh người dùng cung cấp: tám trường mặt trước và ngày cấp ở mặt sau. OCR là đề xuất, người dùng vẫn phải đối chiếu và xác nhận. Không thay đổi quyền, schema, quy tắc xác minh, API công khai hoặc model đã ghim. Chưa đủ bằng chứng để nghiệm thu mục tiêu thực tế ≥95% thường / ≥85% khó và p95 đầu cuối ≤5 giây.

Truy vết: yêu cầu hiện tại → BF-03 / UC-13, GBR-02/13 và NFR Internal OCR Processing trong SRS tại `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, quy tắc bảo mật trong `AGENTS.md` → các thành phần và kiểm thử dưới đây. Mục tiêu 5 giây và tỷ lệ đọc đủ chín trường là yêu cầu bổ sung của người dùng, không đổi thành mục tiêu OCR 10 giây cũ.

## Kế hoạch và thay đổi

| Bước               | Nguyên nhân đã xác định / xử lý                                                                                                                                                                                                                                                                                                          | Kiểm chứng                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Camera → ảnh gửi   | Giới hạn chiều 2.400 px và JPEG 0,95 làm giảm chi tiết trước khi Backend tìm thẻ. Riêng CCCD dùng PictureRef, quality/compress=1, chọn độ phân giải camera phù hợp giới hạn 12 MP; không giảm chất lượng nhiều lượt để ép qua giới hạn 5 MB. Ảnh quá lớn có thông báo chụp lại, file tạm được xóa.                                       | `prepare-capture`, `document-camera`, `identity-picture-size`; kiểm chứng camera vật lý còn chờ.                                     |
| Phát hiện thẻ      | Ngưỡng diện tích 12% loại thẻ chụp xa. Hạ xuống 4%, giữ kiểm tra kích thước tuyệt đối/tỷ lệ/lồi/mơ hồ; kết hợp biên và vùng sáng, thêm ứng viên màu có giới hạn. Không cắt các ô nhỏ bên trong ảnh đã có tỷ lệ thẻ.                                                                                                                      | `IdentityCardCropperTests`; một ảnh gốc vẫn chưa định vị được viền, có cảnh báo và giữ ảnh toàn cảnh.                                |
| Tiền xử lý         | Cắt thẻ trước resize, hiệu chỉnh phối cảnh, phóng mặt trước lên mức detector phù hợp, nâng sáng nhẹ; cảnh báo thẻ nhỏ, không tìm thấy thẻ, mờ, tối và chói. Không phục dựng hay suy diễn ký tự mất.                                                                                                                                      | Các kiểm thử ảnh tổng hợp và engine ONNX thật. Chói che mất chữ vẫn cần chụp lại.                                                    |
| OCR theo vùng      | Ưu tiên vùng dữ liệu trước chữ trang trí. Dừng khi đã đọc đủ trường của bố cục được hỗ trợ. Đọc lại tối đa ba vùng thiếu/độ tin cậy thấp bằng CLAHE và thời hạn riêng; không OCR lại toàn ảnh cho từng trường thiếu.                                                                                                                     | `IdentityRegionRecoveryTests`, thử nghiệm ONNX, kiểm tra bảo toàn dữ liệu khi hết thời hạn phụ.                                      |
| Trích xuất         | Ghép nhãn song ngữ cách xa và địa chỉ có dòng tiếp theo thụt về trái; giữ ranh giới nhãn kế tiếp và cột. Không coi dãy số trong MRZ chưa kiểm tra là số CCCD.                                                                                                                                                                            | `OcrParserTests`, `IdentityEvidenceTests`.                                                                                           |
| QR / MRZ           | QR được giải mã nội bộ bằng ZXing.Net 0.16.11; chỉ nhận cấu trúc bảy phần của mẫu chip cũ, không mở URL. MRZ kiểm tra độ dài, ký tự, các checksum và checksum tổng. Chỉ biến thể có số CCCD 12 chữ số lặp lại và hợp lệ mới bổ sung số/ngày sinh theo thế kỷ được mã hóa. Không đoán thế kỷ ngày hết hạn, không dựng lại dấu tiếng Việt. | QR UTF-8 tổng hợp trong RAM; MRZ hợp lệ/sai checksum/xung đột. QR/MRZ không chứng minh giấy tờ thật hay người xuất trình là chủ thẻ. |
| Tự điền / chụp lại | Giữ giá trị đọc thành công và giá trị đã sửa; chỉ bổ sung ô trống, địa chỉ tiếp nối có cùng số CCCD, hoặc tên có dấu quan sát trực tiếp thay tên MRZ chưa dấu. Số CCCD khác nhau chặn ghép dữ liệu. Đánh dấu thiếu/chưa chắc/xung đột theo trường; kết quả một phần không còn bị báo hỏng toàn bộ vì thiếu bố cục.                       | `identity-merge-evidence`, `onboarding-ui`; vẫn bắt buộc xác nhận thủ công.                                                          |

Không có thay đổi đường nhận dạng hoặc nén ảnh công tơ điện/nước. Các tối ưu mới được giới hạn cho profile CCCD; các kiểm thử hồi quy công tơ vẫn phải chạy.

Tệp sản xuất thay đổi: Application (`IdentityOcrLayout`, `OcrContracts`, `OcrFieldParser`, `IdentityOcrEvidence`); Infrastructure (`IdentityCardCropper`, `IdentityTextRegionOrder`, `ImagePreprocessor`, `OnnxOcrEngine`, `IdentityFieldRegions`, `IdentityQrReader`, package reference); Mobile (`CameraCapture`, `DocumentCameraView`, `LiveCaptureCamera`, `IdentityWizard`, `identity`, `ocrDiagnostics`, `prepareCapture`, `identityPictureSize`). Các tệp còn lại là kiểm thử, bộ sinh mẫu, công cụ đối chiếu riêng và tài liệu; danh sách đường dẫn đầy đủ có trong JSON bằng chứng kèm theo.

## Bằng chứng ảnh gốc, bảo mật

Bốn ảnh chỉ được đọc từ thư mục do người dùng chỉ định, xử lý cục bộ. Công cụ `--identity-private-review` mở trang loopback có đường dẫn ngẫu nhiên, CSP và no-store để người dùng tự đối chiếu ảnh/kết quả ngay trên máy. Không đưa ảnh hoặc giá trị CCCD vào chat, fixture, log, dịch vụ ngoài hay Git. Báo cáo chỉ giữ chỉ số ảnh, tên trường, đánh dấu đúng/sai và thời gian. Hai ảnh mặt trước và hai ảnh mặt sau của **một giấy tờ** không phải bốn danh tính độc lập.

Người dùng đã hoàn tất đối chiếu trên engine `identity-regions1`:

| Chỉ số                                   |    Kết quả |
| ---------------------------------------- | ---------: |
| Ảnh do người dùng xếp điều kiện thường   |          4 |
| Ảnh đúng toàn bộ trường kỳ vọng theo mặt |        4/4 |
| Trường đúng / sai / không đọc được       | 18 / 0 / 0 |
| p95 cục bộ, một lần gọi đúng mặt mỗi ảnh |   4.545 ms |
| Điều kiện khó được người dùng gắn nhãn   |          0 |

Đây là kết quả người dùng xác nhận của phiên bản đó. Không chuyển nhãn độ chính xác này sang phiên bản sau khi chưa đối chiếu lại. Chạy đo chỉ có tên trường hiện diện không chứng minh giá trị đúng; chạy cả hai profile cho mỗi ảnh không phải p95 đúng mặt.

Bản cuối `identity-regions7` chạy lại đúng mặt của cả bốn ảnh: đủ các trường kỳ vọng xuất hiện, p95 3.739 ms. Một mặt trước đọc thêm ngày cấp qua QR; một mặt sau bổ sung số, ngày sinh, giới tính, quốc tịch và tên không dấu qua MRZ. Có cảnh báo địa chỉ OCR/QR không khớp ở một ảnh; giữ giá trị OCR trước để đối chiếu. **Không có đánh giá thủ công mới về giá trị của bản cuối**, nên đây là số liệu hiện diện/thời gian, không phải 18/18 đúng mới.

## Bộ tổng hợp độc lập và hồi quy

Bổ sung sáu bộ nội dung giả khác nhau, hai font, ngày/giới tính/địa chỉ khác nhau; mỗi bộ có mặt trước, mặt sau và mặt trước chỉ nhãn. Ba điều kiện thẳng/tối/phối hợp tạo 54 ca, gồm 36 ca có dữ liệu và 18 ca cần từ chối. Không dùng ảnh gốc để sinh mẫu hoặc sửa nhãn theo đầu ra OCR. QR và MRZ có các ca tổng hợp độc lập riêng.

Lượt `identity-regions2` trước sửa cuối: 50/54 ca khớp, 0/18 đề xuất trên mẫu trống; 4 trường sai đều là họ tên, không thiếu trường; p95 4.689 ms. Với ca có dữ liệu, đúng toàn bộ là 32/36; họ tên đúng 14/18. Không cộng ca từ chối vào tỷ lệ đọc đủ dữ liệu. Kết quả này vẫn dưới mục tiêu và cho thấy giới hạn nhận dạng dấu tiếng Việt. Chưa đo bản gốc trước phiên tối ưu này trên chính bộ sáu nội dung, không suy ra mức tăng từ bộ 21 biến thể cũ.

Lượt cuối `identity-regions7` trên cùng 54 ca giữ 50/54: 32/36 mặt có dữ liệu khớp, 0/18 đề xuất sai trên mẫu trống, 158/162 trường đúng. Ghép hai mặt theo nội dung/điều kiện để đánh giá **đủ chín trường**: 14/18 cặp đúng; thẳng 5/6, tối 5/6, phối hợp 4/6. Đây là mẫu tổng hợp nhỏ, không phải tỷ lệ thực tế. p95 toàn bộ 54 ca 4.497 ms, riêng 36 mặt có dữ liệu 6.756 ms, lớn nhất 7.147 ms. Lượt chạy dùng máy phát triển đồng thời chạy hồi quy; chưa có benchmark triển khai chuyên biệt. Mục tiêu p95 5 giây chưa được chứng minh và không được coi là đạt nhờ đưa các ca từ chối nhanh vào mẫu đo.

Bộ 21 biến thể ở bản cuối: 21/21, 63/63 trường, p95 3.753 ms; bản trước tối ưu ghi trong báo cáo 28/11 là 14/21, 52/63 trường, p95 5.762 ms. Các lượt chạy khác thời điểm và tải máy; mức cải thiện này chỉ áp dụng bộ mẫu đó. Thử nghiệm lấy mẫu dòng chữ trực tiếp để giữ dấu đã bị loại vì sinh đề xuất trên mẫu chỉ có nhãn; không đưa thay đổi thử nghiệm đó vào bản cuối.

Số liệu trước/sau trên bộ 21 biến thể và ba bộ cũ được giữ nguyên theo phiên bản trong [báo cáo 28/11](IDENTITY_OCR_CHIP_CAMERA_2026-11-28.md). Báo cáo lịch sử đó không phải kết quả bản cuối ngày 29/11.

| Bộ ảnh chạy lại qua bản cuối | Khớp toàn bộ ca | Sai / thiếu trường | Đề xuất trên mẫu trống | p95 mỗi ảnh |
| ---------------------------- | --------------: | -----------------: | ---------------------: | ----------: |
| Chip camera                  |           21/21 |              0 / 0 |                      0 |    3.753 ms |
| Challenge                    |           29/31 |              2 / 0 |                      0 |    4.447 ms |
| Nền bàn                      |           13/17 |              4 / 0 |                      0 |    4.263 ms |
| Nền bàn bố cục dày           |           16/17 |              1 / 0 |                      0 |    4.781 ms |

Ba bộ cũ giữ số ca đúng như trước, chưa khắc phục hết lỗi tên có dấu. Smoke qua engine ONNX thật với fixture tổng hợp của bốn profile công tơ cũng trả đúng chỉ số và vẫn yêu cầu xác nhận. [JSON bằng chứng](identity-ocr-real-flow-2026-11-29.json) chứa từng kết quả đã loại giá trị dữ liệu cá nhân, phiên bản và phép ghép hai mặt để tính đúng đủ chín trường.

## Kiểm thử và môi trường

Đã chạy: Integration OCR bản cuối 206 đạt, 31 bỏ qua theo điều kiện môi trường/model; Mobile toàn bộ 1.861 đạt và kiểm lại 55 ca ghép dữ liệu/onboarding sau thay đổi cuối đều đạt; build solution và build API bản cuối 0 cảnh báo/lỗi. Typecheck Mobile, ESLint toàn repo, Prettier, kiểm tra định dạng .NET và detector UI (`[]`) đã chạy. Không đổi skip hoặc hạ cổng chất lượng để làm xanh. Bằng chứng Mobile JUnit cũng qua `Verify-FrontendEvidence.py` với 0 fail/skip.

Hồi quy theo cấu hình CI cục bộ hoàn tất: **2.829 đạt, 0 lỗi, 32 bỏ qua**. `Verify-BackendTrx.py` xác minh đủ năm assembly, inventory đã commit và discovery hiện tại; `Verify-StagingRegressions.py` xác minh 26 nhóm hồi quy bắt buộc. PostgreSQL tạm bật ghi statement, tắt ghi tham số; không dùng DB đang vận hành.

Trong lượt đó có 8/8 `MeterCaptureRegressionTests` trên PostgreSQL và 12/12 `CaptureWorkflowTests` đạt. Sau khi thu đủ bằng chứng đã tắt ghi statement của PostgreSQL thử; vẫn giữ môi trường API/Metro riêng để người dùng kiểm tra thiết bị sau. Build toàn solution bản cuối được chạy lại thành công, 0 cảnh báo/lỗi.

| Assembly                 |   Đạt | Lỗi | Bỏ qua |
| ------------------------ | ----: | --: | -----: |
| Application.UnitTests    |   796 |   0 |      0 |
| Domain.UnitTests         |   115 |   0 |      0 |
| IntegrationTests         | 1.610 |   0 |     32 |
| Infrastructure.UnitTests |   267 |   0 |      0 |
| DigitalSigning.UnitTests |    41 |   0 |      0 |

Lượt đầy đủ dùng build `identity-regions6`; sau đó bản `identity-regions7` chỉ bổ sung điều kiện không dừng sớm khi còn dòng địa chỉ được phát hiện và ca hồi quy tương ứng. Toàn bộ nhóm Integration OCR được chạy lại trên bản cuối (206 đạt, 31 skip), cùng build API/solution và các kiểm tra HTTP nói dưới đây. Không cộng lượt kiểm lại vào tổng 2.829 để làm tăng số ca duy nhất.

Các lệnh chính đã thực thi: `dotnet build src/backend/BHome.sln -c Release --no-restore`, `dotnet test src/backend/BHome.CI.slnf -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1`, discovery/verifier của CI, Vitest toàn Mobile và export Expo web. Một lượt CI ban đầu bị dừng vì thiếu cấu hình log SQL; đã chạy lại đúng cấu hình. Các lượt build dùng chung thư mục output gặp khóa file trên Windows đã được thay bằng output riêng/build tuần tự. Không coi các lượt bị dừng là kết quả đạt.

HTTP thật qua HTTPS trên Backend bản cuối, tài khoản/dữ liệu giả: 7/7 kiểm tra đạt. Mặt trước khớp chính xác tám trường (4.515 ms), mặt sau khớp ngày cấp (2.322 ms), có `no-store` và `requiresConfirmation=true`. Từ chối anonymous 401, Tenant 403, resident không nhìn thấy/không tồn tại 404, mặt sai 400 và ảnh hỏng 400. Đây không phải kiểm thử camera hoặc thời gian đầu cuối Mobile.

Môi trường thiết bị dùng PostgreSQL/MinIO mới, tài khoản giả và cấu hình riêng trong thư mục Git bỏ qua; tắt job/email/thông báo bên ngoài. Không sửa dữ liệu hay bí mật môi trường dùng chung. HTTPS kiểm tra đúng CA/SAN trên LAN. Metro xuất bundle Android và iOS thành công; việc đó chưa chứng minh Expo Go/camera/HTTPS hoạt động trên điện thoại thật. Người dùng đã chủ động để phần thử Android/iPhone thực tế sang sau; trạng thái **NOT RUN**, không chặn bàn giao phần mã nguồn và bằng chứng hiện có. Không xác nhận/lưu danh tính thật vào DB thử.

Remote CI/CD chưa chạy cho thay đổi chưa commit/push. Chạy các lệnh tương ứng CI cục bộ không chứng minh triển khai hoặc job GitHub đã xanh.

## Nguồn kỹ thuật và giới hạn

- [Expo SDK 58 Camera](https://docs.expo.dev/versions/v58.0.0/sdk/camera/) và [ImageManipulator](https://docs.expo.dev/versions/v58.0.0/sdk/imagemanipulator/): đối chiếu với mã native/package đã cài; PictureRef và chất lượng ảnh vẫn cần thiết bị thật xác minh.
- [ZXing.Net](https://github.com/micjahn/ZXing.Net): thư viện giải mã chạy nội bộ, Apache-2.0. Được thêm vì thử nghiệm trên hai mặt trước cho thấy OpenCV không giải mã được QR nào, decoder managed đọc được một; không phải cam kết đọc mọi QR xa/mờ.
- [ICAO Doc 9303 Part 5](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p5_cons_en.pdf): định dạng TD1 và checksum. Checksum không bao phủ/khôi phục dấu họ tên.
- [Nguồn chính thức về nội dung QR mẫu chip](https://asemconnectvietnam.gov.vn/default.aspx?ID1=1&ID8=106540&ZID1=29) và [cấu trúc số định danh](https://bvhttdl.gov.vn/huong-dan-kiem-tra-ma-dinh-danh-ca-nhan-co-bi-sai-thong-tin-hay-khong-va-cach-xu-ly-20220825110731501.htm): chỉ dùng định dạng quan sát được; không thêm suy luận tuổi, địa chỉ hoặc nơi cấp.

Confidence là điểm vận hành từ model/nguồn dữ liệu, chưa được hiệu chuẩn thành xác suất đúng. Dữ liệu chưa chắc vẫn cần người dùng kiểm tra. Muốn nghiệm thu thực tế cần thêm giấy tờ độc lập được phép, phân loại điều kiện và nhãn do người đối chiếu cung cấp, đo đầy đủ từ chụp → gửi → xử lý → tự điền trên hai nền tảng. Không tuyên bố đạt 95%/85% hoặc p95 5 giây từ mẫu nhỏ hiện tại.

JPEG quality=1 là mức chất lượng cao nhất của API camera/manipulator, không phải định dạng lossless. Giữ giới hạn bảo vệ API 12 MP/5 MB; ảnh mã hóa vượt 5 MB bị từ chối và xóa file tạm thay vì tự hạ chất lượng. Chưa đo tỷ lệ gặp giới hạn này trên điện thoại thật. Một ảnh gốc vẫn chưa tìm được viền thẻ; QR xa và dấu tiếng Việt khi mờ vẫn là hạn chế. Không có xử lý nào khôi phục đáng tin cậy chữ bị mất vì chói/mờ nặng.

## Chạy lại và kiểm tra thiết bị sau bàn giao

```powershell
dotnet build src/backend/BHome.sln -c Release --no-restore
dotnet test tests/backend/BHome.Application.UnitTests -c Release --filter FullyQualifiedName~.Ocr.
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter FullyQualifiedName~.Ocr.
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate .tools/identity-chip-camera/fixtures/manifest.json .tools/identity-chip-camera/recheck.json
```

Sinh sáu bộ nguồn bằng `New-IdentityChipCameraLayout.ps1 -Variant 0..5` (gọi từng variant vào thư mục `case-N` riêng), rồi dùng `--generate-identity-chip-corpus <source> <destination>` để tạo manifest 54 ca. Công cụ `--identity-private-evaluate <models> <input> <report> [human-review.json]` chỉ ghi metadata; đối số cuối chọn đúng mặt theo lần đối chiếu trước, không kế thừa nhãn độ chính xác. Công cụ `--identity-private-review` cho phép đối chiếu lại cục bộ khi người dùng sẵn sàng.

Trong Expo Go trên từng máy: dùng cùng Wi-Fi, mở Metro của môi trường thử riêng, đăng nhập Staff giả, mở người ở đang chờ xác minh. Thử hai mặt ở điều kiện thường rồi xa/nghiêng/tối/chói nhưng chữ còn đọc được; đối chiếu đủ chín ô, dấu tên và mọi dòng địa chỉ. Chụp lại một mặt phải giữ dữ liệu đã nhập và đánh dấu xung đột; thiếu trường không làm mất các ô đã đọc. Kiểm tra chụp lại/đóng màn hình/xuống nền xóa ảnh tạm. Chỉ thử thao tác xác nhận lưu với dữ liệu tổng hợp. Ghi model máy, Expo Go/version, số cặp đúng đủ chín trường/tổng lần, tên trường sai/thiếu và thời gian; không gửi ảnh hay nội dung CCCD vào chat.
