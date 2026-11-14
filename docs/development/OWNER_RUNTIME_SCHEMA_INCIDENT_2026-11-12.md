# Owner runtime — khắc phục schema drift 12/11/2026

## Nguyên nhân và ảnh hưởng

Owner Web ở localhost:5173 dùng API local kết nối Neon development qua runtime role bhome_dev01. Database có đúng 24 bảng nhưng mới áp dụng baseline InitialCompact24; code hiện tại yêu cầu 8 migration. DatabaseProbe read-only xác nhận 7 pending và /health/ready trả 503. Danh sách Contract/Invoice cơ bản vẫn tải được, các projection mới đọc cột/function chưa có thì lỗi.

| Màn hình trong ảnh                                          | Đường truy vấn bị ảnh hưởng bởi schema cũ                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Khách thuê/người ở                                          | ResidentAdministration đọc residents.contact_email chưa tồn tại                                                              |
| Chi tiết Contract, chi tiết ký số                           | Cùng tải Contract/resident detail bằng mapping mới                                                                           |
| Invoice payment, adjustment detail, payments, debts/history | Số dư/phân bổ dùng các cột settlement allocation mới                                                                         |
| Financial report                                            | Query nguồn allocation/refund và function kiểm chứng mới                                                                     |
| Incident                                                    | Badge Đã từ chối bị tô xanh do nhãn Đã khớp nhóm success; đã ưu tiên từ chối vào nhóm error, giữ nguyên quyết định nghiệp vụ |

Bảng trên đối chiếu source/schema và ảnh, không tuyên bố đã quan sát từng HTTP request trong Chrome của người dùng. Operator credential local cũ bị từ chối; sau khi người dùng cung cấp cấu hình hợp lệ, chỉ cập nhật operator Direct trong .env.neon bị Git bỏ qua. Runtime role/connection và giới hạn quyền giữ nguyên. TLS VerifyFull/ChannelBinding Require.

## Đã sửa

Sao lưu private custom-format bằng PostgreSQL client 18.6, kiểm tra archive index và chụp row count/digest trước nâng cấp. Áp dụng 7 migration hiện có trong một transaction, không reset/reseed hoặc viết lại financial/identity records. History sau cập nhật đủ 8 migration và không có migration lạ.

Định dạng function body do bản EF CLI local xuất idempotent script thêm indentation làm strict verifier chưa đạt. Đối chiếu từng function: chỉ cho phép khớp canonical hoặc khớp chính xác canonical được thêm indentation của generator; 11 function chỉ khác định dạng được đưa về definition canonical trong transaction riêng. Không nới lỏng verifier hoặc thay logic tiền/quyền. Quy trình operator cập nhật dùng EF database update; script nâng transaction trong regression dùng non-idempotent SQL đúng FROM/TO. Lượt psql đầu bị PowerShell coi NOTICE là lỗi đã rollback, kiểm tra history vẫn chỉ baseline rồi mới chạy lại; không có partial migration bị bỏ qua.

Đối chiếu dữ liệu trước/sau: 22/24 bảng giữ nguyên count/digest sau khi bỏ các cột mới khỏi phép so sánh. Notifications và refresh_tokens thay đổi trong lúc ứng dụng vẫn chạy; ghi nhận riêng, không rollback hoạt động đồng thời. Contract, Resident, Invoice/items, Payment/allocation, Refund, signing và các nguồn tài chính cũ không đổi. Backup/connection secrets/log private nằm ngoài Git trong .tools/schema-repair-20261112/database-backups; không sao chép dữ liệu thực vào tests hoặc báo cáo.

API phân biệt undefined column/table/function bằng sanitized HTTP 503/code database_schema_incompatible thay vì 500 chung. Response không chứa SQL/tên cột/exception; lỗi khác và authorization giữ mapping hiện hành. Owner error formatters hiển thị cần quản trị viên đồng bộ hệ thống. DatabaseProbe in pending migration IDs; Update-NeonDatabase mặc định Release để tránh ghi đè DLL Debug đang chạy trong Visual Studio.

## Bằng chứng đã chạy

- Live API /health/ready: 503 trước sửa → 200 Healthy sau sửa.
- DatabaseProbe qua runtime bhome_dev01: Compact24 PASS, applied=8/pending=0/unknown=0, RuntimeEFQuery PASS; không đọc Tenant records trong probe.
- Operator migrations list bằng script cập nhật: build PASS, đủ 8 applied.
- Backend Release build: 0 warning/error.
- Nhóm schema upgrade/API error contract/probe/baseline: 45 PASS, không SKIP sau sửa cuối. Có một lượt test SQL qua EF Raw bị FormatException vì braces trong SQL; đổi sang NpgsqlCommand trong transaction và chạy lại toàn bộ 45 ca, không tính lượt FAIL là PASS.
- Nhóm route audit/resident/payment/finance/digital signing: 51 PASS, không SKIP; database disposable và dữ liệu synthetic.
- Full Owner Web: 338 PASS/68 files, gồm 2 ca mới về thông báo schema và giữ permission failures. Test file mới được đổi sang .test.tsx để đúng discovery config; lượt targeted trước đó chưa bao gồm file .test.ts, không coi các ca chưa chạy là PASS.
- Owner/Mobile typecheck, changed-file ESLint, dotnet format verify, Prettier và git diff check PASS. Sửa badge Đã từ chối từ xanh success sang nhóm error; không thay trạng thái Incident.
- Owner production build PASS; còn cảnh báo kích thước bundle trên 500 kB, không phải lỗi runtime/schema và chưa đo performance mới trong lần sửa này.

Computer Use đã dừng vì không xác định được URL Chrome hiện tại đủ chắc chắn. Không tiếp tục thao tác UI hoặc vượt chặn; không tuyên bố đã duyệt lại mọi màn hình trong phiên Chrome. Browser/native/provider acceptance ngoài phạm vi xác minh HTTP/schema và regression đã chạy.
