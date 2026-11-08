# OCR — nhận dạng và workflow Staff, 08/11/2026

Nhánh `member/QHuy`, bắt đầu từ `f766b0d29f204d9d83ceb12262844918bfd292a9`,
working tree ban đầu sạch. Đã sửa routing OCR hiện có và thêm task-guided
diagnostics read-only. **Chưa nghiệm thu hoặc bật reader experimental mới cho
Staff proposals.** Human reviews và independent register/precision labels vẫn 0.

Traceability: SRS v1.3 BF-05/UC-20/GBR-07 → profile Meter từ DB, Staff đúng
Location, proposal riêng với confirmed reading; UC-21/JOB-10/GBR-09 → invoice
chỉ dùng confirmed readings. Source SRS có tại `docs/reports/`; acceptance gates
được [ghi trước thử nghiệm](../datasets/meter/next-staff-recognition-gates.json).
Không đổi schema, tiền điện/nước hoặc quyền nghiệp vụ.

1. **Lỗi cụ thể được sửa.** Class-wise NMS của visual classifier có thể giữ
   nhiều category yếu trên cùng body. Trước đây tất cả bị coi là `multiple_meters`,
   chặn reader dù task có profile DB. Nay chỉ các giả thuyết khác category,
   cùng yếu dưới ngưỡng hiện có, mọi cặp IoU ≥ .8 được báo unknown/unverified và
   cho profile chọn reader. Nhiều body hoặc bất kỳ giả thuyết mạnh vẫn bị chặn.
   Kiểm thử có boxes tổng hợp và PP ONNX thật: ảnh render biết trước `123.45 kWh`
   trước sửa fallback → sau sửa editable proposal `123.45`; vẫn cần Staff xác nhận.
   Đây là bằng chứng sửa routing, **không phải** accuracy trên ảnh đồng hồ thật.
   Tool review hiện ghi được kW/kVA/V/A/Hz/calibration/flow/hour, tránh ép nhãn
   negative thành kWh; những unit đó không tạo billing metadata.

2. **105770219 đã đọc đúng chưa? Chưa.** Utility electricity .5653; technology
   mechanical .6486, digital .3514, chưa qua .75. Raw guess vẫn mechanical và
   classification unknown. Task DB digital-electricity nay chạy được numeric
   reader, nhưng trả `readingCandidate=null`, register unverified và
   `numeric_text_present_display_unverified`. Chuỗi nháp `16254` chưa có bằng
   chứng unit/register/precision để trở thành diagnostic reading hợp lệ.
   Không hardcode ID/category, không hạ threshold hoặc đổi nhãn theo output.
   Ảnh có LCD nhạt/phản sáng, keypad và phần tủ lớn; numeric bbox nháp chỉ còn
   khoảng 20×7 pixels trong classifier input 224. Đây là giả thuyết mất đặc trưng
   display khi đọc toàn cảnh, chưa phải nguyên nhân đã chứng minh. Parity loại
   trừ preprocessing drift; thêm hai kiểu LCD/keypad vẫn chưa sửa được generalization.

3. **54903199 còn `000501`? Có**, ở free-form và task-guided ASP.NET diagnostics.
   Leading zeros giữ nguyên. Hai crop kWh vẫn là bằng chứng tương quan, không
   phải hai xác minh độc lập. Probe geometry giữ floating-point aspect cho warp
   CTC48 làm mean giảm .8194→.7583, weakest character .5594→.4131. **REJECTED**;
   đã bỏ thay đổi crop đó, giữ correction cũ. Chưa xác minh billing decimal.

4. **74590 còn hoạt động? Có**, ảnh 136480278 qua cả hai diagnostic paths. Chưa
   dùng kết quả này để tuyên bố reader đạt ≥90% hoặc xác minh precision.

5. **Controls còn bị từ chối? Có**, 3/3 mới + 4/4 lịch sử, gồm counter `4`,
   blank/inactive và non-billing inputs. Single-digit hợp lệ vẫn được kiểm tra
   với consumption context; V/A/Hz/kW/kVA/calibration/phase/status/timer vẫn veto.
   Missing/corrupt/hash-mismatched ONNX và unknown fallback được chạy hồi quy.

6. **Profile Staff giảm fallback chưa?** Ca routing PP có kiểm soát ở mục 1 đã
   giảm fallback. Trên 5 ảnh task-guided thật, 2 draft strings được giữ và 3 ảnh
   fallback; 105 tiến tới numeric stage nhưng chưa phục hồi final reading.
   Không có thêm exact positive trên benchmark full-frame. Nhánh hiện có
   `?experimental=true&taskId=<guid>` lấy Kind/precision từ DB, bỏ qua query giả
   `kind=DigitalWater&decimalPlaces=0`. PostgreSQL + login/JWT thật xác nhận:
   khác Location/hết phân công trả 404 trước đọc ảnh; prior proposal 17.25,
   hash/version giữ nguyên; không hoàn tất task hoặc tạo MeterReading.
   Precision chỉ báo có sẵn, chưa đổi raw digits thành billing value.

7. **Classifier bốn loại cải thiện chưa? Chưa đủ để thay model.** Thêm đúng 2
   full-frame electricity LCD/keypad từ tác giả mới vào TRAIN provisional,
   tổng 40; không lặp training chỉ trên 38 ảnh cũ. Ba nguồn tìm lại trùng data
   cũ đã loại; một blank keypad mới giữ TEST. Threshold chọn bằng validation,
   không chỉnh theo test. Candidate ONNX `768d89b6…` thực sự chạy trong .NET:

   | Cohort classifier, nhãn provisional | Cũ correct/wrong/unknown | Candidate |
   | --- | --- | --- |
   | Validation 7 | 1/0/6 | 1/0/6 |
   | Historical test 9 | 1/1/7 | 2/1/6 |
   | Frozen source-author-separated probes 4 | 0/0/4 | 0/0/4 |

   Historical accepted precision 1/2→2/3; recall ME 1/2→1/2, DE 0/2→1/2,
   WM 0/2→0/2, WD 0/1→0/1. New probes: ME 0/1, DE 0/1; WM/WD không có positive,
   không tính recall; precision undefined vì không accepted prediction.
   Non-meter false acceptance đều 0/2. Không tăng validation coverage hoặc
   correct coverage trên nguồn tách mới: **REJECTED**, giữ `f7277b05…`.
   Author separation chưa chứng minh physical-device independence.

8. **Reader nào dùng được thực tế?** PP reader và mechanical-water Stage1/Stage2
   hiện có vẫn đưa proposal qua workflow cấu hình, với manual correction và
   Staff confirmation; chưa category nào mới được nghiệm thu lượt này. English
   digital-electricity chỉ dùng diagnostics. Water-mechanical row-margin probe
   chạy cùng 52 full photos: cả baseline/candidate 10/33 exact, 0 wrong trên
   complete labels, 0 proposal khi thiếu GT, 42/52 fallback; 0 changed values.
   **REJECTED**, không đăng ký DI. Không bỏ recognizer conflicts. ME rolling
   wheel `126151`/nhãn nháp `12615` còn unresolved; không tự cắt digit hoặc dùng
   water Stage2 cho electricity. Digital-water thiếu LCD thật readable đa thiết bị.

9. **Development bật model nào?** **DEVELOPMENT_DIAGNOSTICS_ENABLED** cho pinned
   CLIP cũ + PP detector + English CTC + PP Vietnamese, dưới guards Development,
   MobileDevelopment, Ocr và ExperimentalMeter; category list vẫn cấu hình riêng.
   Candidate classifier và water-margin probe chỉ **EXPERIMENTAL/REJECTED** offline.
   [Contract, query và rollback](../api/OCR_EXPERIMENTAL_DIAGNOSTICS.md).

10. **Staff proposals bật mới model nào? Không có.** Existing PP/Stage2 proposal
    workflow vẫn hoạt động theo config (**STAFF_PROPOSAL_ENABLED**, có từ trước).
    CLIP/English experimental promotion **BLOCKED_BY_DATA**; diagnostics luôn
    `businessProposalEnabled=false`. Không tạo feature commit activation giả,
    không cập nhật invoice từ OCR hoặc bật Production.

11. **Các blocker còn lại.** DE: category uncertainty, unit/register và precision;
    ME: wheel transitions/complete digits; WM: missing digits/conflicts và baseline
    thấp; WD: thiếu diverse readable LCD/total-m³ evidence. Full-frame replay so
    với candidate đã commit ở lượt trước, cùng 13 inputs/SHA, giữ riêng cohort:

    | Cohort | Exact strings cũ→nay | Wrong strings | Invalid rejected | Fallback cũ→nay |
    | --- | --- | --- | --- | --- |
    | Development 5, 2 draft positives | 1/2→1/2 | 0→0 | 3/3→3/3 | 4→4 |
    | Historical validation 2 | 1/1→1/1 | 0→0 | 1/1→1/1 | 1→1 |
    | Historical exploratory 4 | 0/3→0/3 | 0→0 | 1/1→1/1 | 4→4 |
    | Historical controls 2 | N/A | 0→0 | 2/2→2/2 | 2→2 |

    Category counts từng cohort cũng không đổi; không cộng các nhóm thành
    independent accuracy. Verified billing-value acceptance vẫn 0.

12. **Cần nhãn độc lập gì?** [Pilot 6](../datasets/meter/NEXT_STAFF_REVIEW_STATUS.md)
    gồm 3 potential positives + 3 controls, trong đó 2 blank/inactive; pilot8 cũ
    được giữ. Hai reviewer độc lập khi khả thi cần category/technology, numeric
    bbox, total register, complete digits/zeros, decimal, unit, readability,
    uncertain positions, physical-meter/source group. Gói blind local:
    `.tools/ocr-next-staff/review-v3/index.html`; không có model suggestions.
    Human-verified 0; 6 ảnh thiếu independent register/precision. Không approve
    toàn bộ 327 ảnh quarantine. Nguồn, giấy phép, SHA và aliases trong
    [catalog](../datasets/meter/next-staff-public-sources.json).

13. **Commits local.**

    | Commit | Short English description |
    | --- | --- |
    | `bb4e4e6` | Prepare focused blind review inputs and licensed source probes |
    | `9970911` | Route by trusted task profiles; preserve scope and mismatch safeguards |
    | `826303d` | Measure rejected classifier, unit geometry and water-row candidates |
    | Commit chứa report này | Record recognition results, executed checks and activation blockers |

    Full final HEAD/clean status được ghi sau reporting commit tại
    `.tools/ocr-next-staff-final-state.json`; history append vào
    `.tools/ocr-next-git-history.md`. Không push/merge/rebase/squash/deploy.

Chi tiết máy đọc được: [recognition results](ocr-next-staff-recognition-results.json)
và [verification receipts](ocr-next-staff-verification-results.json).
Release build 0 warnings/errors; Application **349**, OCR integration **155**,
PostgreSQL workflows **8**, Mobile OCR **50**, review-tool **9** — PASS, không skip.
Classifier parity9, English4, Stage2 parity10 PASS. Lượt OCR đầu 154 pass/1 timeout
ở ảnh xoay; chạy riêng ca đó và chạy lại toàn bộ tuần tự đều PASS, không đổi
deadline. Chưa chứng minh nguyên nhân timeout là concurrency. Lượt PG đầu lỗi
`ExecuteUpdate` trong test setup và lỗi thiếu import khi tách test đã được sửa;
receipt lưu cả failed attempts. Không coi retry đơn lẻ là full-suite success.
PG disposable đã dừng. MinIO thật
và camera thiết bị **NOT_RUN**: không thấy listener 9000/9001 hoặc adb; PostgreSQL
tests dùng storage substitute có khai báo. Không sửa Mobile source nên không
chạy lại typecheck/lint. Postman status chỉ kiểm tra môi trường, không phải
collection assertions hay publication.
