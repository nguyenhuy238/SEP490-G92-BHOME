> Quy?t ??nh 04/11/2026: b? Chain/RoomType; SQL hi?n h?nh c? 24 b?ng / 383 c?t / 83 FK. Thi?t k? API m?i ? [LOCATION_ROOM_API.md](../../../api/LOCATION_ROOM_API.md); m? t? catalog c? b?n d??i ???c gi? ?? truy v?t.

# Thiết kế database BHOME với 24 bảng

## 1 Kết luận và phạm vi áp dụng

Theo yêu cầu điều chỉnh của người dùng ngày 03/11/2026, **lấy đúng 24 bảng trong tài liệu Word làm thiết kế mục tiêu, không bổ sung bảng nghiệp vụ thứ 25**. Backend cần điều chỉnh cách lưu dữ liệu theo thiết kế này. Không giữ 70 bảng chỉ để tránh sửa persistence.

File [BHOME_24_TABLES.sql](BHOME_24_TABLES.sql) tạo được một database mới có đúng 24 bảng vật lý. [BHOME_24_TABLES.dbml](BHOME_24_TABLES.dbml) là sơ đồ của chính SQL đó. Đã kiểm dựng mới trên PostgreSQL 16.15 và 18.6, cùng 28 assertions với dữ liệu tổng hợp. **Backend đã có persistence Compact24 mặc định và kiểm thử độc lập trên database mới chỉ gồm 24 bảng.** SQL này tạo schema trống; công cụ offline riêng chuyển dữ liệu 70→24. Database phát triển `bhome` đã được tạo mới theo yêu cầu setup 04/11/2026, toàn bộ dữ liệu cũ giữ trong archive; xem [báo cáo triển khai](IMPLEMENTATION_REPORT.md) và [đối soát đã chạy](MIGRATION_RECONCILIATION.json).

Giữ UUID và các định danh hiện tại để giảm việc đổi ID/API/file reference. Compact24 hiện tại có đúng 24 bảng vật lý, không tạo `__EFMigrationsHistory`. Khởi tạo offline bằng DDL phiên bản `compact24-2026-11-04`; readiness kiểm cấu trúc và guard thực tế. Chuỗi EF migrations/snapshot cũ chỉ dùng đọc bản sao nguồn và regression, không chạy lên schema Compact24 và không tạo migration history giả. Nếu sau này cần bảng lịch sử kỹ thuật, phải công khai thay đổi số bảng.

Tài liệu Word được ưu tiên về danh mục bảng; các quyết định nghiệp vụ mới hơn đã ghi nhận trong repo vẫn được giữ để thiết kế không làm mất chức năng đã phát triển. Các policy chưa được duyệt chỉ được ghi nhận là điểm cần chốt, không tự động bật bằng SQL.

Đã kiểm thêm JSON người dùng cung cấp tại `C:/Users/Admin/Downloads/BHOME_Database_Design.json`. Người dùng đã chọn **giữ 24 bảng và giữ các cơ chế bảo vệ hiện tại, bổ sung/gộp các trường cần thiết vào JSON**. Bản đồng bộ [BHOME_Database_Design.json](BHOME_Database_Design.json) giữ định dạng phiên bản 32.6.9 và ID của 24 ô bảng gốc; chi tiết đối chiếu ở mục 11. Không coi JSON nguồn là phê duyệt bỏ cơ chế xác thực, lịch sử, audit hoặc dữ liệu cọc.

## 2 Danh mục giữ nguyên 24 bảng của bản Word

| STT | Bảng                | Mục đích chính                                                 | Phần được gộp để không tạo bảng thêm                                                   |
| --- | ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | users               | Tài khoản, role cố định, password hash, lockout/security stamp | Reset grant, cấu hình Chain chung, chứng thư ký metadata                               |
| 2   | refresh_tokens      | Session và refresh rotation                                    | Hai loại dòng SESSION/TOKEN trong một bảng                                             |
| 3   | staff_employments   | Hồ sơ lao động/chi phí Staff nếu được sử dụng                  | Chính sách có cấu trúc; không tạo payroll/reward/penalty tables                        |
| 4   | locations           | Cơ sở và cấu hình vận hành                                     | Phân công Staff có hiệu lực, Room Types, lịch billing, automation, tài khoản nhận tiền |
| 5   | rooms               | Phòng, sức chứa, trạng thái và nội dung public                 | Snapshot public; không có RoomImages/Amenities riêng                                   |
| 6   | assets              | Tài sản phòng hoặc khu vực chung                               | Purchase metadata và lịch sử tình trạng/bảo trì                                        |
| 7   | residents           | Hồ sơ occupant, identity envelope/HMAC được bảo vệ             | Giữ scope mã hóa cũ, không lưu ảnh CCCD                                                |
| 8   | contracts           | Main/Renewal/Holding/Addendum                                  | File metadata, biên bản bàn giao, kiểm tra cuối, trả phòng, settlement và history      |
| 9   | contract_signings   | Từng request ký và bằng chứng provider                         | Certificate snapshot và dữ liệu chuẩn bị/kết quả ký                                    |
| 10  | contract_residents  | Người ở theo hợp đồng và đợt cư trú                            | Theo dõi kết quả VNeID ngoài hệ thống trên từng occupant                               |
| 11  | incident_reports    | Sự cố, emergency và quyết định Owner                           | Evidence, first response và history                                                    |
| 12  | operational_tasks   | Đầu việc vận hành và Work Order                                | Lịch ca nếu giữ UC-09, job queue, execution/attempt, command receipt, upload staging   |
| 13  | meters              | Thiết bị điện/nước                                             | Liên kết thay thế và lịch sử, không có MeterHistory riêng                              |
| 14  | meter_readings      | Chỉ số Staff xác nhận                                          | OCR proposal và ảnh evidence metadata trên cùng reading                                |
| 15  | billing_policies    | Đơn giá có hiệu lực                                            | Parameters/snapshot liên quan; không thêm bảng phiên bản policy                        |
| 16  | invoices            | Hóa đơn và snapshot quyền xem                                  | Recipients, schedule snapshot, payment request/QR history                              |
| 17  | invoice_items       | Chi tiết và căn cứ tính tiền                                   | Rate/reading/calculation snapshot của từng dòng                                        |
| 18  | invoice_adjustments | Yêu cầu và quyết định điều chỉnh                               | Request/decision snapshots, evidence và history                                        |
| 19  | payments            | Giao dịch ngân hàng chuẩn hóa và xác minh                      | Deposit receipt, reference claim/effect key, reconciliation history                    |
| 20  | payment_allocations | Sổ phân bổ nguồn/đích, chuyển cọc và reversal                  | Không tạo DepositLedger/SecurityDeposits/ExcessBalances riêng                          |
| 21  | refund_requests     | Yêu cầu, duyệt và thực hoàn                                    | Decision/evidence/history trên cùng request                                            |
| 22  | expenses            | Vốn đầu tư và chi phí thực tế                                  | Phân biệt bằng expense_type, không có Investments/OPEX/MaintenanceCost riêng           |
| 23  | financial_scenarios | Kịch bản What-if đã lưu                                        | Assumptions/baseline/results trong cùng dòng                                           |
| 24  | notifications       | Inbox, outbox thông báo và sự kiện audit                       | Delivery attempts, publication dedupe; AUDIT là dòng riêng không lẫn inbox             |

`staff_employments`, `financial_scenarios` có thể chưa có dữ liệu cho tới khi feature được chốt; vẫn giữ tên trong danh mục Word. Không thêm bảng để thay thế chúng. Không tự triển khai payroll chỉ vì schema có cột salary.

## 3 Những điều chỉnh cần làm trên bản Word

### 3.1 Điều chỉnh cần thiết để giữ chức năng hiện tại

| Nội dung                                             | Điều chỉnh trong bản 24 bảng                                                           | Lý do                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| BIGINT toàn hệ thống                                 | Giữ UUID của entity đang dùng Guid                                                     | Tránh đổi toàn bộ ID, DTO, object reference và bằng chứng ký                        |
| users chỉ có password_hash/role                      | Thêm security stamp, normalization, lockout; role là mảng các role cố định đang hỗ trợ | Không làm mất lockout, role hiện có hoặc vô hiệu hóa JWT/session checks             |
| refresh chỉ có user/token/expiry                     | Gộp session header và token row bằng record_kind + self FK                             | Giữ absolute lifetime, logout-all, replay/reuse detection mà không thêm Sessions    |
| Bỏ Chain                                             | Cấu hình Chain duy nhất trong users.business_profile của Owner, giữ chainId cũ         | Vẫn phục vụ API đổi tên Chain hiện có, không cần bảng Chains                        |
| Bỏ RoomTypes                                         | Catalog nhỏ có id ổn định trong locations.room_types                                   | Vẫn có RoomType CRUD/pricing scope; không biến loại phòng thành tên text dễ đổi sai |
| Bỏ phân công có ngày                                 | staff_assignments JSONB trong Location                                                 | Giữ quyền Staff theo ngày hiện có, không cần bảng assignment riêng                  |
| Hóa đơn theo Contract + kỳ                           | Giữ một PERIODIC Invoice theo Room + kỳ                                                | Theo quyết định 01/11 tại BH21_TRACEABILITY.md; không quay lại mô hình cũ           |
| Không rõ payer/viewer                                | recipient_user_ids là snapshot; paid_by_user_id ở allocation                           | Người trả thực tế khác người được xem/người đại diện; người mới không xem kỳ cũ     |
| DRAWN_OTP/UPLOAD_PROOF                               | Dữ liệu ký chỉ dùng external provider và certificate evidence                          | Theo GBR-04 và luồng MySign đã có, không thay chữ ký bằng ảnh/OTP                   |
| Task chỉ có workflow chung                           | task_type phân biệt Work Order, Staff shift, job và command                            | Không tạo thêm WorkOrders/Shifts/Jobs/Commands tables                               |
| Bỏ audit                                             | AUDIT rows trong notifications, append-only                                            | Giữ DBR-13 và audit hiện tại, không cần bảng audit_logs                             |
| Không có retry/history                               | JSON history có schema và các cột lease/next-run cần query                             | Giữ crash recovery/idempotency, không nhân bảng attempts/history                    |
| invoice_items nói có policy_snapshot nhưng thiếu cột | calculation_snapshot trên item, billing_snapshot trên invoice                          | Giữ toàn bộ thông tin đủ tái lập phép tính và thông tin hiệu lực                    |
| Thiếu actor quyết định/đối tượng hưởng               | Giữ FK actor/time và beneficiary ở adjustments/payments/refunds                        | Không mất trách nhiệm phê duyệt và quyền lợi người nhận tiền                        |

### 3.2 Không thêm cột chỉ để dự phòng

Không tạo các cột balance/revenue/debt/profit/payback ở mọi bảng. Chúng là kết quả query từ verified payment, allocation, approved adjustment, chi phí và occupancy theo thời gian. Không thêm lookup tables cho vài giá trị enum cố định. Không có Contact/Guest/Booking tables, bảng ảnh CCCD, private signing key hoặc bảng chia tiền tự động.

Không thêm created_at/updated_at vào tất cả bảng. Giữ các thời điểm có ý nghĩa cụ thể: requested_at, verified_at, confirmed_at, allocated_at, event_at, calculated_at, issued_at, activated_at, actual residence dates. Các timestamps cũ cần giữ khi chuyển đổi được đưa vào import/history metadata có nguồn, không xóa âm thầm. Không dùng thời gian import làm ngày ký/thu tiền cũ.

## 4 Mục đích các trường gộp và cấu trúc bắt buộc

JSONB chỉ được dùng với cấu trúc xác định, không phải chỗ đổ toàn bộ object tùy ý. Các quan hệ chính và dữ liệu phải query thường xuyên vẫn là cột/FK. SQL hiện kiểm kiểu object/array và một số giới hạn; validation chi tiết và giao dịch nghiệp vụ phải được bổ sung trong backend chuyển đổi.

| Trường hoặc nhóm trường                                                 | Nội dung cần lưu                                                                                                                             | Kiểm soát khi triển khai                                                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| users.security_stamp, concurrency_stamp, access_failed_count, lockout_* | Trạng thái xác thực hiện tại                                                                                                                 | Giữ hash ASP.NET Identity, stamp rotation, optimistic concurrency, lockout policy đã cấu hình                                                       |
| users.reset_token_hash/reset_expires_at/reset_consumed_at               | Một reset grant hiện hành cho một user                                                                                                       | Chỉ hash token; one-time use dưới user lock; không ghi raw reset token                                                                              |
| users.roles                                                             | Các role Owner/Staff/Tenant hiện có                                                                                                          | Đọc từ server, không từ request; permission matrix vẫn ở code; unique Owner chưa thay được bootstrap                                                |
| users.business_profile                                                  | schemaVersion, chain id/name/version/history; brand và cấu hình toàn hệ thống cần thiết                                                      | Chỉ Owner; giữ ID Chain cũ. Không lưu secret/provider credential ở đây                                                                              |
| users.signing_credentials                                               | id chứng thư cũ, provider, credential/subscriber reference, certificate metadata, trạng thái khóa/expiry, binding evidence reference         | Không private key; không đưa ra DTO Staff/Tenant khác; snapshot lúc ký để không phụ thuộc cert hiện tại                                             |
| refresh_tokens.record_kind/session_id/security_stamp/expires_at         | SESSION là header; TOKEN trỏ header, có hash/rotation riêng                                                                                  | Khóa user và session khi refresh/revoke; không xóa token đã consumed trước khi hết cửa sổ cần phát hiện reuse                                       |
| locations.staff_assignments                                             | [{id, staffUserId, startDate, endDate, actorId, recordedAt}], ngày inclusive như code hiện tại                                               | Một Location không chồng khoảng phân công; service khóa Location, validate role và ngày trước lưu; SQL chưa tự FK/EXCLUDE từng phần tử JSON         |
| locations.room_types                                                    | [{id, name, description, capacity, areaM2, amenities, isActive, version, history}]                                                           | Giữ UUID RoomType; validate rooms/billing_policies tham chiếu trước xóa/đổi; JSON không có FK tự động                                               |
| locations.operating_settings                                            | schemaVersion, contractSettings, billingSchedule, automationPlanVersions, receivingBankAccountVersions, recurringTaskDefinitions nếu đã chốt | Lưu version/hiệu lực/actor; không tự đặt ngày thu/phí hoặc nhét secret; tính invoice snapshot trong cùng Location lock                              |
| rooms.public_profile, locations.public_profile                          | Nội dung public được Owner duyệt, ảnh public hợp lệ, amenities/indicative price/static contact                                               | Public DTO theo allowlist; không serialize entity, PII, private object keys hoặc bank config                                                        |
| rooms.billing_representatives                                           | [{id, billingPeriod, version, representativeContractId, chosenByUserId, chosenAt, reason}]                                                   | Giữ lựa chọn đại diện trước khi có hóa đơn; append-only, chọn version hợp lệ dưới Room lock và chụp vào billing_snapshot khi phát hành              |
| assets.purchase_info/history                                            | Thông tin mua nếu cần và các lần đổi condition/maintenance                                                                                   | Không tạo bản chi phí kép; chi phí thực trong expenses có source_key                                                                                |
| residents.identity_data                                                 | Encrypted envelope hiện có gồm cipher/nonce/tag/key version                                                                                  | Giữ nguyên resident UUID và identity_owner_scope_id cho AAD; không tự đổi thuật toán/khóa; identity images chỉ xử lý transient                      |
| contracts.documents                                                     | [{id, kind, templateId, version, objectKey, hash, mime, size, uploadedBy, uploadedAt}]                                                       | Giữ hash/key/ID và quyền tải; không nhận PDF client thay snapshot điều khoản server                                                                 |
| contracts.handover                                                      | schemaVersion, currentVersion, room/assets/readings/access snapshot, Staff/Tenant confirmations và evidence references                       | Mỗi confirmation gắn version; version cũ nằm trong history; sửa biên bản phải vô hiệu confirmation cũ                                               |
| contracts.move_out, contracts.settlement                                | Request/approval/inspection/final readings/baseline và settlement reviews/financial snapshot/ledger references                               | Không đóng contract/phòng khi nghĩa vụ bắt buộc chưa xong; snapshot không thay ledger                                                               |
| contracts.history                                                       | Các version, thao tác/reason/actor/time và safe references; giữ IDs handover/inspection/review cũ khi import                                 | Array append-only ở DB; thay đổi parent và history cùng transaction/version                                                                         |
| contract_signings.certificate_snapshot/signing_data                     | Chuỗi cert public, provider/credential, prepared digest/field name, source/prepared hashes, provider request metadata và signing evidence    | Không private key hoặc provider secret; không ghi đè file/hash đã ký                                                                                |
| contract_residents.registration_* và actual_*                           | Trạng thái/kết quả tạm trú theo từng occupant và actual residence start                                                                      | Tenant ngoài VNeID, Owner xác nhận; không cấp Staff quyền nộp/duyệt; chốt JOB-08/retention trước bật                                                |
| incident_reports.emergency_actions                                      | entryId, actorId, occurredAt, action, safe evidence references                                                                               | Append-only ở DB; Owner/Staff scope được kiểm ở server; không dùng để tự duyệt chi phí                                                              |
| operational_tasks.task_data cho việc Staff/Work Order                   | Form có schemaVersion, submission/evidence selections, proposed plan, result và legacy meter details                                         | Các giá trị cost/approve actor/time cần query giữ cột chuẩn; không nhận trạng thái/tiền do UI tự tính                                               |
| operational_tasks.task_data cho SYSTEM_JOB                              | jobName, input refs, execution key/plan/kỳ/phase, safe result/error và attempt summaries                                                     | Queue bền vững, lease theo token; source_key ổn định; job được tạo trong transaction nghiệp vụ                                                      |
| operational_tasks.task_data cho COMMAND                                 | actorId, operation, idempotencyKey, fingerprint, resultId/response được phép replay                                                          | Unique source_key theo module+actor+operation+key; receipt và domain effect commit cùng nhau; payload khác phải 409                                 |
| operational_tasks.evidence                                              | id, objectKey, MIME, size, hash, uploadedBy/At, submissionId, linked/cleanupAfter                                                            | Metadata upload staging giữ khi business transaction rollback; cleanup worker giữ lease và recheck referenced keys                                  |
| operational_tasks.starts_at/ends_at cho STAFF_SHIFT                     | Lịch ca hiện hành; mỗi lần đổi có version và snapshot trong history                                                                          | Không coi task deadline là ca làm. Staff chỉ đọc lịch mình; không triển khai shift swap                                                             |
| meters.previous_meter_id/removed_on                                     | Thiết bị thay thế và ngày tháo                                                                                                               | Khóa Room khi đổi active meter, giữ readings cũ; không tự ước tính chỉ số qua meter mới                                                             |
| meter_readings.evidence                                                 | id ảnh cũ, objectKey, hash, MIME, size, uploader, OCR engine/version nếu có                                                                  | Phân biệt ảnh meter với ảnh CCCD; OCR proposed khác confirmed value; file vẫn private                                                               |
| invoices.recipient_user_ids                                             | Danh sách user đã được snapshot quyền xem kỳ đó                                                                                              | Validate User/Tenant tại server; array không có FK từng phần tử; không thay bằng occupants hiện tại                                                 |
| invoices.billing_snapshot/payment_requests                              | Tên Room/Location tại kỳ, đại diện, effective schedule/plan/rate date/rounding/missing data; lịch sử mã QR/payment code                      | Final bất biến; request/code có source key riêng nếu cần; không suy success từ QR/client                                                            |
| invoice_items.calculation_snapshot                                      | Policy version/rateDate/occupiedDays/periodDays, previous/confirmed usage, correctionRequestId và amount trước chỉnh                         | Tái lập tính tiền; không sửa item sau Final                                                                                                         |
| invoice_adjustments.request_snapshot/decision_snapshot/history          | Request ID, invoice/line state lúc yêu cầu, decision ID/actor/time/before/after/delta và evidence                                            | Merge đúng request với decision, không mất decision ID; không sửa Final base_total_amount                                                           |
| payments.effect_key/verification_data/history                           | Canonical claim chống ghi tiền hai lần; evidence verification và từng reconciliation decision                                                | Namespace khóa theo dữ liệu bank đã xác minh; migration phải giữ claim cũ, không tự xác nhận payment PENDING                                        |
| payment_allocations source/target FK và reversal                        | Một nguồn payment/deposit, một đích invoice/deposit; allocation time/actor; reversal exact                                                   | SQL kiểm verified bank source/XOR/reversal/append-only; budget, refund reservation và policy allocation phải kiểm dưới transaction trước triển khai |
| refund_requests decision/execution fields/history                       | Ai duyệt, người hưởng, thực chuyển, reference/evidence ngoài hệ thống                                                                        | Không coi request/approval là đã hoàn; không auto deadline/deductions/credit khi chưa chốt                                                          |
| expenses.expense_type/source_key/evidence                               | Initial investment hoặc OPEX; nguồn khoản chi dedupe và chứng từ                                                                             | Chi phí Work Order/Owner direct chỉ ghi một lần; Tenant deposit không mặc nhiên là revenue                                                          |
| financial_scenarios snapshots                                           | Assumptions/baseline/cutoff/result và calculationVersion                                                                                     | What-if không ghi ngược dữ liệu thực; không copy PII vào baseline                                                                                   |
| notifications.record_kind/event_data/delivery_history                   | INBOX là thông báo user; OUTBOX là intent; AUDIT là actor/action/reason/safe refs/occurredAt                                                 | API inbox chỉ chọn INBOX+recipient; AUDIT bất biến; retry không thay event payload và không làm mất inbox                                           |

Các record kỹ thuật COMMAND/SYSTEM_JOB/AUDIT không được tính vào số task Staff hoặc trả qua API danh sách công việc/thông báo thông thường. Phải lọc loại ở repository, không chỉ ẩn trên giao diện. Mỗi loại có DTO riêng; không trả trực tiếp task_data/event_data theo entity.

### Đánh đổi cần hiểu khi giảm bảng

Ít bảng hơn làm tăng trách nhiệm của service: FK tới phần tử JSON/array, overlap assignment, catalog RoomType và append snapshot version phải được kiểm dưới row lock. Không thể thay FK/transaction bằng lời ghi chú “validate JSON” rồi bỏ kiểm thử. JSON history lớn làm update row tốn hơn; phù hợp quy mô nhỏ được nêu trong Word, cần đo kích thước/query và retention được duyệt, không tự prune chứng cứ.

Nếu một cấu trúc sau này quá lớn, team có thể quyết định tách bảng bằng bằng chứng tải/thao tác thực tế. **Không tạo sẵn các bảng tách ngay trong thiết kế này.** Không dùng MongoDB/cache/file ngoài như một database thứ hai để che số bảng.

## 5 Luồng dữ liệu giữ được trong mô hình 24 bảng

### Auth và quyền

Giữ ASP.NET Identity PasswordHasher/UserManager behavior, JWT contract, normalized email login, lockout/stamp và fixed role policies. Để bỏ bảy bảng Identity vật lý, cần custom EF/store mapping cho UserManager vào users và lấy roles từ users.roles. `IdentityDbContext` hiện tại phải thay persistence boundary; chỉ gọi ToTable("users") không loại được những bảng Identity còn lại.

IdentitySecurityStore/SessionService/PasswordService hiện query AspNetUsers/UserRoles/AuthenticationSessions, vì vậy phải sửa toàn bộ các query/locks và thêm regression. Không viết thuật toán hash mật khẩu riêng, không downgrade password hash, không cấp role từ body/JWT không được revalidate. OAuth/claims/token store ngoài MVP nếu có dữ liệu phải xử lý bằng quyết định riêng trước import, không silently drop.

### Property và Staff

Owner vẫn quản lý một Chain thông qua business_profile; Location/Room/Asset giữ ID. Staff assignment check đọc staff_assignments theo ngày Việt Nam tại mỗi request. RoomType APIs có thể giữ DTO/id, nhưng repository đọc/ghi catalog JSON dưới khóa Location; không tạo relation giả không có transaction.

### Contract và meter

contracts giữ document/handover/move-out snapshots và các version/history; contract_signings vẫn là tập request độc lập. ContractResidents giữ occupant, không biến mỗi occupant thành signer. Meter OCR proposal trong task trước confirm; sau confirm lưu reading và evidence metadata. Ảnh/tệp không nằm trong DB và luôn tải qua kiểm quyền.

### Billing, bank, adjustment và settlement

Một periodic bill Room + tháng; recipients là snapshot, status Draft/Final numeric cũ. Debt/payment status tính từ allocations và approved adjustments, không sửa total gốc. Invoice items và recipients bất biến sau Final. Payment và DepositVerification cũ được chuẩn hóa về một bank receipt, sau đó allocate đúng mục đích; chuyển cọc là allocation, không thêm receipt thứ hai.

Schema hỗ trợ các quan hệ ledger mà Word đề xuất nhưng **không tự phê duyệt partial payment, overpayment, cọc deduction/credit/refund hoặc final/ad-hoc invoice policy**. Adapter Compact24 giữ nhánh exact/manual review hiện có, khóa ledger, chống trùng claim, receipt và allocation trong transaction. SQL bảo vệ receipt/allocation bất biến; logic số dư và eligibility vẫn ở service. Các khả năng schema rộng hơn như tự chia partial/excess/refund chưa có policy/implementation không được xem là tính năng đã hoàn tất.

### Incident, finance và public

Incident sinh một hoặc nhiều Work Order trong operational_tasks. Cost thực vào expenses; financial_scenarios giữ giả định riêng. Website đọc projection được duyệt ở Location/Room, không có Guest capture. Notifications có durable outbox/inbox và AUDIT theo phân loại server.

## 6 Những điểm team cần chốt trước triển khai

| Mã  | Nội dung cần kết luận                                            | Đề xuất trong bản 24 bảng                                                                                                                                 |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Chấp nhận thay lớp persistence để đạt 24 bảng                    | Giữ API/UUID, sửa stores/repositories/migrations và regression, không giữ bảng cũ làm runtime song song vĩnh viễn                                         |
| C02 | Chính xác một Owner và cấu hình một Chain                        | users.roles hỗ trợ role hiện có; unique chặn Owner thứ hai. Bootstrap, chặn gỡ role Owner cuối cùng và multi-Owner legacy cần quyết định/chuyển đổi riêng |
| C03 | Hóa đơn Room + kỳ hay Contract + kỳ                              | Giữ quyết định đã ghi nhận 01/11 Room + kỳ; sửa tài liệu Word/SRS tương ứng                                                                               |
| C04 | Có giữ lịch ca UC-09 không                                       | Nếu giữ, STAFF_SHIFT trong operational_tasks; không thêm StaffShifts                                                                                      |
| C05 | Payroll/bonus/penalty còn OQ-06                                  | Giữ staff_employments theo Word, chưa bật tính lương/thưởng phạt tự động                                                                                  |
| C06 | Phạm vi giữ assignment/history/audit                             | Giữ bằng JSON history và AUDIT rows; không cần thêm bảng và không làm mất dữ liệu hiện có                                                                 |
| C07 | Chuyển 100% Holding deposit khi Main required deposit thấp hơn   | Chốt phần chênh/credit/refund; không tự nới thành hợp đồng đã đủ tiền hoặc hạch toán kép                                                                  |
| C08 | Exact/partial/multi-invoice/excess/refund/reservation/reversal   | Schema có khả năng biểu diễn; chỉ bật các nhánh đã có policy được duyệt, giữ exact/manual review hiện tại trong giai đoạn chuyển đổi                      |
| C09 | Holding expiry/Addendum/final/ad-hoc bill                        | Có thể dùng các bảng hiện tại; chốt state/eligibility và cách tránh thu trùng trước khi thêm hành vi                                                      |
| C10 | Tạm trú/JOB-08, SLA/cadence và retention OQ-04/07/08             | Không tự thêm Staff đăng ký, không gọi VNeID; không đặt thời hạn hoặc retention tùy ý                                                                     |
| C11 | Có chấp nhận catalog/assignment trong JSON thay FK/EXCLUDE không | Cần service locks, structural validation và negative/concurrency tests; nếu chưa có thì chưa cutover                                                      |
| C12 | Audit/queue/commands dùng bảng gộp                               | Thống nhất record_kind/task_type, DTO/filter riêng, lease/idempotency và giới hạn payload; không cho Staff đọc records kỹ thuật                           |

Không yêu cầu team phê duyệt thêm bảng mới để xử lý các mục trên. Các mục là quyết định cách gộp và policy, không phải lý do giữ 70 bảng.

## 7 Trình tự chuyển hệ thống hiện tại sang 24 bảng

1. **Chốt mapping và dữ liệu nguồn.** Kiểm kê live counts/UUID/FK/status, multi-Owner/duplicate email, external login/claims/tokens nếu có, key versions, bank reference claims và file references. Chỉ lấy dữ liệu tổng hợp/được phép; không gửi PII/secret vào báo cáo.
2. **Chuyển auth trước trên môi trường thử.** Custom stores/users mapping, session/token self-relation, stamp/lockout/reset/revoke/reuse detection. Giữ password hash và encryption keys cũ; test đăng nhập tài khoản tổng hợp đã tồn tại.
3. **Chuyển repository theo nhóm nghiệp vụ.** Giữ interface/application service và DTO khi còn phù hợp; sửa queries/raw SQL/locks/trigger có tên bảng cũ. APIs cho chức năng tương lai chỉ thêm khi được duyệt, không sinh endpoint từ schema.
4. **Viết công cụ import/migration riêng.** Giữ IDs hoặc lưu source ID rõ trong snapshot khi hợp nhất nhiều bản ghi. Mỗi record có provenance và đối soát; không lấy SQL tạo trống làm công cụ migrate dữ liệu. Không nhập history 34 migration cũ vào schema mới rồi báo backend đã migrate xong.
5. **Đối soát.** Count gộp theo mapping, hash tài liệu, số xác nhận đúng version, recipient snapshots, tất cả amounts/balances/claims và quyền negative. Với receipt cọc/bank trùng nguồn, không tạo hai payment hoặc tăng verified revenue hai lần.
6. **Nghiệm thu cutover.** CI/review, restore test, feature flags/configuration, chạy song song read comparison trên bản sao nếu cần; dừng ghi khi chuyển chính thức theo kế hoạch được duyệt. Không có lệnh DROP 70 bảng trong bộ thiết kế này.
7. **Rollback.** Giữ backup schema/data 70 bảng và object storage manifests tới khi nghiệm thu; phục hồi app+DB+keys tương ứng, không rollback bằng xóa ledger hoặc sửa tài liệu đã ký.

Quyết định thay persistence theo yêu cầu tiếp tục hoàn tất 70→24 đã được ghi trong IMPLEMENTATION_REPORT, kèm trade-off JSON, khởi tạo/versioning và rollback. Không thay công nghệ/provider, không thực hiện cutover database live. Những mục C04/C05/C07/C08/C09/C10 còn thiếu policy vẫn giữ hành vi an toàn đã triển khai.

## 8 Truy vết và acceptance bắt buộc cho chuyển đổi

| Nhóm              | Nguồn                                     | Kiểm chứng phải có trước cutover                                                                                                                                       |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth/Identity     | UC-01..03, GBR-01/02/13                   | Hash cũ còn dùng được, email normalization, lockout, stamp rotation, expired/revoked token, refresh reuse/parallel rotate, reset một lần                               |
| Staff/RoomType    | BF-01/02, UC-04..12, DBR-01               | Catalog id đúng, cross-Location bị chặn, assignment chồng kỳ bị chặn dưới concurrency, Staff hết assignment mất quyền, technical rows không xuất hiện trong board      |
| Contract/evidence | BF-03/04, UC-13..19, GBR-04/06, DBR-03/04 | Provider/hash/evidence giữ nguyên; confirmations gắn version, không activation khi thiếu tiền/ký, không Staff ký hoặc duyệt cư trú                                     |
| Meter/billing     | BF-05, UC-20/21, DBR-05..07, JOB-09/10    | OCR chưa confirm không tính tiền, một periodic bill Room+kỳ, recipients lịch sử không đổi, thiếu dữ liệu không Final, snapshot/rate/date bằng bản cũ                   |
| Money/adjustment  | BF-06, UC-22..25, GBR-10/18, DBR-08       | Không mất/nhân receipt hoặc claim; exact/under/over/unmatched, refund vs allocate race, chuyển cọc/reversal, total Final bất biến, bank provider failure/manual review |
| Incident/expense  | BF-07, UC-26..30, DBR-09/10               | Staff không approve cost/verify thay Owner; incomplete Work Orders không resolve; emergency append-only, cost không duplicate                                          |
| Finance/public    | UC-31..38, GBR-15..17, DBR-11/12          | What-if tách actual, Owner finance, Guest chỉ đọc approved projection không PII/private file/bank config                                                               |
| Gộp queue/audit   | JOB-01..10, DBR-13, GBR-18                | Outbox/command commit cùng effect, replay không lặp, lease/crash recovery, audit append-only, inbox không mất khi delivery lỗi                                         |

## 9 Kết quả kiểm tra mới của bản 24 bảng

Lệnh: `powershell -NoProfile -ExecutionPolicy Bypass -File docs/database/2026-11-03/compact-24/Verify-Compact24.ps1`.

- PASS: tạo đúng 24 bảng vật lý trên PostgreSQL 18.6 trong database tổng hợp riêng.
- PASS: 28 assertions về cấu trúc, constraint và guard: max-one Owner, role không hợp lệ, session/token same-user/lifetime, Room unique/capacity, cross-Location asset, JSON history append, activation metadata, active meter, job dedupe, invoice Final/recipients/items immutability, verified payment source, immutable allocation, exact reversal, immutable audit và inbox dedupe/TRUNCATE guard.
- PASS: SQL từ chối database đã có bảng; fixtures rollback và database thử được dọn.
- PASS: đối chiếu tên bảng/cột và số FK của SQL với sơ đồ DBML; không xuất dữ liệu nghiệp vụ. Bộ kiểm này không đăng nhập backend hoặc xác nhận đầy đủ policy/permission/concurrency.
- PASS: đối chiếu JSON với schema PostgreSQL thật vừa dựng: 24 bảng, 386 cột đúng tên/kiểu/nullability/PK và 83 quan hệ FK đúng đầu nối/nhãn cột; không có ID ô bị trùng. Chưa kiểm import/render trong ứng dụng sơ đồ gốc.

Cập nhật 04/11/2026: backend Compact24, công cụ import toàn bộ source model, API regression và Legacy Independence đã chạy trên PostgreSQL 16.15; số liệu cuối ở IMPLEMENTATION_REPORT. NOT RUN: cutover/restore dữ liệu thật, provider ngân hàng/MySign và MinIO thật, E2E browser/device/ST/AT, hiệu năng và coverage. Các kiểm thử dùng dữ liệu tổng hợp và provider/storage thay thế được ghi rõ.

## 10 Mapping từ 70 bảng hiện tại sang 24 bảng mục tiêu

Phần dưới được đối chiếu đủ 70 tên bảng trong export hiện trạng. Những ID/record có ý nghĩa độc lập được giữ trong JSON entry hoặc bảng đích; không bỏ vì không còn bảng riêng. Mọi dữ liệu không map được phải chặn import và đưa team quyết định, không xóa âm thầm.

<!-- GENERATED MAPPING -->

| Bảng hiện tại                   | Nơi lưu trong thiết kế 24 bảng                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| AspNetRoleClaims                | BLOCKED nếu có dữ liệu: external role claims chưa có trong runtime hiện tại; cần quyết định mapping hành vi, không bỏ dữ liệu          |
| AspNetRoles                     | users.business_profile.identityRoles của Owner: giữ UUID, tên, normalized name và concurrency stamp của catalog ba role                |
| AspNetUserClaims                | BLOCKED nếu có dữ liệu: external user claims chưa có trong runtime hiện tại; cần quyết định mapping hành vi, không bỏ dữ liệu          |
| AspNetUserLogins                | BLOCKED nếu có dữ liệu: external login chưa có trong runtime hiện tại; cần quyết định mapping hành vi, không bỏ dữ liệu                |
| AspNetUserRoles                 | users.roles: grants theo user; UUID role đọc từ catalog identityRoles đã bảo toàn                                                      |
| AspNetUsers                     | users: giữ UUID, password hash, stamps, lockout và mọi trường Identity đã triển khai                                                   |
| AspNetUserTokens                | BLOCKED nếu có dữ liệu: external Identity token store chưa có trong runtime hiện tại; cần quyết định mapping hành vi, không bỏ dữ liệu |
| Assets                          | assets                                                                                                                                 |
| AuthenticationSessions          | refresh_tokens: dòng SESSION/TOKEN, giữ ID và liên kết chuỗi rotation                                                                  |
| BackgroundJobs                  | operational_tasks loại SYSTEM_JOB: lease bền vững, source key theo plan/kỳ/phase và lịch sử từng lần thử chỉ ghi thêm                  |
| BankReferenceClaims             | payments: giao dịch chuẩn, effect key và lịch sử đối soát; giữ chống trùng claim giữa cọc và hóa đơn                                   |
| BillingAutomationAttempts       | operational_tasks loại SYSTEM_JOB: lease bền vững, source key theo plan/kỳ/phase và lịch sử từng lần thử chỉ ghi thêm                  |
| BillingAutomationExecutions     | operational_tasks loại SYSTEM_JOB: lease bền vững, source key theo plan/kỳ/phase và lịch sử từng lần thử chỉ ghi thêm                  |
| BillingAutomationPlans          | locations.operating_settings: cấu hình phân loại và version; DTO riêng tư và mã hóa theo thiết kế được duyệt                           |
| BillingPolicies                 | billing_policies                                                                                                                       |
| BillingRepresentativeSelections | rooms.billing_representatives theo kỳ/version và invoices.billing_snapshot khi phát hành; giữ lựa chọn Owner trước phát hành           |
| BillingSchedules                | locations.operating_settings: cấu hình phân loại và version; DTO riêng tư và mã hóa theo thiết kế được duyệt                           |
| Chains                          | users.business_profile.chain: một cấu hình chung, giữ ID/tên/version/lịch sử                                                           |
| ContractDepositVerifications    | payments và payment_allocations: receipt chuẩn đã xác minh cấp cho cọc; giữ nguồn gốc và chống trùng tham chiếu ngân hàng              |
| ContractDocumentFiles           | contracts.documents: giữ ID tài liệu, object key, hash, template và version                                                            |
| ContractExpiryNotices           | notifications OUTBOX/INBOX với event key; lịch chạy trong operational_tasks loại SYSTEM_JOB                                            |
| ContractFileUploads             | operational_tasks SYSTEM_JOB: task_data.state giữ upload intent/object key/lease/scope; history giữ phiên bản và tombstone             |
| ContractFinalInspections        | contracts.move_out và contracts.history: giữ baseline, quan sát, ID kiểm tra/bằng chứng và actor                                       |
| ContractHandoverHistory         | contracts.handover và contracts.history: giữ snapshot theo version và tham chiếu hai bên xác nhận                                      |
| ContractHandovers               | contracts.handover và contracts.history: giữ snapshot theo version và tham chiếu hai bên xác nhận                                      |
| ContractInspectionEvidence      | contracts.move_out và contracts.history: giữ baseline, quan sát, ID kiểm tra/bằng chứng và actor                                       |
| ContractMoveOutHistory          | contracts.move_out và contracts.history: giữ baseline, quan sát, ID kiểm tra/bằng chứng và actor                                       |
| ContractMoveOuts                | contracts.move_out và contracts.history: giữ baseline, quan sát, ID kiểm tra/bằng chứng và actor                                       |
| ContractOperations              | operational_tasks loại COMMAND: source_key có namespace, actor/operation/key/fingerprint/result và ID receipt cũ                       |
| ContractResidents               | contract_residents                                                                                                                     |
| Contracts                       | contracts                                                                                                                              |
| ContractSettlementReviews       | contracts.settlement và contracts.history: snapshot tài chính, ID review và tham chiếu ledger                                          |
| ContractSignatures              | contract_signings: giữ ID request, tham chiếu provider và hash                                                                         |
| InvoiceAdjustmentCommands       | operational_tasks loại COMMAND: source_key có namespace, actor/operation/key/fingerprint/result và ID receipt cũ                       |
| InvoiceAdjustmentDecisions      | invoice_adjustments: giữ ID request/decision, snapshot/lịch sử/bằng chứng; kiểm đúng cặp request và decision                           |
| InvoiceAdjustmentEvents         | notifications loại OUTBOX: intent/event key bền vững và lịch sử phát/giao; commit cùng tác động nghiệp vụ                              |
| InvoiceAdjustmentEvidence       | operational_tasks SYSTEM_JOB: giữ upload intent, request link/object key, ID và cleanup state; không mất upload chưa gắn request       |
| InvoiceAdjustmentRequests       | invoice_adjustments: giữ ID request/decision, snapshot/lịch sử/bằng chứng; kiểm đúng cặp request và decision                           |
| InvoiceIssuedEvents             | notifications loại OUTBOX: intent/event key bền vững và lịch sử phát/giao; commit cùng tác động nghiệp vụ                              |
| InvoiceLines                    | invoice_items và calculation_snapshot                                                                                                  |
| InvoiceRecipients               | invoices.recipient_user_ids: snapshot lịch sử quyền xem, bất biến sau chốt                                                             |
| Invoices                        | invoices                                                                                                                               |
| Locations                       | locations                                                                                                                              |
| MeterEvidence                   | operational_tasks.evidence: giữ ID, object key và OCR/upload state; reading tham chiếu snapshot bằng chứng đã xác nhận                 |
| MeterReadings                   | meter_readings                                                                                                                         |
| Meters                          | meters                                                                                                                                 |
| NotificationDeliveryAttempts    | notifications loại INBOX: chống trùng recipient/event, trạng thái đọc, delivery_history; ID nguồn cũ ở event_data                      |
| NotificationPublications        | notifications loại OUTBOX: intent/event key bền vững và lịch sử phát/giao; commit cùng tác động nghiệp vụ                              |
| OperationalTaskCommands         | operational_tasks loại COMMAND: source_key có namespace, actor/operation/key/fingerprint/result và ID receipt cũ                       |
| OperationalTaskEvidence         | operational_tasks: dòng task chính, task_data/evidence/history có cấu trúc, giữ ID entry/submission cũ                                 |
| OperationalTaskFileUploads      | operational_tasks SYSTEM_JOB: task_data.state giữ upload intent/object key/lease/scope; history giữ phiên bản và tombstone             |
| OperationalTaskHistory          | operational_tasks: dòng task chính, task_data/evidence/history có cấu trúc, giữ ID entry/submission cũ                                 |
| OperationalTaskNotifications    | notifications OUTBOX: giữ sự kiện tác vụ và read state cũ; UserNotifications INBOX giữ hộp thư theo recipient                          |
| OperationalTasks                | operational_tasks: dòng task chính, task_data/evidence/history có cấu trúc, giữ ID entry/submission cũ                                 |
| PasswordResetGrants             | users.reset_token_hash/reset_expires_at/reset_consumed_at                                                                              |
| PaymentAllocations              | payment_allocations: giữ ID phân bổ cũ, số tiền, actor, thời điểm và tham chiếu nguồn                                                  |
| PaymentCommands                 | operational_tasks loại COMMAND: source_key có namespace, actor/operation/key/fingerprint/result và ID receipt cũ                       |
| PaymentConfirmedEvents          | notifications loại OUTBOX: intent/event key bền vững và lịch sử phát/giao; commit cùng tác động nghiệp vụ                              |
| PaymentReconciliations          | payments: giao dịch chuẩn, effect key và lịch sử đối soát; giữ chống trùng claim giữa cọc và hóa đơn                                   |
| PaymentTransfers                | payments: giao dịch chuẩn, effect key và lịch sử đối soát; giữ chống trùng claim giữa cọc và hóa đơn                                   |
| PropertyChanges                 | notifications loại AUDIT: giữ actor, thời gian, hành động, lý do, tham chiếu trước/sau, ID nguồn và namespace sự kiện                  |
| ReceivingBankAccounts           | locations.operating_settings: cấu hình phân loại và version; DTO riêng tư và mã hóa theo thiết kế được duyệt                           |
| RefreshTokens                   | refresh_tokens: dòng SESSION/TOKEN, giữ ID và liên kết chuỗi rotation                                                                  |
| Residents                       | residents: giữ envelope mã hóa, ID Resident/Owner và phiên bản khóa HMAC                                                               |
| Rooms                           | rooms                                                                                                                                  |
| RoomTypes                       | locations.room_types: giữ ID catalog, version, cấu hình mặc định và lịch sử                                                            |
| SecurityAudit                   | notifications loại AUDIT: giữ actor, thời gian, hành động, lý do, tham chiếu trước/sau, ID nguồn và namespace sự kiện                  |
| SigningCertificates             | users.signing_credentials; chụp chứng thư dùng lúc ký vào contract_signings                                                            |
| StaffLocationAssignments        | locations.staff_assignments: phân công có hiệu lực, giữ ID phân công cũ                                                                |
| UserNotifications               | notifications loại INBOX: chống trùng recipient/event, trạng thái đọc, delivery_history; ID nguồn cũ ở event_data                      |

## 11 Đối chiếu và đồng bộ JSON người dùng cập nhật

Nguồn kiểm tra là file `BHOME_Database_Design.json` được cung cấp trong Downloads, không phải database live đã được migrate. File nguồn có 24 ô bảng và 49 đường nối; một đường nối không có target. Chỉ riêng sơ đồ này không đủ xác nhận trạng thái deployed database hoặc chính sách tiền/quyền đã được phê duyệt.

SHA-256 bản nguồn trước khi chỉnh: `865D6E779FCBB108B7C6CA730FCC1F5D6498C5AC8C03673A3ECF2ECED350325C`. Bản nguồn được giữ làm backup cục bộ trong thư mục công cụ bỏ qua bởi Git. Bản đồng bộ trong repository là file dùng để team review và nhập lại vào công cụ sơ đồ.

### Các khác biệt đã xử lý theo lựa chọn người dùng

| Phần JSON nguồn                                                                        | Cách đồng bộ                                                                                                     | Lý do                                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PK/FK BIGINT và IDENTITY                                                               | UUID; bỏ nhãn IDENTITY                                                                                           | Giữ định danh của backend, ciphertext AAD, API và evidence hiện tại                                              |
| users ít trường xác thực, một role text                                                | users giữ normalization, hash/stamps, lockout, role array, reset grant và metadata chứng thư                     | Không tự bỏ authentication/session guarantees; vẫn cần custom Identity stores khi chuyển backend                 |
| refresh_tokens chỉ hash và expiry                                                      | Bổ sung SESSION/TOKEN, session_id, security_stamp, rotation/consumed/revoked fields                              | Giữ logout-all, absolute lifetime và phát hiện refresh reuse                                                     |
| locations chỉ có responsible_staff_user_id                                             | Phân công có ngày trong staff_assignments, cấu hình phòng loại trong room_types                                  | Giữ DBR-01 và nghiệp vụ RoomType mà không thêm bảng                                                              |
| rooms lưu room_type/amenities/base_rent rải trên phòng                                 | Cấu hình loại phòng tại Location, room_type_id có kiểm server; public snapshot và billing representative theo kỳ | Tránh lẫn giá niêm yết với giá dùng để lập bill; giữ lựa chọn Owner có version                                   |
| residents có plaintext full_name và nhiều cột crypto rời                               | identity_data envelope hiện có, identity_owner_scope_id và HMAC version; display_label không nhạy cảm            | Giữ cipher/nonce/tag/key version và scope thực đang dùng; không coi thiếu auth tag là thiết kế mã hóa hoàn chỉnh |
| contracts thiếu snapshot handover/move-out/settlement                                  | Gộp documents/handover/move_out/settlement/history trong contracts                                               | Giữ bằng chứng và ID/version xác nhận đã có, không thêm bảng                                                     |
| contract_signings thiếu tài khoản người ký và chi tiết provider request                | Thêm signer_user_id, certificate snapshot và source/prepared/signed hashes/object keys                           | Chỉ ký provider ngoài theo GBR-04; không sử dụng otp_verified_at làm bằng chứng thay ký số                       |
| contract_residents thiếu actor Owner và phân biệt ngày thực tế                         | Giữ planned/actual dates, kết quả và actor xác nhận                                                              | Tạm trú theo occupant; Tenant thao tác ngoài VNeID, không tự mở quyền Staff                                      |
| operational_tasks thiếu phân loại job/command và nhiều actor quyết định                | Giữ task_type, source_key, lease, version, cost approval/verification actor và typed task_data/evidence/history  | Giữ idempotency/retry/Owner approval; không thêm Jobs/Commands/WorkOrders tables                                 |
| meter_readings thiếu actor xác nhận, previous/consumption và display precision ở meter | Giữ confirmed_by, proposal/confirmed riêng và thiết bị/reading metadata                                          | OCR suggestion không thành số dùng tính tiền nếu chưa human confirm                                              |
| invoices chỉ gắn Contract, không có quyền xem lịch sử                                  | Giữ Room + kỳ cho periodic, recipient_user_ids và billing_snapshot                                               | Theo quyết định 01/11; Tenant mới không kế thừa hóa đơn cũ                                                       |
| invoice_items thiếu policy/calculation snapshot                                        | calculation_snapshot, policy/reading FK và rate/quantity chính xác                                               | Giữ căn cứ tính tiền, giá có hiệu lực và phép tính đã chốt                                                       |
| invoice_adjustments thiếu actor/time request và actor Owner quyết định                 | Giữ requested_at, decided_by_user_id, request/decision snapshots, version và history                             | Không mất trace hoặc sửa trực tiếp total hóa đơn Final                                                           |
| payments thiếu actor xác minh và namespace/claim dùng chung với cọc                    | effect_key, verification_method/data, actor/time và reconciliation history                                       | Giữ một receipt đã xác minh, chống credit hai lần theo namespace nguồn đúng                                      |
| payment_allocations chỉ nguồn payment và đích invoice                                  | Bổ sung source_deposit_contract_id và target_deposit_contract_id, line_number, actor/time và reversal guard      | Biểu diễn chuyển cọc không tạo receipt ngân hàng lần hai; policy/số dư vẫn cần slice triển khai đầy đủ           |
| refund_requests thiếu beneficiary và actor quyết định                                  | Thêm beneficiary/actor/time/version; giữ evidence thực hoàn                                                      | Request/Approved không đồng nghĩa Completed hoặc đã bank-settled                                                 |
| expenses/scenarios thiếu actor ghi nhận                                                | Giữ recorded_by/created_by và calculated_at ở kịch bản                                                           | Truy vết chi phí và assumptions của báo cáo, không thêm bảng thống kê                                            |
| notifications chỉ inbox                                                                | record_kind INBOX/OUTBOX/AUDIT, actor/scope, event_data và delivery_history/lease                                | Giữ inbox khi delivery lỗi, audit độc lập append-only; API chỉ trả đúng loại/recipient                           |
| 49 đường nối chưa đủ, một đường thiếu target                                           | Dựng lại 83 đường theo toàn bộ FK vật lý từ PostgreSQL; giữ ID node cũ                                           | Các đường mới phản ánh cả FK actor/self/composite hiện có, không phải thêm bảng                                  |

Các cột được gộp hoặc đổi tên có dữ liệu cần giữ phải được chuyển theo mapping/provenance, không bỏ dữ liệu nguồn khi import. Giá tiền trong schema mục tiêu vẫn theo numeric(18,0) VND của code, rates/quantities theo precision hiện có; không tự đổi sang float hoặc làm tròn tiền thực khi chưa kiểm dữ liệu nguồn.

### Ranh giới của bản đồng bộ

SQL và DBML đã có các cơ chế bảo vệ trên nên không thay lại schema theo các thiếu sót trong JSON nguồn. Lượt này cập nhật JSON, ghi rõ nguồn/quyết định trong SQL/DBML/tài liệu và mở rộng bộ verify để kiểm đồng bộ về sau. Sơ đồ JSON mô tả bảng/cột/khóa; các CHECK, partial index và trigger đầy đủ vẫn lấy từ SQL. Mỗi cột hiển thị PK, NULL/NOT NULL, FK, UNIQUE/default khi có; JSON/array references không được vẽ như FK vật lý.

File giữ version, page/layer và ID 24 node của bản gốc. HTML trong node được dựng lại với hàng tự giãn, tên cột/kiểu/khóa tách rõ; không có dữ liệu Tenant, token, key hoặc cấu hình kết nối thật trong sơ đồ. Chưa có bằng chứng import/render bằng công cụ gốc; không tuyên bố đã thử UI chỉ từ việc parse JSON thành công.

Đã chạy lại 28 assertions trên PostgreSQL 16.15 và kiểm schema/sơ đồ 24 bảng. Backend Compact24, migration trên fixture và Legacy Independence đã có kiểm chứng riêng trong IMPLEMENTATION_REPORT. Đã tạo `bhome` Compact24 phát triển riêng và giữ database cũ bằng archive theo yêu cầu setup; chưa gọi provider thật, chạy browser/device E2E hoặc phê duyệt các policy ngân sách/refund còn mở.

## 12 Hợp đồng persistence Compact24 đã triển khai

- SQL là nguồn chính của 24 bảng/386 cột/83 FK; JSON và DBML giữ nguyên danh mục, cột và quan hệ. Bổ sung lại các guard nguồn về normalized Room/Asset unique, catalog/scope, policy effective date/first-used, account revoke và handover confirmation/baseline/reading references; không thêm bảng/cột/FK. Extension PostgreSQL `btree_gist` phục vụ exclusion theo khoảng ngày.
- Snapshot domain trong các JSON đã duyệt dùng `schemaVersion: 1`, `recordType`, `recordKey`, `state`, `deleted` khi cần. Trường JSON camelCase; UUID, DateOnly, UTC timestamp, decimal và envelope mã hóa giữ giá trị gốc. Tombstone chỉ dùng cho intent kỹ thuật; không xóa lịch sử tài chính.
- Cột scalar native là nguồn query/filter/index cho dữ liệu chuẩn hóa. Scalar thiếu trong schema gọn nằm trong snapshot typed/history khai báo ở `Compact24Records`; không tạo cột JSON hoặc bảng phụ. EF projection đọc bảng native/JSON; writer ghi native trong transaction và kiểm version gốc.
- JSON child được cập nhật dưới khóa parent; history append-only. Chuỗi số thứ tự lịch sử tự tăng được khóa theo loại bản ghi; lease/idempotency dùng durable native state. Tác vụ Staff, COMMAND và SYSTEM_JOB được lọc bằng discriminator trước phân trang.
- Preflight chặn external Identity claims/logins/tokens có dữ liệu; source multi-Owner/multi-Chain, normalized email mơ hồ, FK không biểu diễn được hoặc đối soát sai làm import thất bại/rollback. Không coi source row count bằng 0 là đã nghiệm thu hành vi tương lai.
- Các bảng dành cho employment, Incident/expense, financial scenario, refund... không tự sinh endpoint/policy từ schema. Runtime chỉ chuyển phần nghiệp vụ đã tồn tại; những quyết định còn mở vẫn được giữ trong mục 6.
