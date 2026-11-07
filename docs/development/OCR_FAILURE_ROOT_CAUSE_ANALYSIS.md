# Phân tích nguyên nhân OCR — 07/11/2026

Start `268a6688bb422f050b405902fa655c157ce7d5d1`, `member/QHuy`, working tree sạch.
Scope BF-05/UC-20/GBR-07; SRS BF-05A/B và UC-20/21 được đọc lại: OCR là đề xuất,
Staff xác nhận trước billing; không thay quyền, schema, register hoặc tiền.

Kế hoạch: đo cùng ảnh bằng full pipeline và oracle window → kiểm riêng localization,
Stage2, PP, fusion → chọn candidate chỉ trên validation → freeze rồi mới chấm
historical test → tích hợp chỉ khi không bỏ veto. Không retrain classifier62 ảnh.

## Phép đo thực tế mới

CLI `--meter-failure-diagnostic` kiểm SHA ảnh/label trong manifest pinned; input cùng
Mobile1600/JPEG85. Raw model outputs, crop points, quality Laplacian, confidence và
order của từng digit, PP raw lines/bounds, numeric parser, fusion warnings, value và
latency được ghi dưới `.tools/ocr-recovery-validation/diagnostic-public-only.json`.
Ảnh crop chỉ trong thư mục ignored này. Không có endpoint/log production mới.
Dataset/utility được xác minh từ corpus tác giả; physical-meter groups, readability
review, decimal/register GT chưa có và giữ unknown/null. Không suy `u`=unreadable.

Validation100 sau loại SHA trùng test (`wm_clean_000386`),69 nhãn digit được publisher
coi đầy đủ; không phải acceptance độc lập. Source quadrilateral label class1 là
oracle, không phải dự đoán production. Một số label cần kiểm lại, xem bên dưới.

| Cấu hình / cả100 inputs | Exact /69 publisher-complete | Wrong proposal /69 | Fallback /100 |
| --- | --- | --- | --- |
| A: Full service hiện hành | 12 | 0 | 88 |
| Predicted window → Stage2 | 47 | 4 | 48 |
| Predicted window → PP page | 5 | 26 | 62 |
| Predicted window → current fusion | 12 | 0 | 88 |
| C: Oracle window → Stage2 | 49 | 5 | 44 |
| D: Oracle window → PP page | 10 | 28 | 48 |
| E: Oracle window → current fusion | 15 | 2 | 83 |

Số proposed với GT chưa đầy đủ được tách trong JSON, không tính như đúng/sai.
PP direct cũng được chạy riêng: predicted11 đúng/41 sai; oracle13 đúng/37 sai.
B là nhánh reader hiện tại trên oracle (Stage2/PP/fusion), không đo full-frame.
Oracle fusion có2 wrong theo nhãn publisher và có thể phát đề xuất trên ảnh bị
scene gate từ chối; không được dùng nó để quảng bá15 đúng như production.

**Nút thắt chính trên corpus này là PP recognition/fusion, không phải window recall.**
Stage1 có một window khớp IoU≥0,5 trên100/100 annotations; scene policy chỉ cho75/100
qua vìu/confidence/geometry guards. Các nguyên nhân chồng lấp, không cộng thành
100 lỗi riêng. Stage2 chuỗi đúng47 trên predicted crops nhưng PP chỉ5; fusion phải
giữ nhiều rejection vì có competing numeric output. Oracle chỉ tăng Stage2 đúng
47→49, không giải quyết PP sai. Điều này không chứng minh Stage1 tốt trên meter
khác miền: ảnh Commons35558 vẫn không có display detection ở lượt trước.

## Ví dụ có thể tái lập và rủi ro annotation

- `wm_clean_000317`: publisher digits `0118717` (7 boxes), nhưng crop public cho thấy
  tám wheel positions; Stage2/English cùng đọc `01187817`. Raw ảnh và polygons được
  lưu để review. Đây là **nghi vấn thiếu digit annotation**, không tự sửa GT hoặc
  loại ca khỏi false-proposal count nhằm làm candidate qua gate. Cần reviewer độc lập.
- `wm_clean_000182`: Stage2 có hai class cạnh tranh0/4 và1/7 ở cùng vị trí; overlap
  rejection là cần thiết. Không chọn box confidence cao rồi giả định đủ sequence.
- `wm_clean_000429`: publisher cóu; model có chuỗi numeric nhưng chưa đủ GT và wheel
  review. Không dùng agreement của hai model thay annotation verification.
- `wm_clean_000177`, `wm_clean_000502`: generic Vietnamese PP sai chuỗi; là ứng viên
  để thử model ngôn ngữ English có cùng khả năng nhận unit, không bỏ fusion veto.

## Hướng sửa được thử tiếp

1. Thay vì nới fusion, đánh giá recognizer English chính thức của PaddleOCR trên đúng
   crop/regions, giữ Stage2 completeness và type/register/blur/multiple-region veto.
2. Đo Stage1 độc lập với semantic scene gate, đặc biệtu nằm trong AABB nhưng ngoài
   oriented display và các góc chụp; sửa chỉ khi actual raw candidates chứng minh lỗi.
3. Không chấp nhận ensemble chỉ vì đúng GT từng ảnh. Confidence calibration phải
   freeze trên validation, wrong/unknown proposal được báo riêng; test không dùng tune.
4. Bổ sung pilot nhiều physical meters, có human review/precision/register; số ảnh
   lớn từ một Badger meter không giải quyết generalization.

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --meter-failure-diagnostic .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-validation tools/BHome.OcrSmoke/model_tools/evaluation-validation-deduplicated-manifest.json .tools/ocr-recovery-validation
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/summarize_failure_diagnostic.py .tools/ocr-recovery-validation/diagnostic-public-only.json docs/development/ocr-recovery-validation-stages.json
```

[Summary theo ảnh và hash raw](ocr-recovery-validation-stages.json). Lượt này chưa
đo lại automatic classifier ở trace trên vì Staff dùng trusted profile; automatic
baseline lịch sử1/33 được giữ riêng, không tái suy category từ output của typed path.
