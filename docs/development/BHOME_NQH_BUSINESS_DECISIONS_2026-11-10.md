# Quyết định nghiệp vụ BHOME ngày 10 tháng 11 năm 2026

Nguồn phê duyệt: yêu cầu “FULL IMPLEMENTATION, BUSINESS ALIGNMENT, E2E COMPLETION & PHASED LOCAL COMMITS” do chủ dự án cung cấp trong hội thoại. Văn bản này ghi nhận thay đổi, không sửa nguyên bản các report.

| BR  | Quyết định có hiệu lực                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | Tạo/activate Tenant account sau Main Active; Tenant mới ký trước login                                                                                       |
| 02  | Owner approve/initiate account invitation; system dispatch thay Owner sau activation được phép                                                               |
| 03  | Nhận lời mời/đặt mật khẩu Web và Mobile cùng backend lifecycle                                                                                               |
| 04  | Mỗi actual occupant có account sau activation; family representative/co-occupant và friends separate contracts giữ nguyên                                    |
| 05  | Email bắt buộc từng occupant, kiểm format/uniqueness/conflicting association                                                                                 |
| 06  | Eligible room tenants nhận invoice notification, xem/pay shared invoice/debt; Tenant ngoài phòng không được truy cập                                         |
| 07  | Anonymous expiring signing invitation → OTP → exact PDF → consent/drawn evidence; Owner ký/confirm; phân biệt INTERNAL_OTP_DRAWN và MYSIGN_SANDBOX/simulator |
| 08  | Owner-configured Holding expiry; chưa có maximum được duyệt                                                                                                  |
| 09  | Holding chỉ effective sau signing conditions và full verified deposit                                                                                        |
| 10  | Tenant voluntary cancel forfeits Holding; Owner không giao phòng phải external refund được Owner xác minh với evidence                                       |
| 11  | 100% eligible Holding Deposit → Security Deposit một lần; thiếu phần còn lại không Main Active                                                               |
| 12  | Confirmed meter readings visible trước Draft; notification in-app/email; OCR proposal không public                                                           |
| 13  | Partial-month rent theo signed terms/effective approved Owner policy, không tự chọn proration                                                                |
| 14  | Final readings bắt buộc; delta từ latest billable confirmed baseline; không bill double                                                                      |
| 15  | Final charges nằm trong settlement receivables; không tạo standalone Final Settlement Invoice                                                                |
| 16  | Mọi adjustment category được phép đều cần Owner approval; giữ original Final                                                                                 |
| 17  | Auto bank sandbox khi có cấu hình/access, manual Owner fallback; cùng canonical ledger                                                                       |
| 18  | Overpayment refund cho actual payer; không Tenant Credit                                                                                                     |
| 19  | Shared debt thuộc Room; payer riêng; giữ historical responsibility sau move-out                                                                              |
| 20  | Explicit Owner-approved source-specific auditable/idempotent Security Deposit offset                                                                         |
| 21  | Damage là distinct receivable; deposit application là effect riêng; không ghi damage hai lần                                                                 |
| 22  | Debt > available deposit vẫn là payable receivable, eligible room tenants có thể trả                                                                         |
| 23  | Physical release không đợi mọi debt/refund hoàn tất; remaining legitimate occupancy chặn release                                                             |
| 24  | Chỉ Tenant initiate early termination; Owner xử lý hoặc initiate expiry/non-renewal đúng policy                                                              |
| 25  | End departing occupancy/current-room association; giữ history; không đẩy remaining occupants ra khỏi phòng                                                   |
| 26  | Owner Mobile monitoring/notifications/status/navigation; complex finance chỉ Owner Web                                                                       |
| 27  | Retention duration chưa duyệt; configurable metadata/holds/audit, không irreversible deletion khi chưa phê duyệt                                             |
| 28  | Configured recurring residence reminders, Owner/Tenant only; dedupe; stop completed/legitimately closed; no VNeID submission                                 |
| 29  | Development/Testing demo với real MySign/bank sandbox; simulator/manual fallback không được báo sandbox PASS                                                 |

Thay thế rõ các yêu cầu cũ: external-only signing không còn là mode duy nhất; account-before-signing bị bỏ; invoice credit không triển khai; physical Room release không còn phụ thuộc financial completion; OQ-08 email và OQ-02 Owner approval được giải quyết bởi BR-05/06/16. Không thêm Owner unrestricted early termination hoặc full Mobile finance.

## Quyết định còn mở và verification blockers

| ID      | Nội dung                                       | Trạng thái / cách xử lý                                                                           |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| OPEN-01 | Holding maximum duration                       | Chưa duyệt; dùng Owner explicit expiry tương lai, không tự đặt 3/7/15 ngày                        |
| OPEN-02 | CCCD retention/deletion duration, start basis, financial record scope và legal hold | Chưa duyệt; Owner metadata/hold/review đã chuẩn bị, mọi view CanDelete=false; không auto delete |
| OPEN-03 | Residence deadline/reminder cadence            | Dùng existing explicit configuration; chưa cấu hình thì báo cần Owner thiết lập, không tự định kỳ |
| EXT-01  | Bank provider/API docs/credentials/sandbox     | Người dùng chưa có, sẽ bổ sung; provider-specific implementation/live verification bị chặn        |
| EXT-02  | MySign sandbox account/credential access       | Người dùng chưa có; reuse adapter, không fake live result                                         |
| EXT-03  | Email/SMS delivery credentials                 | Người dùng chưa có; secure configured delivery boundary, actual delivery BLOCKED                  |

Không commit secrets, raw OTP/signing tokens, passwords, real CCCD hoặc financial private data. Chỉ synthetic test fixtures.
