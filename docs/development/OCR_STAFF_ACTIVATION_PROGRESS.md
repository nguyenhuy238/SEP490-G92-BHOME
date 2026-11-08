# OCR Staff activation progress — 07/11/2026

**Đã phục hồi `54903199` → `000501` trong diagnostics; `105770219` chưa phục hồi.
Không bật model mới cho Staff proposals.** Đây là exact diagnostic candidate theo
nhãn nháp, chưa phải giá trị consumption/decimal đã được xác minh độc lập.

Bắt đầu trên `member/QHuy`, clean HEAD
`f740ba3130c552da672ebee734ae5348259e7f4d`. Phạm vi BF-05 / UC-20 / GBR-07;
UC-21 / JOB-10 / GBR-09 tiếp tục yêu cầu confirmed readings. Đã đọc UC-20/21 trong
bản SRS local và các service/tests hiện có. Không đổi billing, schema hoặc quyền.

| Status                            | Kết quả                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `DEVELOPMENT_DIAGNOSTICS_ENABLED` | Endpoint opt-in hiện có chạy unit refinement bằng ONNX thật                         |
| `STAFF_PROPOSAL_ENABLED`          | **Không category mới nào**; luồng Staff hiện hữu giữ nguyên                         |
| `EXPERIMENTAL`                    | Candidate `000501`, vẫn unknown category và cần review unit/register/decimal        |
| `REJECTED`                        | Limited fine-tune, keypad-domain heads và contrast view không đạt gate classifier   |
| `BLOCKED_BY_DATA`                 | Human reviews 0, independent verified reading labels 0; digital-water thiếu dữ liệu |

1. **Image-based classification có cải thiện không?** Chưa. Limited unfreeze
   last vision block + balanced augmentation làm tăng false acceptance validation
   ở checkpoints đã train; validation chọn lại epoch0. Sau kiểm bằng mắt 38 ảnh
   TRAIN, thêm 3 crops LCD/keypad từ **một** licensed capture group, frozen-head
   training vẫn validation đúng1/7; test9 unknown9/9. Contrast view cũng chỉ đúng
   1/7 validation. Không tích hợp các bản này, không hạ threshold để nhận ảnh lỗi.
   [Scores, logits và experiment results](ocr-staff-classification-results.json).

2. **Nhận được những loại nào?** Runtime giữ classifier cũ, SHA `f7277b05…`.
   Trên cùng 9 provisional probes đã khảo sát, kết quả không đổi:

   | Category nháp               | Đúng | Sai | Unknown | Recall | Precision theo predicted class |
   | --------------------------- | ---: | --: | ------: | -----: | -----------------------------: |
   | Electricity mechanical      |    1 |   0 |       1 |    1/2 |                            1/1 |
   | Electricity digital         |    0 |   0 |       2 |    0/2 |                            N/A |
   | Water mechanical            |    0 |   0 |       2 |    0/2 |                            0/1 |
   | Water digital, illustration |    0 |   1 |       0 |    0/1 |                            N/A |

   Illustration water-digital bị nhận thành water-mechanical; không coi là ảnh
   thiết bị thật. Overall accepted precision1/2; non-meter false acceptance0/2.
   Historical HTTP còn nhận đúng hai digital-electricity images. Không gộp thành
   independent accuracy; chưa chứng minh nhận dạng tốt cả bốn loại.

3. **Hai positive lỗi đã được phục hồi?**
   - `105770219`: **chưa**. Utility electricity .5653, technology mechanical
     .6486 / digital .3514; final unknown tại thresholds .55/.75. Sai argmax
     technology, không phải chỉ thiếu confidence. OCR đọc được `16254` trong probe,
     nhưng category và unit/register vẫn chưa đủ bằng chứng. Không đổi type theo
     expected label hay sửa Meter metadata.
   - `54903199`: **có candidate `000501` qua ASP.NET**. Axis-aligned unit crop
     đọc `kvVh`; dùng lại quadrilateral crop sẵn có đọc `kwh` (.8297). Warp trực
     tiếp đến CTC48 đọc `kwh` (.8194), tránh resize nối tiếp trên glyph nhỏ.
     Hai view phải khớp unit đầy đủ, mean≥.8, min-character≥.5. Không fuzzy đổi
     KVA/kW/V thành kWh. **W vẫn yếu**: minimum .5790/.5594; PP vẫn đọc KVA.
     Hai view có tương quan, không phải xác minh độc lập. Vì vậy thêm warnings
     `unit_crop_rectified`, `unit_requires_human_review`, không cho Staff proposal.

   Selector cũng loại numeric row cạnh L1/L2/L3/status/phase, tránh lấy `1.180`
   thay numeric register chính. Không biến `1.180` thành OBIS; decimal hợp lệ
   `1.180` có unit và không có status evidence vẫn được giữ. Bbox, raw strings và
   từng response: [runtime results](ocr-staff-runtime-results.json).

4. **`74590` còn đúng không?** Có, cả baseline và candidate trên cùng full-frame
   `136480278` trả `74590`; test hiện assert riêng giá trị này. Leading zeros
   trong `000501` được giữ, không chèn/cắt digits hoặc suy đoán decimal precision.

5. **Invalid numeric controls còn bị từ chối?** Có: new controls3/3 và historical
   controls4/4, không phát thêm reading candidate. Counter từng đọc `4` vẫn
   fallback; blank/inactive cũng không có reading. Tests giữ consumption một chữ
   số `0`, `4`, `8` có unit; bảo vệ kW/kVA/V/A/Hz/m³/h/L/min/serial/calibration và
   status-only rows. Fallback có numeric text nay báo
   `numeric_text_present_display_unverified`, không gọi serial text là LCD readable.

6. **ONNX nào chạy trong ASP.NET?** Classifier supervised CLIP (`f7277b05…`),
   PP-OCRv6 detector (`eb13b44b…`), English CTC (`b5f833df…`); PP Vietnamese
   recognizer (`767305d3…`) vẫn thuộc engine hiện có. Không thêm architecture,
   Python service hay endpoint. Real HTTP inference dùng ASP.NET TestServer,
   production DI và test principal; không phải live phone/JWT/camera E2E.

7. **Category-specific model nào được bật cho Staff?** **Không có model mới.**
   Classifier chưa đạt coverage/error gate; unit mới chỉ là correlated diagnostic
   evidence, register/decimal chưa được xác minh. Trusted Meter profile vẫn là
   nguồn sự thật, không bị visual guess override. Không auto-confirm hoặc tạo
   invoice từ experimental result. Existing per-category allow-list giữ nguyên.

8. **Category nào còn fallback, vì sao?** Digital electricity phục hồi một
   diagnostic case, nhưng ảnh A và nhiều historical positives vẫn fallback.
   Mechanical electricity thiếu complete-digit/transition evidence; mechanical
   water chưa có improvement benchmark mới (historical10/33 exact,42/52 fallback
   không được tính thành kết quả lượt này). Hai mechanical readers experimental
   vẫn unsupported; không chuyển water Stage2 sang electricity. Digital water
   thiếu readable physical-device evaluation và register/decimal GT. Pilot review
   8 ảnh vẫn có sẵn; không tạo reviewer/labels độc lập giả.

9. **Before/after nhận dạng?** Cùng endpoint experimental, cùng model, cùng 13
   inputs có SHA; baseline tắt `RefineUnitCrops`, candidate bật. Baseline digits
   khớp receipt đã commit trước. New provisional cohort5:

   | Metric                                      | Baseline | Candidate | Delta |
   | ------------------------------------------- | -------: | --------: | ----: |
   | Correct accepted categories                 |        0 |         0 |     0 |
   | Incorrect categories                        |        0 |         0 |     0 |
   | Unknown categories                          |        5 |         5 |     0 |
   | Exact reading candidates /2 draft positives |        0 |         1 |    +1 |
   | Incorrect numeric candidates                |        0 |         0 |     0 |
   | Invalid controls rejected /3                |        3 |         3 |     0 |
   | Reading fallback /5                         |        5 |         4 |    −1 |

   | Cohort khác, giữ riêng  | Exact strings baseline→candidate | Invalid rejected | Fallback |
   | ----------------------- | -------------------------------- | ---------------- | -------- |
   | Historical validation2  | 1/1→1/1                          | 1/1→1/1          | 1/2→1/2  |
   | Historical exploratory4 | 0/3→0/3                          | 1/1→1/1          | 4/4→4/4  |
   | Historical controls2    | N/A                              | 2/2→2/2          | 2/2→2/2  |

   Numeric improvement chỉ ở digital electricity; exploratory water-digital vẫn
   0/1 draft-positive, không có mechanical numeric inputs mới trong benchmark13.
   New source-separated evaluation và independent human acceptance: **NOT RUN**;
   3 crops mới chỉ là TRAIN. Không biến development fixes thành held-out claims.

10. **Commits local?**

    | Commit                 | Short English description                                      |
    | ---------------------- | -------------------------------------------------------------- |
    | `feb6d56`              | Evaluate targeted visual adaptations; reject failed candidates |
    | `5104901`              | Recover unit evidence and reject adjacent phase/status numbers |
    | Commit chứa report này | Record targeted runtime results and Staff blockers             |

    Sau reporting commit, full HEAD/clean status ở `.tools/ocr-staff-final-state.json`;
    history được append vào `.tools/ocr-next-git-history.md`. Không push/merge/
    rebase/squash/deploy, không có commit enable proposals khi gates chưa đạt.

Verification thực sự đã chạy: Release build 0 warnings/errors; Application343,
OCR integration150, PostgreSQL workflows7, Mobile OCR50 — tất cả PASS, không skip.
PG tests kiểm metadata/Location authorization, Staff correction/confirmation và
confirmed-reading invoice safeguard bằng DB disposable, storage in memory; đã
dừng PG sau test. Classifier .NET parity9 (input delta0, logits≤2.3e-6), English
parity4 và Stage2 parity10 PASS. [Commands/log hashes](ocr-staff-verification-results.json).
Physical camera/real MinIO **NOT RUN**; không có device session/listener phù hợp.
Không sửa Mobile source nên không chạy lại typecheck/lint. Postman chỉ chạy
read-only status, không init/publish hoặc tuyên bố chạy collection assertions.

Replay/rollback: [API contract/config](../api/OCR_EXPERIMENTAL_DIAGNOSTICS.md).
Experimental luôn yêu cầu opt-in + Development guards, businessProposalEnabled
false, Staff confirmation true; tắt `RefineUnitCrops` và restart để bỏ correction,
hoặc tắt toàn bộ ExperimentalMeter. Không có migration hay model binary trong Git.
