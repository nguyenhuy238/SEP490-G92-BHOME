# OCR accuracy và category activation — 08/11/2026

Start `f61d6c5dac46f879bbe4d2444aaf3c0f4cb658ea`, `member/QHuy`, tree sạch.
**Chưa tăng được valid consumption readings hoặc classifier acceptance trên
nguồn mới. Không bật reader Staff mới.** Có thêm một complete English numeric
observation sau grouping vùng dự đoán, nhưng vẫn thiếu điều kiện chọn reading.
Chỉ thay model tools, research probes/review inputs và targeted tests; không đổi
Application/API/DB, runtime models mặc định hoặc Staff routing.
Trace: BF-05/UC-20/GBR-07; UC-21/JOB-10/GBR-09 giữ confirmed-reading-only billing.

1. **Water-mechanical có vượt11/33? Không.** Candidate mới lấy hull của **tất cả**
   Stage2 digit quads hợp lệ, thêm margin thực0.15 median glyph height và đọc lại
   bằng PP CTC, vẫn giữ complete-number disagreement veto và mean≥.95.

   | Historical publisher52, profile MechanicalWater | Default | Full-row cũ | Geometry mới |
   | ----------------------------------------------- | ------: | ----------: | -----------: |
   | Exact complete strings /33 labels               |      10 |          11 |           11 |
   | Wrong strings /33 labels                        |       0 |           0 |            0 |
   | Proposals khi thiếu complete GT /19             |       0 |           0 |            0 |
   | Fallback /52                                    |      42 |          41 |           41 |

   Geometry **REJECTED**. Giữ baseline và full-row cũ **EXPERIMENTAL**, không
   promote. Ca0587956 được full-row cũ phục hồi vì page detector tách từng glyph;
   CTC đọc toàn hàng mới thấy đủ thứ tự, không ghép chuỗi OCR hoặc chèn digit.
   PP00845927 và Stage2 00845922 vẫn là genuine conflict. Hai models đồng ý không
   phải independent proof; register/precision của benchmark chưa được human xác minh.

2. **Có reading đúng mới từ ảnh chưa dùng trước đây? Chưa có valid reading mới.**
   Nguồn mới17 frame, chỉ320×240 và partial-body/register;16 được native header
   validation nhận,1 bị từ chối. Ba complete strings chỉ là agent visual drafts.
   Cả default/full-row/geometry: **0/3 exact**,0 wrong trên3 labels;15/16 admitted
   fallback và1 unverified proposal `00000` trên wheel transition, có từ baseline.
   Không tính proposal đó là đúng hoặc tuyên bố mọi input mới đã an toàn.

   Component grouping đọc lại **union pixels của các text boxes dự đoán**, không
   concatenate tokens hoặc dùng oracle boxes. Raw English exact observations
   trên3 drafts tăng2→3: frame14 đọc `00458`, mean .9924/min-char .9830. Nhưng PP
   đọc **010458**, unit m³ bị cắt ở mép phải và union-unit CTC chỉ mean .6659/
   min-char .3328. Vẫn **EXPERIMENTAL**, không tạo consumption/billing value hoặc
   bỏ veto. Đây không phải full-reader accuracy3/3.

   Nguồn17 là mới đối với evaluation của project, không chứng minh chưa từng có
   trong pretraining. Có frame cùng device, grouping provisional; SHA/dHash không
   phát hiện trùng historical152 frame không chứng minh physical independence.
   Sau phân tích lỗi, không dùng lại tập này như fresh final holdout.

3. **105770219 chưa phục hồi.** Đã xem lại ảnh gốc, LCD/adjacent-label evidence
   và trace: English16254, PP IGPC4, không có unit/total-register rõ. Actual
   ASP.NET task-guided regression vẫn null. Không suy kWh từ keypad/Meter type,
   calibration, số chữ số hoặc confidence. Cần ảnh rõ toàn LCD gồm unit và page
   tổng tích lũy, không phải credit/status; decimal cần xác minh riêng.

4. **74590 và000501 được giữ** trong real ONNX/ASP.NET và PostgreSQL regressions.
   `000890` vẫn partial observation; không thêm `.00` hoặc coi là billing value.
   Không chạy lại rejected high-resolution/fusion recipe cũ.

5. **Classifier nguồn mới không cải thiện.** Thêm50 licensed LCD frames vào
   technology training (không có SHA trùng corpus cũ), ngoài33 old positive frames;
   giữ CLIP và utility head frozen. Một recipe50 epochs, không đổi thresholds
   .55/.75, không gán utility/digit/register/precision cho nguồn mới. Không coi50
   frame là50 thiết bị: có manufacturer/device lặp. License chỉ dùng research
   offline phi thương mại; không đưa weights/images vào Git hoặc business runtime.

   | Cohort                       | Baseline correct/wrong/unknown | Candidate |
   | ---------------------------- | ------------------------------ | --------- |
   | Historical test9             | 1/1/7                          | 2/1/6     |
   | Historical validation7       | 1/0/6                          | 1/2/4     |
   | Previous source development2 | 0/0/2                          | 0/2/0     |
   | New-source native-admitted16 | 0/0/16                         | 0/5/11    |

   New-source accepted precision0/5; validation non-meter false acceptance0/4→2/4.
   Native C# loader/class mapping/hash/parity chạy thật; bad header vẫn bị chặn.
   Utility head không đổi vẫn có wrong argmax; thay technology confidence làm
   các lỗi utility/domain shift trước đó bị unknown trở thành wrong acceptance.
   **REJECTED**, giữ `f7277b05…`. Không chỉnh thresholds sau khi thấy kết quả.

6. **Controls cũ vẫn bị từ chối:**7 historical/development +3 ảnh bổ sung ở lượt
   trước, đều null qua HTTP regression. Bao gồm counter4, blank/inactive, serial,
   wrong unit/register. Single-digit consumption context vẫn qua test. Tách
   chúng khỏi17 inputs mới có1 unresolved proposal và1 rejected header; không
   gộp thành tỷ lệ rejection đẹp hơn thực tế. Không sửa bytes để bypass validation.

7. **Human-verified data vẫn0 cho cả bốn category.** Hai input kits A/B tách
   riêng, mỗi kit chứa6+3 ảnh cũ với source attribution, không có model/draft
   labels. A/B là slot chưa phân công, không phải identities. Reviews/exports/
   consensus vẫn0. [Handoff và ZIP paths](../datasets/meter/ACTIVATION_NEXT_DATA_HANDOFF.md).
   Nguồn LCD mới tìm được có manual access gate; chỉ đọc public metadata/card,
   không download gated assets hoặc submit thông tin. Digital-water vẫn thiếu
   full-resolution readable m³ photos của≥3 thiết bị được xác minh.

8. **Không reader nào đạt gate Staff mới.** Independent complete reading,
   register/decimal GT đều0; source recognition/false-proposal gates cũng chưa
   đạt. **ACCEPTED_FOR_STAFF: không có category mới.** Ordinary PP/Stage2, editable
   proposal, manual correction và explicit confirmation giữ nguyên. Không bật
   model mới cho diagnostics mặc định hoặc Production, không đổi invoice logic.

9. **Status và before/after theo category:** các partitions khác nhau được giữ riêng.

   | Category               | Historical classifier test correct/wrong/unknown, cũ→candidate | Numeric scope cũ→candidate                                    | Status                                 |
   | ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- |
   | Mechanical electricity | 1/0/1→1/0/1, n=2                                               | Complete numeric cohort mới: NOT_RUN                          | BLOCKED_BY_DATA                        |
   | Digital electricity    | 0/0/2→1/0/1, n=2                                               | Frozen8 frames/5 drafts:2 exact,0 wrong,6 fallback→giữ nguyên | DEVELOPMENT_DIAGNOSTICS; Staff blocked |
   | Mechanical water       | 0/0/2→0/0/2, n=2                                               | Historical10/33→11/33→11/33; new-source0/3 ở cả3 readers      | EXPERIMENTAL; geometry rejected        |
   | Digital water          | 0/1/0→0/1/0, n=1                                               | Frozen2 frames/1 draft:0 exact,0 wrong,2 fallback→giữ nguyên  | BLOCKED_BY_DATA                        |

   Verified billing values và newly enabled Staff readers đều0→0 ở mọi category.
   WD historical classifier case là illustration, không phải real-device proof.
   Trên native nguồn mới16 (đềuWM), recallWM0/16→0/16;5 accepted outputs sai
   (2 electricity-digital,3 water-digital). Lớp không có positive không tính recall.
   Precision/recall đầy đủ và denominators ở [classifier results](ocr-next-technology-classifier-results.json).

10. **Commits:** `090e44a` review inputs/source probes; `3a3f2d5` water geometry/
    fragment grouping; `8e2b877` technology-only adaptation và native parity;
    commit chứa report này lưu kết quả/checks. Tất cả có English title/body,
    không có misleading feature-completion commit. Final HEAD/clean tree ở
    `.tools/ocr-activation-next-final-state.json`; history append vào
    `.tools/ocr-next-git-history.md`. Không push/merge/rebase/squash/reset/deploy.

Đã chạy: Release build0 warnings/errors; Application349, OCR164, PostgreSQL8 —
PASS,0 skip. Old classifier native parity9, new classifier PyTorch/ONNX parity9,
English4, Stage2 parity10 và dataset/input-kit integrity checks PASS. Test pass
chỉ chứng minh execution/guards/parity, không chứng nhận model accuracy. PG đã
dừng; storage substitute khai báo. Mobile **NOT_RUN** vì không đổi source/DTO;
camera/MinIO thật **NOT_RUN**, không thấy session/listener phù hợp. Postman chỉ
read-only status, không có collection assertions.

[Water measurements](ocr-next-water-geometry-results.json),
[verification/failed-attempt receipts](ocr-next-accuracy-activation-verification.json).
