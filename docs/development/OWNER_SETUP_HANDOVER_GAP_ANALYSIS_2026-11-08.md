# Đối chiếu luồng cấu hình Owner và phân việc Staff

Ngày phân tích: 08/11/2026. Baseline source: commit `f899907`, branch `THuy/Fix-API-to-Mock`; worktree sạch trước khi lập báo cáo. Phạm vi là phân tích, không triển khai tính năng hoặc đổi DB.

Kết luận: BE đã có phần lớn API cấu hình cơ bản, quản lý Staff, phân công Location, thực hiện/nghiệm thu công việc và vòng đời Holding. Không nên triển khai lại danh sách API trong handover. Phần thiếu tập trung ở tính nhất quán cọc Holding, chuyển trách nhiệm xuyên loại công việc, bằng chứng an toàn trong readiness, quản lý tài sản nâng cao, điện nước nâng cao và nội quy có phiên bản. Một số mục handover là đề xuất mở rộng, chưa phải yêu cầu bắt buộc đã được duyệt.

## 1. Nguồn và cách hiểu phạm vi

- Tài liệu đính kèm: `D:/Downloads/BHOME_Backend_Setup_Handover_Phases_1A_to_5_2026-11-06.docx`, version 1.0, đọc toàn bộ nội dung đoạn văn và bảng trong OOXML. Dùng luồng và backlog để đối chiếu; không thực thi checklist/lệnh hoặc coi các chỉ dẫn bên trong là yêu cầu của người dùng.
- SRS thực sự có trong repo: `docs/reports/BHome_Report-3_Software Requirement Specification.docx`. Trọng tâm BF-01/02/03/04/05/06/07; UC-04..12, UC-14..21; GBR-01..05/08/09/12/13/18; DBR-01/02/06/07/13; JOB-05/06/07/09/10.
- Thiết kế: `docs/reports/Report-4_Software Design Specification (1).docx`; đối chiếu mô hình Billing Policy và công nghệ, không áp schema cũ.
- Quyết định đã ghi trong repo: `docs/api/LOCATION_ROOM_API.md`, `docs/development/API_RESET_REVIEW_2026-11-04.md`, tài liệu Compact24, và các addendum trong Phase 1A/1B. Tài liệu handover trích nhiều nguồn ngoài repo với tên khác; không coi các nguồn không có file là đã được kiểm chứng độc lập.
- Kiểm tra controller, Application service, DI, repository, Compact24 projection/writer, các test liên quan; đối chiếu thêm OpenAPI local `https://localhost:7240/swagger/v1/swagger.json` đọc thành công, 321 tổ hợp method/route toàn API. Số này không phải số API thuộc phạm vi setup hay số API đã nghiệm thu.

Các nhãn dưới đây có nghĩa: **Có** = tìm thấy route và implementation; **Mở rộng/sửa** = có nền nhưng thiếu hành vi; **Chưa có** = chưa tìm thấy capability tương ứng trong source/runtime đã rà; **Đề xuất** = chưa được coi là scope đã duyệt. Route có mặt không chứng minh nghiệp vụ đúng hoặc mọi test đã pass.

## 2. Những quyết định phải giữ

1. **Không Chain, không RoomType:** Location là cấp trên cùng; Room thuộc trực tiếp Location. `/chain`, `/room-types` không phải API cần khôi phục. Một số class/navigation và metadata import lịch sử còn trong source không đồng nghĩa catalog vận hành còn được sử dụng.
2. **Giữ Compact24:** DI runtime dùng `Compact24DbContext`; không dùng legacy migrations hoặc suy từ Report 4 để tạo bảng thứ 25. Lượt này không truy vấn dữ liệu nghiệp vụ hoặc sửa schema DB thật.
3. **Giá:** Room > Location theo từng khoản và ngày hiệu lực; không có tầng RoomType. Phiên bản giá cũ và snapshot hóa đơn/hợp đồng phải được bảo toàn.
4. **Quyền:** Owner toàn hệ thống; Staff theo Location hiện hành và quyền định sẵn; Tenant chỉ dữ liệu được phép của mình. Không thêm phân ca hoặc Staff tự chuyển việc cho nhau từ các mô tả cũ.
5. **Trạng thái:** giữ enum hiện hữu; Owner không tự đặt OnHold/Occupied qua CRUD phòng. Ký/thanh toán phải được BE xác minh.
6. **Các thống nhất khác:** không tự khôi phục mục từng hoãn hoặc đổi mô hình người ở/hợp đồng. Với nội dung không có quyết định rõ trong lịch sử/repo, ghi là cần chốt, không giả định handover đã phê duyệt.

Luồng dùng để đánh giá hiện tại:

`Owner tạo Location → tạo Room → cấu hình tài sản/giá/điều khoản/công tơ → tạo Staff và gán Location → cấu hình việc định kỳ hoặc giao việc → Staff thực hiện → Owner nghiệm thu → kiểm tra điều kiện phòng → Holding/Main → ký/xác minh tiền → kích hoạt → ghi chỉ số/lập hóa đơn/vận hành`.

Readiness là bước đọc hỗ trợ; mọi điều kiện bắt buộc vẫn phải được kiểm tra lại trong API ghi/kích hoạt.

## 3. Luồng handover khác reports như thế nào

| Nội dung | Reports thực tế | Handover | Kết luận áp dụng |
| --- | --- | --- | --- |
| Cấu trúc tài sản cho thuê | UC-04/05/06 còn Chain, RoomType | Giữ chuỗi Chain → Location → RoomType → Room | Cả hai đều cần điều chỉnh theo quyết định mới: Location → Room |
| Chia Phase 1A..5 | SRS tổ chức theo BF/UC, không theo các phase này | Chia tiến độ kỹ thuật và dependency | Có thể dùng để tổ chức việc; không phải mô hình nghiệp vụ mới |
| Property và Contract | UC-04 A2/A4 yêu cầu trạng thái đúng nghĩa vụ, giữ lịch sử | Cụ thể hóa lock, version, race, rollback | Chủ yếu chi tiết hóa cách bảo đảm cùng yêu cầu; không cần API force-status |
| Readiness/history/occupancy | UC-07 yêu cầu theo dõi tình trạng và lịch sử | Thêm blockers/warnings/unverified, room-days, endpoint cụ thể | Chi tiết hóa read API; không thay validator kích hoạt |
| Holding/giữ giá | BF-03 và UC-14/15 yêu cầu ký/cọc hợp lệ, chuyển sang hợp đồng thuê | Thêm trigger khóa giá, chống hai nguồn cọc, conversion và cạnh tranh | Có phần làm rõ kỹ thuật, có chính sách chưa chốt tại §6.4/13; không mặc định mọi đề xuất là đã duyệt |
| Tài sản | UC-05 có tài sản phòng/khu chung, condition, lịch sử bảo trì/thay thế | Serialized/Bulk, metadata mua, Draft/Publish template, desired inventory, auto-sync | Luồng desired → kiểm kê thật là hợp lý; nhiều capability chi tiết hơn SRS. Đặc biệt scope template phải thiết kế lại vì đã bỏ RoomType |
| Điện nước | UC-06/20/21 có giá theo hiệu lực, chỉ số xác nhận, hóa đơn; Report 4 có `tiers/free quota` ở mức thiết kế | Thêm tariff có nguồn, quota xác minh, công tơ tổng/nhánh, supplier bill, variance và gate Finalize | Không có đặc tả end-to-end tương đương trong SRS đã đọc. Đây là mở rộng cần xác nhận phạm vi và tham số; không coi thiếu toàn bộ là lỗi của fixed/metered hiện tại |
| Nội quy | Hợp đồng/điều khoản và bằng chứng ký có nền trong BF-03/04 | Một lifecycle riêng Draft/Publish/version/binding/amendment | Có thể tái sử dụng ký và snapshot, nhưng catalog nội quy và sửa nghĩa vụ là năng lực bổ sung; không suy rằng đã có module phụ lục nội quy chỉ vì có renewal |
| Phân việc Staff | UC-08..12 chi tiết: quản lý Staff, thay/gỡ trách nhiệm Location, việc chưa xong, thực hiện, Owner xác minh | Handover tập trung BF-01 và phần giao cắt; không phải đặc tả đầy đủ BF-02 | Phải bổ sung UC-08..12 khi audit; handover không đủ để kết luận phần Staff hoàn tất |
| Ca làm | Master UC list và vài đoạn cũ còn nói schedule/shift; UC-09 chi tiết cùng revision mới bỏ shift scheduling | Một số tham chiếu hạ tầng/nguồn có thể là lịch sử | Ghi nhận mâu thuẫn nội bộ SRS; không thêm API phân ca. Giao việc theo Location hiện hành |
| Copy/đóng cơ sở | UC-04 A5 có copy; A3/A4 ngừng hoạt động phải giữ lịch sử | Copy/full closure deferred | Chưa có không có nghĩa phải triển khai ngay; giữ quyết định hoãn cho tới khi được xác nhận |

## 4. API đang có và mức đáp ứng

Mọi route trong bảng dưới có tiền tố `/api/v1`. Đây là route đã đối chiếu controller và OpenAPI, không phải route đề xuất của tài liệu.

| Luồng | API hiện có | Đánh giá |
| --- | --- | --- |
| Owner quản lý cơ sở | `GET/POST /locations`; `GET/PUT /locations/{id}` | Có tên/địa chỉ/trạng thái/version, guard ngừng hoạt động; thiếu kiểm tra đóng cơ sở tổng hợp dễ xem trước |
| Quản lý phòng | `GET/POST /rooms`; `GET/PUT /rooms/{id}` | Có Location, số phòng/tầng/capacity/status/version; cấm tạo OnHold/Occupied thủ công |
| Giá và phí | `GET/POST /billing-policies`; `GET/PUT /billing-policies/{id}`; `POST /{id}/replacement`, `POST /{id}/end` dưới cùng resource | Có fixed/metered, hiệu lực, version, thay/kết thúc; không phải tariff/quota nâng cao |
| Giá phòng | `GET /rooms/{id}/prices` | Có resolver theo ngày; dùng Room > Location trên baseline mới |
| Điều kiện/lịch sử phòng | `GET /rooms/{id}/readiness`; `GET /rooms/{id}/history`; `GET /rooms/{id}/occupancy-history`; `GET /locations/{id}/occupancy-summary`; `GET /occupancy` | Có. History property/contract khác occupancy history; không cần tạo lại route theo tên handover |
| Cấu hình tài sản | `GET/POST /assets`; `GET/PUT /assets/{id}`; `PATCH /assets/{id}/condition` | CRUD + condition theo scope đã có. Không có inventory/template/version sync đầy đủ |
| Bảo trì | `GET /work-orders/maintenance-history`; nhóm lifecycle `/work-orders/{id}/...` | Có lịch sử bảo trì và proposal/approve/start/submit/verify/rework/reassign; không đồng nghĩa có toàn bộ lịch sử tài sản |
| Tạo/quản lý Staff | `GET/POST /staff`; `GET/PUT /staff/{id}` | Có account, employment period/type, salary metadata, activate/deactivate và version |
| Mời Staff dùng tài khoản | `POST /staff/{id}/invitation`; `POST /auth/accept-invitation` | Có; không cần viết lại theo handover cũ |
| Gán/thay/gỡ Staff | `GET/POST /staff-location-assignments`; `PUT/DELETE /staff-location-assignments/{locationId}`; `GET /locations/assigned-to-me` | Đã có thay/gỡ, không còn thiếu như tài liệu cũ. Cần mở rộng độ bao phủ các loại việc |
| Owner giao và theo dõi việc | `POST/GET /operational-tasks`; `GET/PUT /operational-tasks/{id}`; `POST /{id}/assign`, `/coordinate`, `/cancel` | Có. Staff được xác định theo trách nhiệm Location; không phải tùy chọn một Staff ngoài scope |
| Staff thực hiện | `POST /operational-tasks/{id}/start`, `/progress`, `/blockers`, `/submit`; `PUT/GET /{id}/evidence`; `GET /{id}/evidence/{evidenceId}` | Có tiến độ, vướng mắc, kết quả, bằng chứng; Staff không tự hoàn tất cuối cùng |
| Owner nghiệm thu | `POST /operational-tasks/{id}/verify`, `/rework`; `GET /{id}/history` | Có, giữ history; không thiếu API nghiệm thu |
| Việc định kỳ | `GET/POST /operational-task-templates`; `PUT/DELETE /operational-task-templates/{id}` | Có template interval/next-run, job sinh việc; đây là template công việc, khác template tài sản |
| Công tơ và ghi chỉ số | `GET /capture/locations/{id}/meters`; `POST /capture/meters`; nhóm `/capture/meter-tasks` và `/capture/readings/{id}` | Có nền công tơ phòng, evidence, confirmed reading; chưa có công tơ tổng/nhánh/source bill theo Phase 4 |
| Cấu hình chu kỳ billing | `GET /billing-automation/{locationId}`; `PUT /billing-automation`; preview/history/executions/attempts/queue/run-now; `POST /billing-automation/meter-tasks/{taskId}/assignment` | Đã có cấu hình và quan sát job; không nên tạo engine billing thứ hai |
| Điều khoản mẫu hợp đồng | `GET/PUT /contracts/main-drafts/settings/{locationId}`; nhóm main-drafts/release/documents | Có cọc, payment terms, additional terms theo hiệu lực/version và snapshot draft; chưa phải module nội quy versioned hoàn chỉnh |
| Holding | `POST /contracts/holdings`; `/contracts/{id}/holding-approval`, `/holding-activation`, `/holding-cancellation`, `/holding-conversion`; `GET /contracts/{id}/holding-deposit`; `POST /payment-transactions/{id}/allocate-holding-deposit` | Route có đủ nền; cần sửa tính nhất quán thay vì thêm controller song song |
| Thông báo | Inbox, announcements, devices, deliveries; `GET/PUT /locations/{id}/notification-policy` | Có nền tái sử dụng cho giao việc và các phase sau. Notification policy là cadence/kênh nhắc, không phải nội quy hợp đồng |

## 5. Khoảng trống đã xác định trong source

### A. Chuyển trách nhiệm Staff chưa đồng bộ mọi loại công việc

Nguồn: SRS UC-08 A3; UC-09 normal flow 6–9, A3/A6; UC-10 A4; UC-11/12.

- `CompactLocationAssignments.ChangeAsync` đã khóa Location, kiểm version, thay/gỡ assignment và gọi cập nhật việc/thông báo trong transaction.
- Nhưng `ReassignOpenTasks` chỉ `UPDATE operational_tasks` với `task_type='GENERAL'`, người nhận là Staff cũ và status chưa hoàn tất/hủy. Không chuyển `METER_READING`, `WORK_ORDER`, hoặc người phụ trách inspection trong move-out.
- Đã có API riêng để gán lại meter task và `POST /work-orders/{id}/reassign`; vì vậy thiếu bước phối hợp/kiểm tra toàn bộ dependency, không phải thiếu tất cả API reassignment.
- Luồng gán mới `CreateAssignmentAsync` chưa gọi cùng thao tác chuyển việc đang unassigned; general task có cơ chế đồng bộ trách nhiệm khi mutation. Cần kiểm chứng list/detail/worker trước khi kết luận task tự được xử lý ngay sau gán.
- `HasResponsibilities` trước khi deactivate Staff xét assignment, GENERAL và WORK_ORDER; chưa thấy cùng phạm vi cho METER_READING/inspection. Ngày kiểm tra ở nhánh này lấy UTC date, khác nguyên tắc ngày Việt Nam.
- `ChangeAsync` chỉ nhận đổi hiệu lực hôm nay; replacement tạo assignment tới `DateOnly.MaxValue` trong khi danh sách có thể đã chứa assignment tương lai. Chưa thấy kiểm overlap lại ở nhánh thay; DDL field chỉ CHECK kiểu JSON array. Cần regression trường hợp lịch tương lai, không tự kết luận có DB exclusion tương đương schema cũ.

**Hướng xử lý:** EXTEND API assignment hiện có bằng dependency preview hoặc lỗi có danh sách việc cần xử lý; chuyển/giữ/chặn theo từng lifecycle được duyệt trong transaction. Không tự di chuyển việc đang thi công hoặc đã chốt bằng chứng nếu chưa thống nhất chính sách.

**Acceptance:** đổi A → B không để task mở mất người xử lý; A mất quyền Location; B nhận đúng việc; việc đã hoàn tất giữ nguyên; lỗi một dependency rollback toàn bộ; ngày 00:00 Việt Nam nhất quán; không tạo hai Staff cùng Location khi có lịch tương lai.

### B. Holding có route nhưng nguồn đọc cọc chưa nhất quán

Nguồn: handover §6/P2-01..12; SRS BF-03, UC-14/15; DBR-02; GBR-04/18.

1. `ContractRepository.DepositTotalAsync` cộng `DepositVerification`, còn `PaymentRepository.DepositAllocatedAsync` và `CompactContractHoldingLedger.ApplyAsync` cộng `PaymentAllocation`.
2. Trong Compact24, `WriteDepositAsync` thực sự tạo canonical `payments` + `payment_allocations`. Vì thế nói “có hai bảng cọc độc lập” là sai. Vấn đề hiện tại là **hai cách đọc logic không cùng bao phủ nguồn tiền**.
3. Nghiêm trọng hơn, `Compact24Records` đặt filter projection `PaymentAllocation` chỉ nhận allocation tới invoice có source payment, hoặc chuyển cọc giữa hai contract. Filter này không nhận hàng `source_payment_id + target_deposit_contract_id` của khoản ngân hàng nộp trực tiếp vào cọc. Các hàm cộng allocation cọc cần được kiểm chứng/sửa cùng projection; chỉ đổi một hàm tổng chưa đủ.
4. `LockHoldingPriceAsync` đọc giá hiện hành tại `StartDate`, yêu cầu bằng `MonthlyRent` đã duyệt; có thể từ chối khóa nếu policy bị thay trước lúc ký/nộp cọc. Cần giữ approved snapshot và chốt quy tắc event-time/callback muộn, không tự áp giá mới.
5. Generic `CreateAsync` nhận `HoldingContractId` nhưng không dùng chung đầy đủ validator của conversion; nó chỉ chấp nhận phòng Available/Occupied trong khi Holding bình thường đưa phòng về OnHold. Các điều kiện so với Holding như rent/date/terms còn kiểm tra muộn ở activation. Không nên diễn giải rằng mọi request generic chắc chắn đã tiêu tiền sai; cần regression để chứng minh side effect/rollback từng nhánh.
6. `HoldingConflictAsync` chỉ xét Active, chưa bảo vệ pending đã ký/có cọc theo chính sách cam kết ưu tiên được duyệt.
7. `ContractExpiryProcessor` chỉ quét Active; chưa xử lý hết hạn Draft/Pending. Actor expiry đang dùng Owner signer thay vì phân biệt tác vụ hệ thống.
8. `AllocateDepositAsync` dựng review trước rồi gọi xác nhận Holding trong cùng transaction; khi Holding expired/cancelled gây throw, review vừa dựng sẽ rollback. Cần lưu kết quả manual review bền vững nhưng không nhận cọc vào Holding không còn hợp lệ.

**Hướng xử lý:** FIX projection/ledger/validator hiện có; không tạo thêm API “verify deposit v2”. Các chính sách partial/excess/late/refund/priority chưa duyệt phải được chốt riêng.

**Acceptance:** bank allocation → GET deposit → readiness → activation → conversion đều thấy đúng cùng khoản tiền; không double count; khoản cũ tương thích; callback lặp/race không cấp cọc hai Main; terms sai không khóa allocation; expired/late có evidence/review; không auto-refund/forfeit.

### C. Readiness có API nhưng thiếu nguồn an toàn và liên thông validator

Nguồn: handover §5/10; UC-04 A2; UC-07; UC-15..17; BF-07.

- Repository đã xét Asset NeedsRepair/UnderRepair, công tơ/baseline, contract và occupancy.
- `PropertyService.RoomReadinessAsync` nhánh MoveIn vẫn thêm `SAFETY_INCIDENT_DATA_UNAVAILABLE` vô điều kiện: phòng không có blocker khác vẫn có thể là Indeterminate.
- Incident/WorkOrder hiện đã có module, nhưng chưa được nối thành bằng chứng safety/restriction ở readiness.
- `ContractService.Readiness` kiểm signing/deposit/date/capacity/Location nhưng không gọi ngược toàn bộ các kiểm tra meter/Asset/safety của property readiness. Do đó màn hình readiness và lệnh activate chưa dùng một tập điều kiện vận hành chung. Handover API “xem điều kiện” không tự bảo đảm API ghi chặn cùng điều kiện.

**Hướng xử lý:** EXTEND read evidence và shared required guards; không tự coi mọi Incident thường là blocker. Cần chốt severity/state/restriction nào thật sự chặn Holding/MoveIn và ai gỡ.

**Acceptance:** sự cố an toàn đang mở chặn đúng branch; verified/resolved được đánh giá lại; API activate không bypass điều kiện bắt buộc; OnHold vẫn không được tính là physical occupancy.

### D. Tài sản nâng cao còn thiếu, nhưng condition và maintenance không còn thiếu toàn bộ

Nguồn: SRS UC-05 A3/A4; UC-17; GBR-12; handover §7/P3.

- Có `PATCH /assets/{id}/condition` với permission/scope/version/reason; không phải mới chỉ có permission như handover §10 mô tả.
- Có WorkOrder lifecycle và maintenance-history. Asset CRUD đã chặn ghi đè condition/status khi có WorkOrder mở, chặn chuyển scope bằng lỗi `asset_transfer_deferred`, giữ retired không revive.
- `AssetWrite/AssetDto` chưa có tracking mode, quantity, purchaseCost/purchaseDate/usefulLife. Không có Draft/Published asset template, desired inventory, physical verification/provisioning, sync run/status, replace link, transfer lifecycle hay API lịch sử tổng hợp tài sản.
- Retired có thể đặt qua `PUT /assets/{id}` khi hợp lệ; **không nhất thiết phải thêm `/retire`**. Endpoint `/history` có ý nghĩa khác maintenance-history nếu cần cả mua/lắp/kiểm kê/chuyển/thay.
- Template công việc hiện có không thay được template tài sản. JSON field/storage sẵn có cũng không chứng minh capability đã được triển khai.

**Hướng xử lý:** NEW/EXTEND capability tài sản nếu được duyệt. Template phải theo Location hoặc bộ mẫu tái sử dụng gán cho Room; đây là lựa chọn cần chốt, không khôi phục RoomType dưới tên khác. Desired inventory không được tự biến thành tài sản thật/biên bản đã xác nhận. Transfer/copy/depreciation giữ ngoài scope nếu chưa duyệt.

### E. Điện nước nâng cao chưa có

Nguồn: UC-06/20/21, GBR-07..09; Report 4 Billing Policy; handover §8/P4.

- Có FixedPerRoomPerMonth/Metered, giá theo ngày, confirmed readings/OCR suggestion, snapshot Invoice, automation và gate dữ liệu billing hiện hữu.
- Chưa tìm thấy module/API cho tariff nhiều bậc có phiên bản, quota có evidence, parent/source/common meter hierarchy, supplier bill, reconciliation preview/persist, variance review và immutable breakdown tương ứng.
- Không nên tạo `/utility-meters` riêng khi có thể mở rộng `/capture/meters`; hiện meter API còn tối thiểu, chưa thấy workflow thay công tơ đầy đủ theo mô hình Phase 4.
- Gate Finalize theo tariff/quota/source bill chỉ áp dụng sau khi xác nhận policy nào yêu cầu những dữ liệu này. Không mặc định chặn mọi hóa đơn fixed/metered hiện tại vì chưa nhập hóa đơn nhà cung cấp.
- Không tra cứu/đánh giá tính đúng pháp luật của giá điện nước trong lượt này; các ví dụ trong handover chỉ là ví dụ kỹ thuật.

**Hướng xử lý:** phân scope riêng. NEW tariff/quota/source bill/reconciliation khi thật sự cần; EXTEND meter, calculator, Invoice preview/finalize hiện có. Chốt nguồn biểu giá, rounding, period split, quota/tolerance và dữ liệu bắt buộc trước khi triển khai.

### F. Nội quy versioned còn thiếu nhưng đã có snapshot điều khoản hợp đồng

Nguồn: handover §9/P5; BF-03/04, GBR-04; MainDraftSettings hiện tại.

- Có Owner settings theo Location với `PaymentTerms`, `AdditionalTerms`, hiệu lực/version, main-draft settings hash/template hash và snapshot ký.
- Chưa tìm thấy catalog OperatingPolicy Draft/Published/versions, binding policyId/version/contentHash riêng trên Contract, đọc agreed policy, hoặc amendment dành cho thay nội quy với evidence chấp thuận.
- Renewal hiện có phục vụ gia hạn; không được tự dùng như thể đã là một module phụ lục sửa nội quy giữa kỳ.
- Inbox/announcement read receipt không phải acceptance evidence. Owner publish V2 không được tự thay nghĩa vụ Contract đã ký V1. Contract lịch sử không có bằng chứng phải thể hiện NotRecorded/Unknown.

**Hướng xử lý:** NEW phần catalog/version/binding nếu duyệt; REUSE renderer/signing/evidence/notifications. Trước đó chốt nội quy theo Location hay Room và loại thay đổi nào cần ký phụ lục.

### G. Đóng cơ sở, copy và lịch sử cấu hình

- `PUT /locations/{id}` đã có guard phòng/người ở/nghĩa vụ contract; chưa có closure preview tổng hợp Payment/refund/WorkOrder/task và thông báo lý do theo từng dependency.
- Guard hiện còn dùng sự tồn tại Resident record như bảo vệ bảo thủ. Không tự bỏ để đóng cơ sở có lịch sử; cần phân biệt lịch sử và nghĩa vụ hiện tại bằng policy được duyệt.
- Chưa có copy Location; handover đã ghi deferred, giữ nguyên trạng thái này.
- Room history đã có. Chưa thấy GET lịch sử cấu hình tổng quát cho Location/Asset/BillingPolicy có actor/reason/before-after, dù audit được lưu. Không cần route mới nếu response/version history hiện hữu đủ cho nhu cầu cụ thể.

## 6. Backlog theo capability, tránh tạo endpoint trùng

Địa chỉ bên dưới là **đề xuất thiết kế sau xác nhận**, không phải API đã triển khai hoặc cam kết tên route cuối cùng.

| Ưu tiên | Việc | Phân loại | API cần làm |
| --- | --- | --- | --- |
| P0 | Đọc cọc canonical và sửa projection allocation | FIX | Giữ holding-deposit, allocation, activation/conversion/deposit-verification hiện có; không thêm route |
| P0 | Đồng nhất generic Main/Holding conversion, price snapshot, expiry/late handling | FIX/EXTEND | Sửa luồng hiện hữu + job; detail/history đã có, không tự thêm holding-history/price-snapshot |
| P1 | Thay/gỡ Staff và giải quyết việc mở mọi loại | EXTEND | Giữ PUT/DELETE assignment, meter assignment, WorkOrder reassign; có thể cần read preview dependency trước thay/gỡ |
| P1 | Readiness/safety dùng chung guard bắt buộc | EXTEND | Giữ GET readiness + activation endpoints; không cần `/force-status` hay readiness thứ hai |
| P1 | Lịch sử/cảnh báo đóng Location | EXTEND, tùy scope | Có thể thêm `GET /locations/{id}/closure-check`, mở rộng guard PUT; không bắt buộc tạo POST deactivate |
| P2 | Bộ mẫu tài sản, desired/physical, verify, sync result | NEW/EXTEND, chờ scope mẫu | Cần draft/publish/read template; desired/inventory/verify của Room; đọc sync run. Không dùng `/room-types/...` |
| P2 | Quantity/metadata/history/replace tài sản | EXTEND/NEW | Mở rộng DTO Asset; cân nhắc history/replace. Reuse PUT Retired và PATCH condition; transfer vẫn hoãn nếu chưa duyệt |
| P2 | Tariff/quota/source bill/reconciliation | NEW/EXTEND, chờ scope | Các resource tương ứng handover §8.3 chỉ khi được duyệt; mở rộng meter và Invoice, không tạo engine song song |
| P2 | Nội quy versioned/binding/amendment | NEW/EXTEND, chờ scope | OperatingPolicy draft/publish/versions, agreed-policy read, amendment; reuse ký, lưu evidence, notification |
| Hoãn | Copy Location, khấu hao, phân ca, khôi phục Chain/RoomType | Ngoài scope hiện tại | Không triển khai từ tài liệu này |

## 7. Những điểm cần xác nhận trước triển khai

Đề xuất duyệt theo gói để tránh biến toàn bộ handover thành scope mới:

1. **Gói tính đúng hiện hữu:** cọc Holding/canonical projection, validator/conversion, expiry/late review; Staff responsibility xuyên GENERAL/meter/WorkOrder/inspection; readiness/safety. Đây là ưu tiên trước API cấu hình nâng cao.
2. **Gói tài sản:** có cần Serialized/Bulk, mua sắm, desired inventory, publish/auto-sync không? Chọn phạm vi bộ mẫu Location/Room hoặc reusable template độc lập; không RoomType. Loại việc đang thực hiện nào được tự chuyển khi đổi Staff?
3. **Gói điện nước:** giữ fixed/metered hay mở thêm công tơ tổng/tariff/quota/đối soát? Chỉ chốt tham số tiền/tolerance và gate bắt buộc khi có nguồn cấu hình được duyệt.
4. **Gói nội quy:** nội quy scope nào, thay đổi nào bắt buộc ký phụ lục? Giữ phiên bản hợp đồng đã ký, không retroactive acceptance.
5. **Policy Holding còn mở:** toàn phòng/suất ở, pending priority, partial có khóa giá không, event-time callback muộn, xử lý tiền khi hủy/hết hạn, nguồn Security Deposit. Không tự coi các lựa chọn trong handover §6.4/13 là quyết định đã duyệt; nếu đã có quyết định riêng thì cần đối chiếu và giữ quyết định đó.

Các câu hỏi này phục vụ giới hạn implementation sau khi người dùng xác nhận; không cản trở kết luận phân tích hiện tại.

## 8. Bằng chứng và giới hạn kiểm chứng

- Đã đọc toàn bộ handover, trích SRS/Design gốc tại repo và đọc các flow liên quan, controller, services, repository, runtime DI, Compact24 mapping/writer/DDL và test source liên quan.
- OpenAPI local: GET thành công; các route liệt kê ở §4 được đăng ký; không thấy `/chain`, `/room-types`, OperatingPolicy/asset-template/utility-tariff/source-reconciliation endpoints.
- **Không chạy build/unit/integration/E2E trong lượt phân tích này.** Không dùng các số pass cũ của handover để nghiệm thu source ngày 08/11. Các kết luận lỗi ở §5 là static review và cần regression tái hiện trước/sau sửa; chưa phải khẳng định đã kiểm chứng race trên runtime.
- Các file test Compact24 cho property shape, assignments, workflow regression hiện có. `ReplacingCurrentAssignmentMovesOpenGeneralTasksAtomically` chỉ chứng minh ý định bao phủ GENERAL ở source test, chưa chứng minh các loại việc khác. Handover nói “chưa có test môi trường” ngày 06/11 không được sao chép thành trạng thái hôm nay nếu chưa chạy lại.
- Không thay code, config, dependency, DB, dữ liệu, tiến trình API hoặc trạng thái jobs. Chỉ thêm báo cáo này; chưa commit/push/merge.

## 9. Chỉ mục source để review

- API: `Controllers/LocationsController.cs`, `PropertyManagement/PropertyControllers.cs`, `Operations/OperationsControllers.cs`, `StaffOperations/OperationalTasksController.cs`, `Billing/BillingAutomationController.cs`, `ContractsController.cs`, `MainDraftsController.cs`, `Ocr/CaptureController.cs`, `IncidentMaintenance/WorkOrdersController.cs` thuộc `src/backend/BHome.Api`.
- `src/backend/BHome.Application/PropertyManagement/PropertyService.cs`: SaveLocation, SaveRoom, SaveAsset, UpdateAssetCondition, RoomReadiness.
- `src/backend/BHome.Infrastructure/Modules/PropertyManagement/Persistence/PostgresRoomInsightsRepository.cs`: readiness, obligations, history, occupancy.
- `src/backend/BHome.Infrastructure/Persistence/Compact24/CompactLocationAssignments.cs`: Create/Change/ReassignOpenTasks.
- `src/backend/BHome.Infrastructure/Modules/Operations/CompactOperationsRepository.cs`: Staff employment/deactivate, HasResponsibilities, recurring templates/generation.
- `src/backend/BHome.Application/StaffOperations/OperationalTaskService.cs`: Location routing, execution, verification, evidence, responsibility synchronization.
- `src/backend/BHome.Application/Contracts/ContractHoldingService.cs`, `ContractService.cs`: approval, price lock, deposit/readiness, conversion, generic Main, signing.
- `src/backend/BHome.Infrastructure/Contracts/ContractRepository.cs`, `CompactContractHoldingLedger.cs`, `ContractExpiryProcessor.cs`: deposit/read model, applied allocation, expiry.
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24Records.cs`, `Compact24EventsAndLedger.cs`: logical projections, canonical financial persistence và guards.
- `src/backend/BHome.Application/PaymentsDebt/PaymentService.cs`, `src/backend/BHome.Infrastructure/PaymentsDebt/PaymentRepository.cs`: bank-to-deposit matching, transaction/review, amount reads.
- `src/backend/BHome.Application/Contracts/MainDraftContracts.cs`, `MainDraftService.cs`, `src/backend/BHome.Infrastructure/Contracts/MainDraftData.cs`: cấu hình điều khoản và snapshot hiện có.

