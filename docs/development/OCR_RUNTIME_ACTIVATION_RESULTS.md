# OCR runtime activation — 07/11/2026

Đã chạy classifier và reader ONNX thật trong endpoint ASP.NET Core Development.
**Chưa model mới nào đạt gate Staff proposal.** Positive coverage còn thấp;
không tuyên bố hoàn tất nhận dạng bốn loại hay đạt accuracy nghiệp vụ.

Branch `member/QHuy`; bắt đầu từ clean HEAD
`ee3dd1405ce4a57a96adf3186721e49feee0f89f`. Traceability: BF-05 / UC-20 / GBR-07
→ pixels, OCR diagnostic, Staff confirmation; UC-21 / JOB-10 / GBR-09 → invoice
chỉ nhận confirmed readings. Không thay schema, billing hay quyền nghiệp vụ.
Gates được ghi trước evaluation trong [activation gates](../datasets/meter/runtime-activation-gates.json).

| Trạng thái | Kết quả |
| --- | --- |
| `OFFLINE_EXPERIMENT` | Heads dùng PIL preprocessing ban đầu không có positive validation; không tích hợp bản đó |
| `DEVELOPMENT_DIAGNOSTICS_ENABLED` | Supervised CLIP + native PP detector + English CTC, explicit opt-in; reader bật riêng DigitalElectricity trong cấu hình đánh giá |
| `BUSINESS_PROPOSAL_ENABLED` | **Không có candidate mới**; không nối experimental result vào luồng Staff proposal |
| `REJECTED` | Promotion classifier/reader: còn wrong category và fallback cả hai positive mới |
| `BLOCKED_BY_DATA` | Human reviews 0; independent register/decimal GT 0; digital-water thiếu ảnh readable từ thiết bị thật |

1. **Model nhận đúng loại nào?** Validation 7 ảnh: water-mechanical đúng 1/1,
   electricity-mechanical 0/1, electricity-digital 0/1, bốn negatives bị từ chối.
   Trên test provisional 9 ảnh đã từng được khảo sát, kết quả như sau:

   | Nhãn nháp | Đúng | Sai | Unknown | Recall đúng |
   | --- | ---: | ---: | ---: | ---: |
   | Electricity mechanical | 1 | 0 | 1 | 1/2 |
   | Electricity digital | 0 | 0 | 2 | 0/2 |
   | Water mechanical | 0 | 0 | 2 | 0/2 |
   | Water digital, **illustration** | 0 | 1 | 0 | 0/1; không chứng minh thiết bị thật |
   | Non-meter | 0 accepted | 0 false accepted | 2 | 2/2 rejected |

   Ngoài tập 9 này, HTTP historical cohorts có hai category electricity-digital
   đúng (`136480278`, `141575682`). Không gộp các cohorts thành một accuracy.
   Confusion matrix/scores: [classifier results](ocr-runtime-classifier-results.json).

2. **Ảnh trước sai, nay đúng?** `18880869` trước unknown, nay đúng mechanical
   electricity. `38382735` trước nhầm electricity và `51969773` trước nhầm water
   meter, nay unknown. Chưa có ảnh trong tập 9 chuyển wrong category → correct
   category. Có regression: `166496308` trước đúng water-mechanical, nay unknown;
   illustration `15920280` nay nhầm water-mechanical. Qua HTTP, `136480278` trước
   unknown/no reading, nay đúng digital electricity và đọc `74590`.

3. **Còn nhận nhầm non-meter không?** Test 9 giảm từ 1/2 xuống 0/2 false accepted;
   validation cũng 0/4. Tuy nhiên raw argmax vẫn sai trên nắp/counter; chính
   uncertainty/category gates giữ unknown. Mẫu ít và nhãn provisional không đủ
   chứng minh generalization hay calibration xác suất.

   Candidate là frozen CLIP ViT-B/32 vision features + hai supervised linear
   heads utility/technology, không dùng OCR text, filename hoặc Meter metadata.
   TRAIN 38 ảnh, thêm bằng chứng hybrid wheels và hard negatives đã kiểm bằng mắt;
   loại historical evaluation/control IDs và source-author groups khỏi TRAIN.
   Các ảnh TRAIN và license/provenance ở
   [manifest](../datasets/meter/runtime-supervised-provisional.json). Validation
   chọn epoch50, thresholds utility .55 / technology .75, margins .1; không tune
   theo test. Test cũ không phải held-out độc lập mới. Những lỗi utility sát
   threshold, body giống nhau, hybrid wheels và water-digital illustration vẫn
   cho thấy frozen features/độ đa dạng chưa đủ; chưa có ablation để khẳng định
   hard negatives là nguyên nhân duy nhất làm giảm false acceptance.

4. **Chọn đúng billing register được chưa?** Chọn được **ứng viên**, chưa xác minh
   register nghiệp vụ. Selector yêu cầu unit đúng loại nằm gần numeric row; chặn
   timer/serial/voltage/frequency/flow và nhiều ứng viên mâu thuẫn. Calibration
   `1000 imp/kWh` không được xem như unit riêng. Không dùng số lớn nhất hay OCR
   confidence cao nhất để quyết định consumption. Decimal/register human review
   vẫn bắt buộc; `consumption_candidate` không có nghĩa đã được xác thực.

5. **Đọc đủ digits được không?** HTTP full-frame `136480278` trả `74590`, không
   mất/thêm ký tự theo label lịch sử. Context probe `105770219` đọc `16254`,
   `54903199` phục hồi `00050` → `000501` nhờ margin theo chiều cao row, giữ pixels
   thật và dừng trước text region cùng hàng. Nhưng runtime không phát hai reading
   mới này: ảnh đầu raw category guess sai; ảnh sau unit đọc `kvVh` (PP đọc `KVA`),
   chưa đủ bằng chứng. Không tự đổi unit hoặc `1.180` thành OBIS `1.8.0`.

   So sánh oracle ở báo cáo trước vẫn chỉ là historical: English/server numeric
   crops mới đúng 2/2; full-screen crop khác numeric crop. Lượt này giữ nguyên
   reader, không retrain CRNN/PARSeq/cell CNN. Mechanical-water Stage2 không đổi
   (historical full runtime 10/33 exact, 42/52 fallback); mechanical-electricity
   chưa có complete-digit gate, ca `126151` so với draft `12615` vẫn extra digit,
   không cắt hậu tố. Digital-water không có numeric result mới đủ điều kiện đo.

6. **Còn phát reading trên invalid display không?** Không thấy reading candidate
   trên các controls HTTP đã chạy: new 3/3, historical blank/control 4/4 rejected.
   Counter `151445788` từng phát `4` vì selector offline chọn numeric region mà
   chưa xét register: bbox `[890,703,49,55]` sau cap1600, English `4` confidence
   .9975924, PP cũng `4`. Ảnh/crops gốc ở manifest và
   `.tools/ocr-runtime-focus/context-v3/`; device label `HORAIRE` bbox
   `[650,165,276,177]`, confidence .9395302. HTTP hiện fallback ở category gate;
   probe register độc lập với category cũng trả `non_consumption` nhờ label này.
   Tests giữ consumption `0`, `4`, `8` có kWh, kể cả kiểm veto khi unit hợp lệ tồn
   tại cạnh timer/non-billing label. Không dùng digit-count shortcut.

   Active-ink gate dùng contrast/topology pixels, không cấm chuỗi `88888`.
   **Giới hạn:** nó kiểm text crop, chưa xác minh độc lập vùng LCD; serial text
   trên ảnh blank/blur vẫn có thể tạo `displayState=readable_candidate`. Unit/
   register gate đang chặn reading; không coi display state đó là bằng chứng
   màn hình consumption readable. Vì vậy readability acceptance vẫn fail.

7. **ONNX nào thực sự chạy trong ASP.NET?** Native PP-OCRv6 detection (SHA prefix
   `eb13b44b`), supervised CLIP classifier (`f7277b05`), English CTC reader
   (`b5f833df`). PP Vietnamese recognition (`767305d3`) vẫn được engine hiện có
   nạp và dùng ở baseline. Full SHA/model input/output ở
   [measured results](ocr-runtime-recognition-results.json).

   Classifier float32 `[1,3,224,224]` RGB cubic-letterbox, CLIP mean/std → utility
   `[1,3]` = electricity/water/not_meter, technology `[1,2]` = mechanical/digital.
   Loader kiểm SHA, dtype/shape và class/preprocessing metadata. Native PyTorch
   so với Python ORT trên final model: max logit delta `3.994e-6`; Python→.NET
   9 ảnh: input delta **0**, logit delta `2.295e-6`. English decoding/dictionary
   parity 4 crops và Stage2 parity 10 crops đều PASS. Không có constant graph
   thay model thật, không thêm Python production service.

8. **Model nào bật Development diagnostics?** Candidate trên chạy được qua
   `POST /api/v1/ocr/diagnostics/auto?experimental=true`. Phải có Development,
   MobileDevelopment, Ocr và ExperimentalMeter flags, Owner/Staff authentication,
   explicit request opt-in. Kết quả luôn experimental, businessProposalEnabled
   false, requiresConfirmation true; không có `proposedFields`/`meterProposal`,
   không persist. Defaults production vẫn tắt. Four categories điều khiển độc
   lập bằng allow-list; mechanical trả unsupported, không tự chuyển water reader
   sang electricity. [Contract/config/replay](../api/OCR_EXPERIMENTAL_DIAGNOSTICS.md).

   Đã chứng minh qua ASP.NET TestServer và production DI: positive `74590`,
   counter fallback, unknown nắp `51969773`, missing/hash-mismatched model trả
   unavailable không có reading. Test principal là synthetic; chưa phải live
   Kestrel JWT/Mobile-camera E2E. Model binary local trong `.tools`, không commit.
   Rollback: tắt ExperimentalMeter flag và restart; failed lazy loader cần restart
   sau khi thay/sửa model. Lời gọi không opt-in giữ contract cũ.

9. **Model nào được nhận làm ordinary Staff proposal?** Không candidate mới nào.
   Luồng OCR hiện hữu và server-owned Meter metadata không bị thay thế. Staff
   vẫn xác nhận/correct; invoice không nhận experimental reading.

10. **Loại nào còn blocked, vì sao?** Cả bốn chưa đạt business gate:
    mechanical electricity thiếu đủ-digit/transition evidence; digital electricity
    thiếu coverage/class confidence, unit/register và decimal verification;
    mechanical water giữ disagreement veto và chưa có improvement được chấp nhận;
    digital water chỉ có ba thumbnails TRAIN, không có independent readable photos.
    Human reviews vẫn **0**, không tạo reviewer giả. Pilot mù 8 ảnh hiện có:
    `.tools/ocr-continued/review/index.html`. Digital-water cần tối thiểu pilot
    **3 thiết bị thật khác nhau × 2 full-resolution readable frames**, kèm blank/
    status/flow controls, unit/register/decimal và hai người review độc lập. Đây là
    pilot kỹ thuật, không đủ thay target ≥90% trên ≥50 ảnh hoặc acceptance độc lập.

11. **Before/after đo được gì?** Cùng test classifier 9 ảnh:

    | Metric | Frozen hierarchy | Supervised candidate |
    | --- | ---: | ---: |
    | Correct accepted categories | 1 | 1 |
    | Incorrect accepted categories | 2 | 1 |
    | Unknown | 6 | 7 |
    | Accepted precision | 1/3 | 1/2 |
    | Non-meter false acceptance | 1/2 | 0/2 |

    Cùng 13 full-frame HTTP inputs, chia cohorts; baseline là automatic endpoint
    mặc định PP/text-router, không ép loại và không bật YOLO flags. Candidate là
    opt-in pipeline. Các cặp dưới đây là **baseline → candidate**:

    | Cohort | Type đúng / sai / unknown | Exact strings / positives | Wrong digits | Invalid rejected | Reading fallback |
    | --- | --- | --- | --- | --- | --- |
    | New provisional 5 | 0/0/5 → 0/0/5 | 0/2 → 0/2 | 0 → 0 | 3/3 → 3/3 | 5/5 → 5/5 |
    | Historical validation 2 | 0/0/2 → 1/0/1 | 0/1 → 1/1 | 0 → 0 | 1/1 → 1/1 | 2/2 → 1/2 |
    | Historical exploratory 4 | 0/0/4 → 1/0/3 | 0/3 → 0/3 | 0 → 0 | 1/1 → 1/1 | 4/4 → 4/4 |
    | Historical controls 2 | 0/0/2 → 0/0/2 | N/A | 0 → 0 | 2/2 → 2/2 | 2/2 → 2/2 |

    So với offline unguarded experiment trước trên cùng new5, raw positive digits
    từng 2/2, invalid numeric 1/3 (`4`), fallback 2/5. API mới loại invalid nhưng
    cũng giữ lại **0/2 consumption candidates** mới: gate positive retention
    **không đạt** dù decoder vẫn đọc đủ digits trong context probe. Không trình
    bày việc tăng fallback như accuracy improvement. Không có independent
    acceptance cohort mới; chỉ runtime integration và giảm vài observed errors
    được chứng minh.

    Checks đã chạy: Release build 0 warnings/errors; Application **337/337**;
    OCR integration **139/139**, PostgreSQL workflows **7/7** (evidence in memory),
    Mobile OCR **50/50**; real-model parity như mục7. Log hashes/commands tại
    [verification receipt](ocr-runtime-verification-results.json). PostgreSQL
    port55493 bind denied, retry owned cluster trên loopback15493 thành công và
    đã dừng. Physical camera và real MinIO **NOT RUN**; không có device session/
    listener local phù hợp. Không chạy lại Mobile typecheck/lint vì không sửa
    Mobile source. `postman status --json` PASS, repo uninitialized/unauthenticated;
    không init/publish, không tuyên bố đã chạy Postman assertions.

12. **Commits local và mô tả English?**

    | Commit | Description |
    | --- | --- |
    | `bcc96ac` | Require spatial consumption evidence in diagnostics |
    | `f264005` | Train supervised visual heads for runtime diagnostics |
    | `f325454` | Integrate real ONNX behind guarded ASP.NET diagnostics |
    | `07ee8b2` | Verify runtime accuracy, invalid controls and fallback |
    | Commit chứa report này | Record activation results and remaining blockers |

    Full final HEAD/clean-tree check sau reporting commit nằm ở
    `.tools/ocr-runtime-final-state.json`; chronological hashes ở
    `.tools/ocr-next-git-history.md`. Không push/merge/rebase/squash/deploy, không
    tạo commit enable accepted proposals khi gates chưa đạt.
