# Ký số hợp đồng — cập nhật 30/10/2026

## Kết luận và quyết định được ghi nhận

Đã có UI ký hợp đồng trên Owner Portal và mobile Owner/Tenant, cùng adapter Viettel MySign.
Lượt này nối bộ ký PDF iText vào DI backend chính và hoàn thiện quản lý chứng thư.
**Chưa nghiệm thu ký hợp đồng thật**; còn các đầu vào thiết kế và môi trường dưới đây.

Người yêu cầu đã trả lời trong phiên làm việc ngày 30/10/2026:
“Phê duyệt iText; tôi sẽ cung cấp mẫu và quy trình xác minh đã duyệt”.

Đây là phê duyệt lựa chọn thư viện hiện có, không phải bằng chứng đã có giấy phép triển khai,
mẫu hợp đồng, trust profile hoặc quy trình xác minh chủ chứng thư được phê duyệt.
Q-S2 trong gap analysis được đóng **phần chọn implementation**, các phần còn lại chưa được đóng.
Không thay ký từ nhà cung cấp bằng ảnh chữ ký/OTP hoặc sinh khóa ký trong runtime BHOME.

## Nguồn và truy vết

Đã đọc `AGENTS.md`, `docs/api/API_CONVENTIONS.md`, source, test, tài liệu lifecycle/gap analysis,
và nội dung DOCX thực tế tại:

- `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`: UC-15/16,
  API-03, màn hình trạng thái ký, GBR-04, DBR-03; phạm vi Owner/Staff/Tenant và NFR bảo mật.
- `docs/reports/Report-4_Software Design Specification (5).docx`: tích hợp provider ngoài,
  layered backend và giữ Pending Signing khi provider lỗi.
- [CONTRACT_DOD_GAP_ANALYSIS.md](CONTRACT_DOD_GAP_ANALYSIS.md): G03, Q-S1/S2/S3.

| Yêu cầu                                      | Source/lớp ảnh hưởng                                               | Tiêu chí chấp nhận                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| BF-03/BF-04, FE-03, UC-15/16, GBR-04, DBR-03 | Infrastructure DI → IPdfSigner → iText                             | Runtime backend thật chuẩn bị/ghép hai chữ ký tuần tự, xác minh tính toàn vẹn và từ chối sai khóa; không gọi provider thật trong test         |
| GBR-01/02, NFR quyền riêng tư                | Certificate controller/service/store hiện có → client → web/mobile | Chỉ xem và khóa chứng thư của chính mình; Staff/anonymous bị chặn; không đưa mã thuê bao đầy đủ vào mutation khóa; audit tại server           |
| UC-15/16, NFR lỗi tích hợp                   | Form ký, hook danh sách chứng thư, renderer                        | Không gửi khi đang tải/tải lỗi/chưa chọn/chứng thư khóa hoặc hết hạn; lỗi không hiển thị thành công; bỏ phản hồi cũ sau đổi client hoặc retry |
| GBR-04, API-03                               | Renderer hiện chưa cấu hình → ProblemDetails → client              | Thiếu mẫu được duyệt trả 503 có code rõ ràng, không tạo PDF pháp lý tùy ý hoặc kích hoạt hợp đồng                                             |

## Thay đổi và cách dùng

- `src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj`, `DependencyInjection.cs`:
  tham chiếu DigitalSigning.Infrastructure và gọi `AddContractPdfSigning()`.
- `src/digital-signing/BHome.DigitalSigning.Infrastructure/DependencyInjection.cs`:
  registration riêng cho PDF; giữ nguyên certificate store, BHomeDbContext, MySign client và quyền
  của backend chính. Không gọi `AddDigitalSigning()` để tránh đăng ký luồng sandbox/settings khác.
- `ViettelMySignContractAdapter.cs`: bỏ UnconfiguredContractPdfSigner; renderer trả code
  `contract_template_not_configured`. Không tạo template thay cho quyết định Q-S1.
- `packages/client-core/src/contracts.ts`, `useSigningCertificates.ts`: gọi API khóa hiện có,
  kiểm tra hiệu lực, hiển thị lỗi, hủy request và bỏ phản hồi cũ. Dữ liệu chỉ trong bộ nhớ phiên.
- Owner web: `ContractDetailPanel.tsx`, `ContractActionDialog.tsx`, `SigningCertificates.tsx`.
  Vào **Hợp đồng → chọn hợp đồng → Chữ ký và tài liệu → Khai báo chứng thư MySign của bạn**.
  Có danh sách, hạn dùng, trạng thái, khai báo, tải lại, khóa/mở khóa. Form ký xóa lựa chọn khi tải lại.
- Mobile: `ContractActionForm.tsx`, hiển thị qua `ContractScreen` hiện có cho đúng Owner/Tenant
  là bên ký. Có quản lý chứng thư tương tự; phải chọn chứng thư và xác nhận nội dung trước gửi.
- Không migration hoặc thay schema/state/role. Không thay chính sách tiền cọc/kích hoạt.
  Khóa chứng thư không tự hủy request MySign đang chờ; server vẫn kiểm tra yêu cầu ký mới.

## Xác minh

| Lệnh đã chạy                                                                                                                                                                                                                                    | Kết quả                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet test src/backend/BHome.sln --filter FullyQualifiedName~Contracts --verbosity minimal`                                                                                                                                                   | PASS: 24 Application UT và 21 IT tại thời điểm chạy; Domain không có test khớp filter. Build các project backend thành công. Sau đó bổ sung test xuyên API bên dưới. |
| `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --filter FullyQualifiedName~Contracts --verbosity minimal`                                                                                                      | PASS cuối: 22/22, gồm 19 lifecycle IT trên PostgreSQL/MinIO disposable và 3 test composition/PDF. Không cộng lại 21 IT của lượt trước.                               |
| `dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests/BHome.DigitalSigning.UnitTests.csproj --verbosity minimal`                                                                                                                | PASS: 41/41; provider HTTP được giả lập.                                                                                                                             |
| `npm.cmd run test --workspace src/owner-web`                                                                                                                                                                                                    | PASS: 68/68.                                                                                                                                                         |
| `npm.cmd run test --workspace src/mobile`                                                                                                                                                                                                       | PASS: 136/136; component mobile dùng DOM/mock native, không phải native E2E.                                                                                         |
| `npm.cmd run build --workspace src/owner-web`                                                                                                                                                                                                   | PASS: TypeScript và Vite production build.                                                                                                                           |
| `npm.cmd run typecheck --workspace src/owner-web` và `npm.cmd run typecheck --workspace src/mobile`                                                                                                                                             | PASS cả hai.                                                                                                                                                         |
| `npm.cmd run lint --workspace src/mobile`                                                                                                                                                                                                       | PASS.                                                                                                                                                                |
| `npm.cmd exec -- eslint packages/client-core/src/contracts.ts packages/client-core/src/useSigningCertificates.ts src/owner-web/src/features/contracts tests/mobile/ocr/contracts.test.ts tests/mobile/ocr/signing-ui.test.tsx --max-warnings 0` | PASS.                                                                                                                                                                |
| Prettier trên các file TS/TSX/Markdown thay đổi; `git diff --check`                                                                                                                                                                             | PASS.                                                                                                                                                                |

`ProductionAdapterAndPdfSignerCompleteTwoPartyContractThroughApiWithSyntheticRemoteCa`
dùng adapter production + iText đăng ký thật + API JWT + PostgreSQL/MinIO thật trong container.
Chỉ provider CA và renderer được thay bằng phiên bản tổng hợp nằm trong project test;
khai báo hai chứng thư, ký/replay cùng key, sync, xác minh cọc, kích hoạt, tải PDF,
xác minh cả hai chữ ký và từ chối Staff tải tài liệu. Provider chỉ nhận đúng hai request ký.
Đây là kiểm thử xuyên API với provider giả lập, **không phải MySign thật hoặc mẫu hợp đồng đã duyệt**.

Các lần chạy lỗi đã xử lý:

- Lần đầu test certificate API không khởi tạo được fixture vì Docker chưa chạy.
  Đã khởi động Docker Desktop và chạy lại toàn bộ contract IT thành công với daemon 29.7.2.
- Test mới ban đầu bị analyzer `xUnit2031` chặn build do `Where` trước `Assert.Single`.
  Đã dùng overload có predicate và chạy lại 22 IT thành công.
- PowerShell chặn `npm.ps1`; các lệnh hoàn tất dùng `npm.cmd`, không đổi execution policy.

Môi trường thực thi: .NET SDK 8.0.427, Node 24.22.1 trên Windows. Repo khai báo Node 22;
chưa kiểm chứng lại trên Node 22. Không có tuyên bố coverage, performance hoặc đầy đủ toàn bộ BF-03/04.

## Phần còn chặn và chưa kiểm chứng

1. Q-S1: chờ mẫu PDF hợp đồng được duyệt, trường bắt buộc và quy trình Owner review.
   Renderer vẫn chặn; không nhận PDF tùy ý từ client để thay snapshot điều khoản trên server.
2. Q-S3: chờ quy trình xác minh BHOME actor ↔ chủ chứng thư MySign được duyệt.
   Luồng khai báo hiện tại chỉ gắn chứng thư provider trả về với actor; không được xem đó
   là bằng chứng hoàn tất xác minh danh tính của subscriber.
3. Phần còn lại Q-S2: trust anchors, revocation/timestamp và tiêu chí xác minh cần được chốt.
   Kiểm tra CMS/PDF trong test chỉ chứng minh tính toàn vẹn, không chứng minh CA được tin cậy
   hoặc hiệu lực pháp lý của hợp đồng.
4. Cần môi trường MySign, cấu hình qua user-secrets/biến môi trường và tài khoản thử được phép
   cho hai bên ký. Không yêu cầu gửi secret hoặc CCCD thật qua chat. Chưa gọi MySign thật.
5. Chưa chạy native E2E iOS/Android, mở PDF bằng Adobe/Foxit hoặc E2E hợp đồng với provider thật.

Rollback phần DI: bỏ reference DigitalSigning.Infrastructure và phục hồi registration chặn PDF
từ revision trước; không cần rollback database. Không bật sandbox/fake CA trong backend thật.
