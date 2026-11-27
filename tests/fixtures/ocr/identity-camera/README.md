# Ảnh camera CCCD tổng hợp

Tạo bằng `scripts/New-IdentityCameraFixtures.ps1`. Đây là các khối chữ và hình học
tự tạo, có ghi rõ dữ liệu giả lập, không phải CCCD thật và không có danh tính thật.
Số 12 chữ số toàn 0 chỉ kiểm tra đường nhận dạng, không phải số căn cước hợp lệ.

Các ảnh gồm nền có chữ ngoài thẻ, vùng ảnh đại diện giả, nhãn song ngữ và giá trị ở
dòng riêng, ảnh nghiêng 6 độ. Cảnh được thu nhỏ còn 1920 × 2400 rồi mã hóa JPEG,
tương ứng giới hạn cạnh dài 2400 của mobile. GDI không mô phỏng mọi bộ mã hóa camera,
chất liệu chống giả, ánh sáng, bố cục hoặc độ chính xác trên CCCD thật.

`manifest.json` cố định số, tên, ngày sinh và ngày cấp kỳ vọng theo ảnh gốc. Không sửa
kỳ vọng theo kết quả model.

Chạy hồi quy:

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate tests/fixtures/ocr/identity-camera/manifest.json
```

So sánh cùng ảnh trước/sau bước tách thẻ (báo cáo không chứa giá trị OCR):

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --identity-camera-evaluate .tools/ocr-models tests/fixtures/ocr/identity-camera/manifest.json .tools/identity-camera
```

Lệnh so sánh dùng cùng model, parser và ngân sách thời gian; baseline chỉ bỏ tách thẻ.
Exit code theo kết quả bản mới; kết quả baseline vẫn được ghi riêng, kể cả khi thất bại.
