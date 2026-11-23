# FE-09 — Triển khai và kiểm chứng local

## Căn cứ và phạm vi

Yêu cầu đính kèm ngày 22/11/2026; SRS hiện có tại `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, §III.9.1–9.2, UC-37 (Owner xuất bản), UC-38 (Guest xem), GBR-17; GBR-01/02 và GBR-18 cho quyền và thao tác lặp. Master UC trong bản SRS local mới hơn cách gọi UC-37 trong AGENTS: dùng mapping thực tế trên. Không có file quy tắc Git riêng trong các file được Git theo dõi; tuân thủ §0 được ghi trong AGENTS. Nhánh ban đầu `member/QHuy`, HEAD `a0a3711e3ee1c78215c7b0c671260bb6d0baa3e6`, working tree sạch.

## Audit trước thay đổi

| Feature                                         | Implemented                                     | Missing                                          | Bug                                                             | Reuse                              | Files                                |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| Owner chọn cơ sở/phòng, lưu, publish, unpublish | Có code, chưa chạy lại                          | Nhóm nội dung, bảo vệ draft khi đổi lựa chọn     | Không thể publish lại nội dung đã publish                       | Picker, query/action, confirmation | PublicContentApiPage.tsx             |
| Draft/Published/Hidden                          | Chỉ public_profile + published_at               | Snapshot đã duyệt                                | Save làm đổi Guest ngay                                         | JSON profile, transaction/row lock | CompactOperationsRepository.cs       |
| Album                                           | Upload/private preview/delete, 20 ảnh, 5 MB     | Đại diện/thứ tự                                  | URL dùng vị trí album, ảnh có thể bị thay bằng ảnh khác sau xóa | Storage validator, owner preview   | OperationsService.cs, repository     |
| Guest DTO/quyền                                 | DTO whitelist, chặn unpublished/parent inactive | Regression phủ đầy đủ                            | Cache công khai 60 giây                                         | Endpoint hiện có                   | OperationsControllers.cs             |
| Vacancy                                         | Dùng status phòng từ backend                    | Bốn nhãn chính xác                               | Gộp OnHold/Occupied thành Unavailable                           | RoomStatus model                   | Repository                           |
| Guest pages                                     | Có home/list/detail, feedback, ảnh retry        | Search/filter/card/pagination/SEO/contact ở room | Home chỉ có lời chào                                            | React Query, MUI, router           | PublicContentPages.tsx, HomePage.tsx |
| CI                                              | Backend/frontend/release gates có sẵn           | Browser suite chưa nằm trong CI                  | Cần kiểm tra thực thi                                           | ci.yml, browser tests              | .github/workflows/                   |

## Traceability và kế hoạch

| Yêu cầu → nguồn                                  | Thành phần/dữ liệu                                                                  | Acceptance/negative tests                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Owner duyệt rõ ràng → UC-37, §9.1, GBR-17        | public_profile draft + published snapshot; PUT/POST cũ                              | Save không đổi Guest; publish lại; hidden không truy cập; lặp an toàn        |
| Guest chỉ xem whitelist → UC-38, §9.2, GBR-01/17 | Guest DTO, photo proxy, parent visibility                                           | Anonymous/Staff từ chối preview; không object key/PII; cache no-store        |
| Album, giá, tiện ích → §9.1–9.2 + yêu cầu mới    | PhotoOrder tùy chọn trên PUT; stable photo index, ảnh đầu là đại diện               | Thứ tự hợp lệ, xóa không tráo URL, ảnh mới chưa public                       |
| Search/room status → §9.2                        | Lọc trên tập dữ liệu công khai hiện có, phân trang UI; status DB cập nhật trực tiếp | Search tên/địa chỉ; giá/sức chứa/tiện ích/status; unknown không coi là trống |

Triển khai tuần tự: snapshot/quyền/album → Owner editor → Guest pages → regression → CI tương đương local → báo cáo A–G. Không đổi business status hay quy tắc thanh toán/hợp đồng. Không commit/push/deploy.

Ảnh bị Owner xóa là thu hồi rõ ràng: gỡ khỏi cả draft và snapshot đã duyệt ngay; URL cũ trả 404. Save/reorder/upload chỉ tác động draft. Snapshot JSON được backfill bằng EF migration, không thêm bảng/cột; cần áp dụng migration trước khi chạy phiên bản mới.

## A. Implementation Summary

Triển khai ngày 22–23/11/2026, chỉ local. Tái sử dụng toàn bộ route Owner/Guest,
permission `PublicContent.Publish`, private storage/image validation, MUI, React
Query, picker và confirmation hiện có.

- `public_profile` tiếp tục là draft; khóa `published` chứa snapshot Owner đã
  duyệt. Save không đổi Guest; publish lại cập nhật snapshot; unpublish giữ nội
  dung. DTO bổ sung `publicationStatus` cho Draft/Published/Hidden, giữ trường cũ.
- Room publish khóa parent trước room; parent phải hoạt động/đã xuất bản. Gỡ
  parent gỡ publication của phòng và giữ lịch sử. Public status đọc trực tiếp
  trạng thái Room vận hành; không thay đổi quy tắc hợp đồng/thanh toán.
- Album dùng index ổn định và `photoOrder` tùy chọn trên PUT hiện có; ảnh đầu là
  đại diện. Upload/reorder chỉ đổi draft; xóa là thu hồi ngay. Không trả object key.
- Owner editor chia nhóm, giữ draft trong bộ nhớ theo từng cơ sở/phòng, kiểm tra
  email/tiện ích, chặn publish chưa lưu, preview qua API Owner và ảnh có xác thực,
  retry ảnh và confirmation cho mutation.
- Guest home/catalogue/card/detail, breadcrumb, liên hệ tĩnh, bản đồ theo địa chỉ,
  title/description, skeleton/empty/error/retry và nhãn status rõ. Search tên/địa
  chỉ/tiện ích cơ sở; search/phòng, giá tối đa, status, sức chứa và tiện ích trong
  cơ sở. Phân trang UI: 9 cơ sở/6 phòng; tự chọn trang còn tồn tại khi dữ liệu phòng giảm và có nhãn phân trang tiếng Việt. Không thêm Guest mutation.
- Public content/photo `no-store`; query cache được giải phóng khi unmount và
  refetch khi focus. Browser CI trở thành bước bắt buộc trong job frontend.

## B. Files Changed

| File                                                                                                         | Mục đích/phạm vi                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                                                                                   | Cài Chromium và chạy Public browser suite sau build; giữ tất cả gate cũ                                 |
| `docs/api/API_CONVENTIONS.md`                                                                                | Contract draft/snapshot/status/photo order/cache và compatibility                                       |
| `docs/development/FE09_IMPLEMENTATION_2026-11-22.md`                                                         | Audit, traceability, quyết định triển khai, bằng chứng và giới hạn                                      |
| `src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs`                                      | Public response no-store                                                                                |
| `src/backend/BHome.Application/Operations/OperationsContracts.cs`                                            | PhotoOrder tùy chọn, PublicationStatus bổ sung, từ chối null mô tả                                      |
| `src/backend/BHome.Application/Operations/OperationsService.cs`                                              | Từ chối phần tử tiện ích null, tránh lỗi 500                                                            |
| `src/backend/BHome.Infrastructure/Modules/Operations/CompactOperationsRepository.cs`                         | Snapshot, row lock, parent visibility, stable album IDs/order/revocation, status                        |
| `src/backend/BHome.Infrastructure/Persistence/Compact24/Migrations/20261122000100_PublicContentSnapshots.cs` | EF migration backfill JSON, giữ dữ liệu hiện tại, không đổi schema                                      |
| `src/owner-web/src/features/public-content/PublicContentApiPage.tsx`                                         | Editor/preview/album/draft preservation/validation                                                      |
| `src/owner-web/src/features/public-content/PublicContent.test.tsx`                                           | Owner component regression                                                                              |
| `src/public-web/src/app/providers/AppProviders.tsx`                                                          | Public cache lifetime/refetch                                                                           |
| `src/public-web/src/features/home/pages/HomePage.tsx`                                                        | Home gắn catalogue thật, không số liệu/ảnh giả                                                          |
| `src/public-web/src/features/home/pages/PublicContentPages.tsx`                                              | Catalogue/filter/pagination/detail/contact/SEO/states                                                   |
| `src/public-web/src/features/home/pages/publicPresentation.ts`                                               | Nhãn status Guest, unknown không là Available                                                           |
| `src/public-web/src/features/home/pages/PublicContentPages.test.tsx`                                         | Search/price/status và feedback regression                                                              |
| `src/public-web/src/layouts/PublicLayout.tsx`                                                                | Footer tiếng Việt/liên hệ, focus trắng trên AppBar                                                      |
| `src/public-web/src/theme/theme.ts`                                                                          | Focus/link/selection phù hợp nền sáng                                                                   |
| `src/public-web/tests/public.browser.test.ts`                                                                | 3 viewport, filter, ảnh approved, keyboard focus, giữ rejection/retry cũ                                |
| `tests/backend/BHome.IntegrationTests/Compact24/OwnerPublicContentPreviewTests.cs`                           | Snapshot/migration/parent/status/whitelist/permission/album regression                                  |
| `src/owner-web/src/hooks/useOwnerWorkspace.ts`                                                               | Thông báo lỗi cơ sở ngừng hoạt động/thứ tự ảnh đã thay đổi                                              |
| `tests/backend/BHome.IntegrationTests/Compact24/Compact24MigrationBaselineTests.cs`                          | Kê đầy đủ migration FE-09 trong strict migration inventory, giữ nguyên kiểm tra snapshot/runtime/schema |

Không sửa mobile, client-core, dependencies, secret hoặc file cấu hình môi trường.

## C. Feature Completion Matrix

| Feature                  | Before                                 | After                                                              | Evidence                                                    |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Owner chọn cơ sở/phòng   | Có picker                              | Tái sử dụng, giữ draft khi chuyển record                           | Owner component + browser fixture                           |
| Save draft               | Đổi luôn Guest nếu đã published        | Guest giữ snapshot đã duyệt                                        | PostgreSQL snapshot tests cho Location và Room              |
| Publish/unpublish        | Có, UI chặn publish lại                | Publish lại, parent active/published, status rõ, giữ draft         | PostgreSQL publication/parent/repeated-operation tests      |
| Album                    | Index theo vị trí, xóa có thể tráo URL | Index ổn định; cover/order draft; xóa thu hồi ngay                 | PostgreSQL album + Owner upload/delete + Guest proxy decode |
| Owner preview            | Văn bản cơ bản                         | Nhãn private, địa chỉ, gallery, mô tả, giá/status/contact          | Owner authorized-photo integration + component/browser      |
| Public DTO/privacy       | Có whitelist                           | Giữ whitelist, bổ sung status; no-store cả ảnh                     | Exact DTO field assertion, permission/photo tests           |
| Room vacancy             | Available hoặc Unavailable             | Đủ 4 trạng thái live backend; Unknown an toàn                      | 4 PostgreSQL status cases, UI labels                        |
| Home/list/detail         | Home tĩnh, list dạng text              | Catalogue, card, detail/contact/SEO và feedback                    | Public component/browser                                    |
| Search/filter            | Chưa có                                | Location search/amenity; Room search/price/status/capacity/amenity | Unit/component + browser 3 viewport                         |
| Responsive/accessibility | Một số basic checks                    | 1440/768/390, focus có tương phản, ảnh fallback/retry              | Screenshot/bounded review + keyboard assertion              |
| Browser CI               | Chưa thuộc gate                        | Chromium + test:browser trong frontend                             | Workflow diff; local browser suite                          |

## D. Testing Results

Các số bên dưới là kết quả chạy thực tế; các lượt rerun không được cộng vào tổng unique tests.

| Test Suite                                                   | Passed | Failed | Skipped | Blocked | Evidence                                                                                 |
| ------------------------------------------------------------ | -----: | -----: | ------: | ------: | ---------------------------------------------------------------------------------------- |
| Owner toàn bộ, mã cuối                                       |    931 |      0 |       0 |       0 | .tools/fe09/owner-all-final.json, native exit 0                                          |
| Owner FE-09 component (subset)                               |      8 |      0 |       0 |       0 | .tools/fe09/owner-fe09.log                                                               |
| Mobile toàn bộ                                               |   1612 |      0 |       0 |       0 | .tools/fe09/mobile-final.json, native exit 0                                             |
| Public component                                             |     10 |      0 |       0 |       0 | .tools/fe09/public-final.json, native exit 0                                             |
| Public browser                                               |     16 |      0 |       0 |       0 | .tools/fe09/public-browser-final.log; .tools/full-validation/public-browser-results.json |
| Owner browser fixture, 3 viewport                            |      3 |      0 |       0 |       0 | .tools/fe09/owner-browser-result.json                                                    |
| Application Unit (CI filter)                                 |    686 |      0 |       0 |       0 | .tools/fe09/recheck-ci-trx, application DLL                                              |
| Domain Unit (CI filter)                                      |    115 |      0 |       0 |       0 | .tools/fe09/recheck-ci-trx, domain DLL                                                   |
| Infrastructure Unit                                          |    149 |      0 |       0 |       0 | .tools/fe09/infrastructure-trx/infrastructure.trx                                        |
| Digital signing Unit                                         |     41 |      0 |       0 |       0 | .tools/fe09/signing-trx/signing.trx                                                      |
| Backend Integration — final CI filter                        |   1414 |      0 |      32 |       0 | .tools/fe09/recheck-ci-trx, integration DLL; native exit 0                               |
| Backend Integration — lượt đầu                               |   1410 |      3 |      33 |       0 | .tools/fe09/final-ci-trx; lỗi đã sửa/rerun, giữ bằng chứng                               |
| Migration/baseline + FE-09 sau sửa                           |     19 |      0 |       0 |       0 | .tools/fe09/after-fix-trx/after-fix.trx                                                  |
| OwnerResident fixture rerun                                  |      2 |      0 |       0 |       0 | .tools/fe09/fixture-retry-trx/fixture-retry.trx                                          |
| Compact24 independence, statement log không chứa bind params |      1 |      0 |       0 |       0 | .tools/fe09/independence-trx/independence.trx                                            |
| Deployment Python                                            |     34 |      0 |       0 |       0 | .tools/fe09/deployment-tests.log                                                         |
| Deployment Node                                              |     20 |      0 |       0 |       0 | .tools/fe09/deployment-tests.log                                                         |

Lượt toàn frontend đầu tiên trước test upload mất phản hồi: Owner 930/Mobile 1612/Public 9 pass. Sau bổ sung, đã chạy lại toàn Owner (931), Mobile và Public; các JSON final ở trên có success=true. Public sau đó bổ sung case pagination khi refetch giảm số kết quả: final 10/10, browser rerun 16/16; tổng unique frontend unit/component là 2553. Diagnostic jsdom getContext từ OwnerSigningPanel (file không sửa) không gây failed test; lượt cuối dùng cmd wrapper để lưu đúng native exit code, tránh PowerShell diễn giải stderr thành lỗi shell.

Lượt backend rộng đầu tiên phát hiện strict migration inventory thiếu migration FE-09 (đã cập nhật đúng ID, không bỏ assertion). Nhóm 19 case sau sửa pass, gồm 8 migration/baseline và 11 FE-09. Hai case OwnerResident ban đầu timeout ở bước khởi tạo schema fixture, trước test body; rerun riêng giữ nguyên timeout/assertion đã pass 2/2. Đây là bằng chứng lỗi fixture tạm thời; không coi là một lỗi nghiệp vụ FE-09 đã tái hiện.

Kiểm tra không có số lượng test: restore/build solution, shared package/Owner/Public build và typecheck, mobile typecheck/export, ESLint toàn repo, dotnet format, SePay script guards, Docker Compose config, shell syntax guards, 3 Docker image Linux (npm ci/build/Verify-WebArtifact) đã thực thi; bảng CI local cuối ghi trạng thái hoàn tất.

Backend CI final toàn bộ: **2405 passed, 0 failed, 32 skipped / 2437 selected**, native exit **0**. Lượt trước: 2401 passed, 3 failed, 33 skipped. 32 skip cuối: 19 OCR model/probe opt-in, 9 SMTP/Mailpit/email-browser opt-in, 3 real-API browser opt-in, 1 wrapper move-out đã được bao phủ bởi Compact24ContractRegressionTests.MoveOutDraft. Danh sách từng test và lý do nguyên văn: `.tools/fe09/skipped-tests.json`. Không test FE-09 nào bị skip. Compact24 independence ban đầu thiếu statement-log nên skip; đã bật log không chứa bind params, chạy riêng 1/1 pass và final CI cũng chạy/pass.

## E. CI Verification — điều kiện và skip có chủ đích

| Workflow/Job                                   | Pre-push Local Check                                                                                                         | GitHub CI Status | Notes                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| CI/backend                                     | PASS: restore, build Release (0 warning/error), full CI-filter test, format, SePay guards, signing tests                     | NOT RUN          | Final full native exit 0; 32 opt-in skips được phân loại                                      |
| CI/frontend                                    | PASS: lint, typecheck, unit/component, shared/Owner/Public build, Mobile export, Public browser, format và deployment guards | NOT RUN          | 2553 unit/component pass; 16 Public browser; 3 Owner browser fixture                          |
| CI/build-staging-images                        | PASS: API, Owner, Public image local                                                                                         | NOT RUN          | Không push image; npm ci/build Linux và Verify-WebArtifact qua Web.Dockerfile                 |
| CI/MinIO + LibreOffice dependency images       | REUSED local images                                                                                                          | NOT RUN          | Không build lại dependency image không đổi; integration dùng image đã có như fixture cấu hình |
| CI/release + release/images                    | NOT RUN                                                                                                                      | NOT RUN          | Cần push develop/main; yêu cầu hiện tại cấm push                                              |
| Release/staging, production-policy, production | NOT RUN                                                                                                                      | NOT RUN          | Không deploy; giữ branch/flag/approval boundary                                               |
| Production-plan/prepare                        | NOT RUN                                                                                                                      | NOT RUN          | Không có yêu cầu chạy plan với main release SHA                                               |

Đã đọc đầy đủ ba workflow `.github/workflows/{ci,release,production-plan}.yml`.
Không có path filter che FE-09. `ci.yml` chạy push develop/main, PR main/develop/
release, hoặc workflow_dispatch; push vào nhánh member không tự kích hoạt.

| Workflow/job              | Điều kiện và nguyên nhân skip hợp lệ                                             |
| ------------------------- | -------------------------------------------------------------------------------- |
| CI backend/frontend       | Không có job-level if; lỗi dependency/build/test phải fail gate                  |
| CI upload backend TRX     | `!cancelled()`; giữ bằng chứng khi test fail, không là bỏ test                   |
| CI release                | Chỉ push develop/main và cần backend/frontend pass; PR/manual không deploy       |
| CI build-staging-images   | Chỉ PR có base develop và cần backend/frontend pass; push/PR main không chạy     |
| Release images            | Chỉ push develop/main; workflow reusable                                         |
| Release staging           | Chỉ develop và `BHOME_STAGING_CD_ENABLED=true`, cần images                       |
| Release production-policy | Chỉ main và `BHOME_PRODUCTION_CD_ENABLED=true`, cần images                       |
| Release production        | Cùng điều kiện main/flag, cần images + policy và environment approval            |
| Release cleanup key       | `always()` là cleanup, không bỏ test                                             |
| Production plan/prepare   | Chỉ workflow_dispatch, kiểm tra full SHA main và CI run thành công; không deploy |

Không xóa job, bỏ assertion hay thêm `continue-on-error`. `BHome.CI.slnf` loại
black-box PlanIntegrationTests có chủ đích để không gọi API bên ngoài; vẫn build
và format toàn solution. `ci.runsettings` loại các suite QA theo SRS/bug-hunt có
chủ đích như cấu hình trước thay đổi. Test opt-in yêu cầu model OCR, query log,
Mailpit/live provider/browser phải báo skip với nguyên nhân riêng; không tính pass.

GitHub CI cho working tree mới: **NOT RUN**. Không có push/commit/deploy; local
checks không thay thế kết quả Actions. Docker image local dùng nhãn baseline
HEAD nhưng chứa working tree, không phải release artifact của một commit mới.

## F. Giới hạn kiểm chứng/phạm vi

- Browser dùng static build/Vite và synthetic API fixture bị intercept trên
  loopback; PostgreSQL integration dùng database disposable. Hai lớp bằng chứng
  không thay thế browser end-to-end với API/MinIO thật hoặc production acceptance.
- Giữ API list hiện có để tương thích; lọc/phân trang ở client trên tập public
  đã tải. Chưa benchmark dữ liệu lớn hoặc thêm server pagination. Không tự gọi
  một request rooms cho mỗi location trên Home; API list chưa có aggregate phòng
  trống/giá, nên không hiển thị số lượng/phòng nổi bật suy đoán.
- Migration giữ trạng thái đã được duyệt, không thể rollback bằng cách xóa
  snapshot an toàn; rollback cần roll-forward/review. Runtime tương thích profile
  cũ nhưng vẫn nên áp dụng migration bằng quy trình vận hành đã duyệt.
- `no-store` áp dụng với response mới. Không thể thu hồi bản sao người dùng đã
  tải hoặc cache tạo trước khi triển khai phiên bản này. Không thay đổi policy
  MinIO, CORS, TLS hay routing ngoài controller FE-09; deployment guards được
  kiểm tra riêng, không truy cập server production.
- Preview dữ liệu/album thật phụ thuộc setup nội dung Owner. Fixture được gắn
  nhãn synthetic trong test, không seed vào production.
- Reviewer giao diện độc lập đã yêu cầu sửa focus link trên AppBar; đã sửa,
  recapture và nhận `disposition: ship`. Detector chạy đúng một lần, kết quả `[]`.

- Upload mất phản hồi có nút tải lại album/trạng thái, giữ draft và kết hợp ảnh mới từ server vào album; test xác minh không replay upload trước khi kiểm tra kết quả.

- Lệnh xóa đệ quy thư mục build cách ly bị automatic approval review chặn với thông báo `blocked by policy`; không có lý do chi tiết khác. Đã dùng `dotnet clean` để chỉ xóa file do MSBuild quản lý. Một số tài nguyên build còn nằm trong `.tools/fe09/after-fix` (ignored); log/TRX được giữ lại, không nằm trong source commit.

## G. Git Status

**Pre-push local checks: PASS trong phạm vi các bước đã chạy; GitHub CI: NOT RUN.**

Nhánh `member/QHuy`; HEAD không đổi
`a0a3711e3ee1c78215c7b0c671260bb6d0baa3e6`. Toàn bộ thay đổi thuộc FE-09 ở working
tree; không commit, push, merge hoặc deploy. Final: 18 modified files và 3 untracked source/doc files (21 tổng cộng), đúng danh sách phần B. Build/cache/log nằm trong đường dẫn ignored. Bằng chứng tổng hợp: `.tools/fe09/validation-summary.json` và `.tools/fe09/source-manifest.json`.
