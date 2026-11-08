# OCR accuracy recovery — 08/11/2026

Bắt đầu từ `b2cf984d98e08802652d50e11edf5139afe08a3c`, nhánh `member/QHuy`,
tree sạch. Kết quả mới: thử nghiệm full-row water-mechanical tăng **10/33→11/33
exact digit strings**; chưa đổi reader mặc định hoặc bật Staff reader mới.
Trace: BF-05/UC-20/GBR-07 → đọc ảnh, proposal và human confirmation;
UC-21/JOB-10/GBR-09 → chỉ confirmed readings dùng cho invoice. Không đổi routing,
API, schema, authorization, model weights hoặc billing.

1. **Defect được sửa:** trên ảnh thật 122443403, numeric box `[363,239,431,138]`
   đọc `000890`, nhưng crop mở rộng kéo chữ hãng vào CTC thành `GF000898`.
   Nay giữ box/số quan sát ban đầu khi alternate chứa brand/unit/status text và
   kiểm active ink trên đúng box được chọn. Không strip chữ để chế ra số.
   **DEVELOPMENT_DIAGNOSTICS**: đây vẫn là partial observation, chưa phải complete
   reading `000890.00` hoặc billing value. Kiểm thử dùng pixels/hash và model thật.

2. **105770219 vẫn fallback.** Numeric box `[562,476,118,45]`: PP raw `IGPC4`,
   English `16254`, mean .9051. Detector dùng native prepared edge1600 tăng mean
   lên .9205 nhưng không tìm được unit/register đáng tin; text gần đó không phải
   bằng chứng kWh. Không ép category, mượn unit từ calibration hoặc đoán decimal.

3. **`000501` và `74590` được giữ**, qua actual ASP.NET/ONNX diagnostics và
   PostgreSQL task-guided regression. Leading zeros giữ nguyên. Tăng detector
   edge1280→1600 tìm được kWh trên ảnh LCD xanh, nhưng expanded digits thành
   `0008909`, vẫn sai/thiếu decimal. Probe **REJECTED**; runtime giữ edge1280.

4. **Fresh full-frame readings chưa tăng.** Ba ảnh nguồn mới chỉ có blank/status
   chưa xác minh hoặc rolling digit, không có independent numeric GT. Gain mới
   nằm ở benchmark publisher lịch sử: validation100 ảnh/69 complete labels tăng
   12→14 exact (`0587954`, `00130437`), test52/33 labels tăng 10→11 (`0587956`).
   Không dùng oracle box: full photo → Stage1 predicted row → PP direct row →
   Stage2 agreement → parser, với mechanical-water profile được chỉ định.
   Đây chưa phải source/physical-device-independent acceptance.

5. **Classifier chưa cải thiện.** Thử đúng một recipe: utility từ toàn ảnh,
   technology logits .5 toàn ảnh + .5 display; body/display đều dự đoán từ pixels.
   Không train lại38/40 ảnh, không dùng oracle boxes hoặc chỉnh ngưỡng .55/.75.
   Chỉ 1/23 ảnh có unique predicted body+display đủ điều kiện; display crop có
   thêm tín hiệu digital nhưng fused score chưa đủ ngưỡng. **REJECTED**, giữ model
   `f7277b05…`; không port candidate bị loại vào workflow.

   | Classification cohort, provisional | Cũ correct/wrong/unknown | Candidate |
   | --- | --- | --- |
   | Historical validation7 | 1/0/6 | 1/0/6 |
   | Historical test9 | 1/1/7 | 1/1/7 |
   | Previous source probes4 | 0/0/4 | 0/0/4 |
   | Fresh source development2 | 0/0/2 | 0/0/2 |
   | New photo, author đã có trong development1 | 1/0/0 | 1/0/0 |

   Historical test precision1/2, non-meter false acceptance0/2, đều không đổi.
   Fresh source precision undefined vì không accepted output; recall DE0/1,
   WM0/1; ME/WD không có fresh positive để tính recall. Các lớp thiếu mẫu không
   được ghi recall0. Final independent holdout: **NOT_RUN**.

6. **Không thêm invalid reading:** controls cũ 7/7 vẫn null; ba ảnh mới đều null
   qua ASP.NET. Ba ảnh mới chưa có before-reading run, không tạo delta giả.
   Timer/counter4, blank/inactive, serial, wrong unit/register và single-digit
   consumption context vẫn qua regression. Missing/corrupt models vẫn fallback.

7. **Water-mechanical có gain thử nghiệm, reader mặc định chưa đổi.** PP page
   segmentation từng tách một wheel row thành ký tự rời. Candidate đọc lại toàn
   predicted row bằng PP CTC hiện có, mean≥.95 và phải khớp đủ Stage2 digits.
   Không thay model, không chuyển Stage2 sang electricity. Existing complete PP
   numeric disagreement vẫn veto, ví dụ `00845927` đối với Stage2 `00845922`.
   Candidate không đăng ký DI, không chạy trong ordinary Staff route.

   | Metric, cùng historical test52/profile MechanicalWater | Baseline | Candidate | Delta |
   | --- | ---: | ---: | ---: |
   | Complete-label exact strings /33 | 10 | 11 | +1 |
   | Wrong strings /33 complete labels | 0 | 0 | 0 |
   | Proposals khi thiếu complete GT /19 | 0 | 0 | 0 |
   | Manual fallback /52 | 42 | 41 | −1 |
   | Independently verified billing readings | 0 | 0 | 0 |
   | Newly Staff-enabled readers | 0 | 0 | 0 |

   Validation100: fallback88→86, wrong0/69 và unknown-GT proposals0/31. Các
   partitions cũ chưa được xác minh tách physical meter; không coi đây là fresh
   acceptance hoặc đạt target≥90% trên≥50 ảnh. Trạng thái **EXPERIMENTAL**.

8. **Chưa category nào đủ bằng chứng mới cho Staff activation.** Human reviews,
   independent register/precision labels đều0; không có category mới
   **ACCEPTED_FOR_STAFF**. Hai chữ số đúng trên development không xác minh unit,
   register hoặc decimal cho triển khai nghiệp vụ.

9. **Không bật reader mới.** CLIP/English vẫn **DEVELOPMENT_DIAGNOSTICS** với
   `businessProposalEnabled=false`; PP/Stage2 và manual correction/confirmation
   hiện có tiếp tục theo config. Không sửa routing đã hoàn tất hoặc bật Production.

   | Category | Historical classifier test: correct/wrong/unknown | Full-frame reading scope hiện đo | Status mới |
   | --- | --- | --- | --- |
   | Mechanical electricity | 1/0/1, n=2 | Không có complete numeric cohort mới | BLOCKED_BY_DATA |
   | Digital electricity | 0/0/2, n=2 | Frozen8 ảnh,5 draft positives:2 exact,0 wrong,6 fallback; không đổi | DEVELOPMENT_DIAGNOSTICS; Staff blocked |
   | Mechanical water | 0/0/2, n=2 | Historical52: candidate11/33 exact,0 wrong,41 fallback | EXPERIMENTAL |
   | Digital water | 0/1/0, n=1 | Frozen2 ảnh,1 draft positive:0 exact,0 wrong,2 fallback; không đổi | BLOCKED_BY_DATA |

   Classifier recall lần lượt1/2,0/2,0/2,0/1. Class-specific precision chỉ có
   ME1/1, WM0/1; DE/WD undefined vì không accepted prediction. Numeric profiles
   và các cohort khác nhau ở bảng này không được cộng thành four-class accuracy.
   WD historical classifier case là product illustration, không phải nghiệm
   thu ảnh của thiết bị thật.

10. **Data/human blockers:** giữ nguyên blind pilot6; thêm water review3 bằng
    tool cũ, không tạo annotation app. Ba ảnh water nguồn cũ chưa chứng minh ba
    thiết bị readable độc lập; một blank, hai cần review digits/register/unit.
    141189268 có provisional digit-label conflict ở một vị trí, đã loại khỏi
    exact metrics mới, không sửa nhãn cũ theo OCR. Tải original gặp HTTP429 nên
    dừng; không bypass. Cần view readable của≥3 thiết bị, complete number,
    register, unit, decimal và source/physical grouping được human xác minh.
    [Handoff cụ thể](../datasets/meter/ACCURACY_NEXT_REVIEW_HANDOFF.md).

11. **Commits local:** `8c72c93` chuẩn bị probes/handoff; `cff80c3` giữ numeric
    box khi expansion lẫn chữ; `0167ff6` đo full-row và display-fusion; commit
    chứa report này ghi kết quả/checks. Mỗi commit có English title/body; không
    có feature commit activation, model binary hoặc ảnh trong Git.

12. **Git cuối:** HEAD là commit chứa report này, nhánh `member/QHuy`. Full SHA,
    danh sách commits/files và clean status được ghi sau commit ở
    `.tools/ocr-accuracy-next-final-state.json`, history append vào
    `.tools/ocr-next-git-history.md`. Không push/merge/rebase/squash/reset/deploy.

Đã chạy: Release build0 warnings/errors; Application349; OCR batch162 và thêm
1 fresh-control test (3 ảnh); PostgreSQL8 — PASS, không skip. Classifier parity9
nằm trong OCR suite; English4, Stage2 parity10 PASS. PG disposable đã dừng,
storage substitute được khai báo. Mobile **NOT_RUN** vì không đổi source/DTO/UI;
camera/MinIO thật **NOT_RUN**, không thấy listener9000/9001 hoặc adb/device.
Postman chỉ read-only status, không chạy collection assertions.

[Measured results](ocr-recognition-accuracy-next-results.json) và
[commands/log hashes](ocr-recognition-accuracy-next-verification.json) phân biệt
component, profile-guided full-frame, provisional và independent acceptance.
