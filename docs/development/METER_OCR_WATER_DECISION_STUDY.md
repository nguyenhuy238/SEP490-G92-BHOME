# Water OCR decision study — 05/11/2026

Nguồn dữ liệu: author validation101 và test52 ở
`Ntarekp/Mbarira-Watermeter-model@72d1821ad6d97e00275bfd80c508df233555328a`.
Ảnh/nhãn giữ nguyên; cùng resize1600/JPEG85 như Mobile. Một ảnh validation
`wm_clean_000386.jpg` trùng SHA256 với test bị loại khỏi calibration; tool mặc định
báo lỗi nếu còn overlap, chỉ loại khi truyền `--exclude-exact-overlap` và ghi rõ
exclusion. Còn100 validation,69 nhãn đầy đủ; test52,33 nhãn đầy đủ. Group theo
physical meter/site chưa biết, nên đây không phải acceptance độc lập BHOME.

## Phân tích fallback baseline

Trên52 typed-water cases:3 proposal đúng,20 chuỗi stage2 đúng nhưng bị từ chối,
19 ảnh có annotationu bị từ chối,10 ảnh còn lại stage2 sai/không có chuỗi bị từ
chối. Xem breakdown riêng missing vs incorrect trong
[decision evidence](meter-ocr-water-decision-study.json). `u` annotation không
tự chứng minh ảnh thật không đọc được; không gán các ca đó là đúng/sai khi GT chưa
đủ. Không có false proposal trong33full labels của baseline.

Automatic là chiều độc lập:52/52 chưa phân loại hoàn chỉnh,31 ca có cảnh báo
`recognizer_profile_required`. Thiếu profile không phải là lỗi đọc glyph. Quyền
Staff, Location và type từ server vẫn phải được xác minh riêng.

## Policy increment được kiểm chứng

PP một dòng malformed không có **numeric reading hợp lệ** có thể là recognizer
không đọc được, thay vì một reading cạnh tranh. Cho phép stage2-only review trong
nhánh này khi các guard stage1/window/u/geometry/confidence/blur đều qua. Hai chuỗi
số hợp lệ khác nhau vẫn reject; nhiều vùng/line ambiguous/sai utility vẫn reject.
Giữ leading zeros, precision từ server, không bù digit thiếu hoặc mapu thành số.

Grid validation dùng min confidence.5/.6/.7/.8/.9/.95/.97/.99. Chọn.5 theo coverage
validation lớn nhất với0knownFalse, trước khi chấm test; đây cũng là digit gate
cũ, không giảm threshold. Nhánh thêm:8 đúng/0sai trên100 validation sau dedup;
7 đúng/0sai trên52 test cũ. Exact original labels giữ nguyên. Không coi0sai trên
tập nhỏ là bằng chứng production risk0 hoặc calibration theo site đã hoàn tất.

Đo runtime đầy đủ trên cùng52 ảnh:

| Metric               | Trước increment             | Sau increment  |
| -------------------- | --------------------------- | -------------- |
| Typed exact /33full  | 3/33                        | 10/33          |
| False /33full        | 0                           | 0              |
| Fallback /52         | 49                          | 42             |
| Typed p50/p95/max ms | 220/801/1019 (lượt trước)   | 202/820/916    |
| Auto exact /33full   | 1/33                        | 1/33           |
| Auto false /33full   | 0                           | 0              |
| Auto fallback /52    | 51                          | 51             |
| Auto p50/p95/max ms  | 3498/6171/6962 (lượt trước) | 2853/5702/6731 |

Latency là các lần chạy khác nhau trên máy dev CPU, có tác vụ khác; không khẳng
định tốc độ cải thiện có ý nghĩa thống kê. Tất cả52 proposal/fallback của lượt mới
trong10s. Mục tiêu90% và classifier4 loại vẫn chưa đạt.

## Model bánh số bổ sung — thử thật, không deploy

`oleost/visionstate-wheel-reader@563f365a5b377c10c7248517ef2576ac5cee3cbf`:
`wheels-v1.onnx` SHA256
`37912f885b061a7b12298872fbdfa1b73ca0664363b293a55617b1d3680a98ac`.
Đã xem license Apache-2.0, input N×1×48×32/output N×100, chạy ORT CPU trên51 crop
có cells từ stage2. Preprocess darkest channel/PIL bilinear/autocontrast1%, decode
position theo tài liệu/source, không dùng previous reading hay sửa GT.

Trên33full labels:13 exact,19 false,1 không có window; agreement với stage2 có
13 exact/1 false. Cell geometry từ stage2 chưa phải ROI chuẩn của provider; kết
quả không đại diện tác giả công bố. **Không tích hợp model này vào runtime** vì
không đủ bằng chứng giảm false. Model cũng không phân loại4 loại. Code probe và
license kèm ở `model_tools`; weights chỉ trong `.tools/`.

Reproduce audit/candidate bằng `--water-decision-audit`, rồi
`model_tools/evaluate_water_decisions.py` với validation/test audit. Probe wheel
reader nhận model và folder audit qua `evaluate_wheel_reader.py`. Các output raw
public-only/cells ở `.tools`, không commit ảnh hoặc digit strings từ dữ liệu private.
