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

## Kiểm độc lập localization/digit boxes

Chạy raw Stage1 với pinned ONNX và cùng letterbox/decode/NMS hiện hành trên100
validation. Giả thuyếtu nằm trong AABB nhưng ngoài polygon display không xuất hiện:
0 ca AABB-only,0 selection thay đổi;75 allowed ở cả hai cách. Không tích hợp một
thay đổi geometry không có lợi ích được đo. Threshold không đổi.

Stage2 per-digit được match class-agnostic bằng Hungarian/IoU≥0,3 với digit polygons
publisher đã warp vào đúng crop. Đây là threshold **đánh giá**, không đổi production.
Trên predicted crops:571 known annotated digits,6 missing,18 extra boxes,544 matched
đúng,13 matched sai digit,8u prediction ở vị trí known,0 ordering inversions. Trên
oracle:739 known,10 missing,22 extra,696 đúng,20 sai,13u ở known,0 inversions.
Các ca thiếu/malformed annotation vẫn có thể ảnh hưởng metric; không sửa GT từ model.
Chưa có căn cứ để đổi sortX/NMS hoặc chọn digit giữa các overlapping classes.

[Kết quả localization/digits và hash raw](ocr-recovery-localization-digits.json).

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --water-localization-audit .tools/meter-detection-models .tools/meter-detection-validation tools/BHome.OcrSmoke/model_tools/evaluation-validation-deduplicated-manifest.json .tools/ocr-recovery-localization.json
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/audit_meter_digit_boxes.py .tools/ocr-recovery-validation/diagnostic-public-only.json .tools/meter-detection-validation .tools/ocr-recovery-digit-boxes-validation.json
```

## Ch?n ?o?n tr?c ti?p historical52: v? sao ch?10/33

?? ch?y l?i model th?t tr?n52 ?nh pinned;33 publisher-complete labels. Kh?ng d?ng
l??t n?y ?? ch?n candidate/threshold: c?c English/fusion candidates ?? b? lo?i ?
validation tr??c khi trace historical ???c xem.

- Full pipeline10 ??ng,0 sai theo33 labels,42 fallback, ??ng/all inputs10/52.
- Window IoU?0,5:51/52;0 unique predicted window sai IoU,1 kh?ng c? window.
  Scene gate cho36/52 qua; recall localization v? quy?n qua scene l? hai ch? s? kh?c.
- Predicted-window Stage2:23 chu?i ??ng,2 sai theo complete labels v?2 proposals c?
  GT thi?u; ch?10 chu?i ??ng ?i qua fusion. Oracle Stage2 ch?21 ??ng/5 sai theo labels;
  kh?ng c? l?i ?ch nh?n d?ng r? khi thay to?n b? crop b?ng oracle.
- Oracle fusion9 ??ng/1 sai,42 fallback; kh?ng ???c d?ng thay production safeguards.
- Stage2 ordering kh?ng ph?i nguy?n nh?n ?? ???c ch?ng minh ? audit validation.

?? xem contact sheet public13 recovery crops v? ??i chi?u raw trace. T?t c?13 c?
Stage2 kh?ng c?nh b?ou/geometry v? string kh?p nh?n publisher, IoU0,781..0,945.
Nh?ng9 c? **numeric PP c?nh tranh th?t**,3 c? nhi?u v?ng numeric/ph?n m?nh,1 m?.
T?ng ca c?n thi?u decimal/register GT v? human review ??c l?p; kh?ng g?i recovery
candidates l? c?c proposal ?? ???c x?c minh an to?n.

| ID historical | Stage2 / publisher digits | Window IoU | PP numeric candidate | Veto ph?i gi? |
| --- | --- | --- | --- | --- |
| 000004 | 00845922 | 0.865 | 00845927 | valid_numeric_disagreement |
| 000113 | 0768328 | 0.830 | 0768320 | valid_numeric_disagreement |
| 000141 | 00244805 | 0.853 | Kh?ng c? chu?i h?p l? | blur_guard |
| 000143 | 00244805 | 0.938 | Kh?ng c? chu?i h?p l? | multiple_numeric_regions |
| 000173 | 00429509 | 0.945 | 002295019 | valid_numeric_disagreement |
| 000175 | 00429509 | 0.816 | 307297599 | valid_numeric_disagreement |
| 000259 | 00236783 | 0.781 | 002367841 | valid_numeric_disagreement |
| 000280 | 02332836 | 0.802 | 02332831 | valid_numeric_disagreement |
| 000333 | 00339036 | 0.836 | 00339039 | valid_numeric_disagreement |
| 000358 | 00845922 | 0.920 | 00845927 | valid_numeric_disagreement |
| 000446 | 00555995 | 0.868 | 0055599 | valid_numeric_disagreement |
| 000490 | 0587956 | 0.809 | Kh?ng c? chu?i h?p l? | multiple_numeric_regions |
| 000493 | 0587957 | 0.846 | Kh?ng c? chu?i h?p l? | multiple_numeric_regions |

[Evidence13 ca](ocr-recovery-rejected-cases.json), [summary52](ocr-recovery-historical-stages.json).
Raw text/boxes/crops/latency v?n n?m trong `.tools/ocr-recovery-historical-test`.
Register/precision c?a m?i ca l? not annotated; kh?ng suy billing value t? digit
string. Nghi v?n nh?n317 ? validation kh?ng ???c d?ng ?? s?a historical GT.
