# CI #353: lỗi MinIO không ổn định và đối chiếu develop

## Phạm vi và truy vết

Yêu cầu: kiểm tra CI lỗi trên `member/QHuy`, sửa và giải thích vì sao merge
vào `develop` lại pass. Truy vết: AGENTS.md mục 6–10, NFR kiểm thử/tính sẵn
sàng/bảo mật; BF-07/UC-26..30 liên quan bằng chứng ảnh private. Không thay
quy tắc nghiệp vụ, quyền truy cập, schema, API response hoặc quy trình deploy.

## Bằng chứng đã kiểm tra

- [PR CI #353](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45680487066):
  head `57fb06ed0280b0854d36dd08c360b4349a3fbd49`, checkout PR merge
  `f9c84a84611a86e8290da74e7b75fafb95423b36`.
- [develop CI #354](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45680511165):
  commit `8620e908a6a37ffc456c2bc2503a3b7f983ab33b`.
- Cả ba commit có cùng Git tree
  `17adf84c47de7e761adf1d4f93ead3aebff2441c`. Đã fetch PR merge SHA và
  chạy `git diff --quiet` với commit develop: exit 0. Source, workflow và
  backend tests giống nhau; không có bản sửa backend nào được thêm khi merge.
- Đã tải artifact `backend-trx-attempt-1` của cả hai run và đối chiếu TRX.
  #353 có **2.658 pass, 1 fail, 32 skip**; #354 có **2.659 pass, 0 fail,
  32 skip**. Cả hai đều thực thi năm test assemblies.
- Test fail duy nhất:
  `MaintenanceDemoTests.DemoSeedIsRepeatableAndEvidenceUsesRealPrivateMinio`.
  Stack trace đi qua `MaintenanceDemoSeed.RunAsync` → `IncidentService` →
  `IncidentFiles.PutAsync` → nhánh catch `MinioException` trong
  `MinioObjectStorage.PutAsync`. Không phải lỗi build hoặc thiếu assembly.
- `Verify-BackendTrx.py` chạy lại trên artifact #354: PASS cả năm assembly;
  trên artifact #353: exit 1, từ chối đúng test fail nói trên.
  `build-staging-images` và `ci-quality-gate` fail theo backend.

Kết luận đã chứng minh: cùng source nhưng thao tác MinIO cho kết quả khác
nhau ở hai lần chạy. Merge không tự sửa lỗi. Các image-validation jobs khác
giữa sự kiện PR/push theo workflow, nhưng backend chạy cùng cấu hình ở cả hai.
Warning Node.js 20 không phải bước làm backend fail.

## Giới hạn chẩn đoán

Exception gốc của SDK bị chuyển thành thông báo chung “object storage
capability is not configured”; log cũ không giữ loại lỗi/mã HTTP của MinIO.
Không đủ bằng chứng để kết luận chính xác đó là lỗi bucket, kết nối hay phản
hồi server. Test gốc chạy riêng local trước sửa cũng PASS, nên không tuyên bố
đã tái hiện được lỗi lịch sử hoặc đã chứng minh mọi nguyên nhân đều bị loại bỏ.

Điểm yếu xác định được trong fixture: chỉ chờ `/minio/health/live`, sau đó gọi
`MakeBucketAsync` mà không xác nhận bucket tồn tại và có thể ghi. SDK MinIO 6
có nhánh không báo lỗi transport đầy đủ; chính production adapter đã kiểm tra
acknowledgement cho PUT, trong khi fixture chưa kiểm tra provisioning.

## Thay đổi

- `MaintenanceDemoTests.cs`: chờ `/minio/health/ready`; cấp tối đa 30 giây
  cho provisioning đã kiểm chứng trước khi bắt đầu test nghiệp vụ.
- `Fixtures/MinioTestBucket.cs`: xác nhận bucket tồn tại, ghi probe synthetic,
  kiểm tra ETag/kích thước và stat object rồi xóa probe. Chỉ retry provisioning;
  không retry seed, test, giao dịch hoặc assertion. Storage không sẵn sàng
  vẫn làm fixture fail với timeout; không đổi sang memory storage hoặc skip.
- `MinioTestBucketTests.cs`: giả lập khởi tạo bình thường, lỗi transport lần
  đầu khi tạo bucket và storage luôn unavailable. Kiểm tra readiness thực sự
  hoàn tất và timeout không lộ synthetic credential.
- `MinioObjectStorage.cs`: thêm log an toàn cho PUT không có acknowledgement
  và MinIO exception, chỉ loại lỗi/mã HTTP; không ghi raw exception, SDK
  response, object key, endpoint hoặc credential.
- `MinioStorageRegressionTests.cs`: kiểm tra lỗi offline vẫn bị từ chối và
  log không chứa password, access key hoặc tên file private.

## Kiểm chứng

- Trước sửa: test demo gốc trên PostgreSQL 16/MinIO disposable **1 PASS**.
- Tests readiness cuối: **3 PASS, 0 skip**. Lần đầu phát triển fake HTTP có
  2 fail vì thiếu `Content-Length` cho HEAD; đã sửa fake và chạy lại PASS.
- Sau sửa readiness: test demo + MinIO regressions + readiness:
  **7 PASS, 0 skip** trên PostgreSQL 16 và MinIO thật; lỗi khởi động/offline
  được kiểm tra bằng HTTP fake và container offline tương ứng.
- Kiểm tra cuối sau bổ sung log và assertion bảo mật: **7 PASS, 0 skip**;
  Release build trong lệnh test thành công.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
--include <5 C# files>`: PASS; `git diff --check`: PASS.
- `node --test tests/deployment/ci-backend-test-boundary.test.cjs`:
  **1 PASS**, giữ nguyên CI test boundary.
- Evidence local: `.tools/ci-353-investigation/` (ignored), gồm hai artifact
  gốc, TRX trước/sau và kết quả kiểm tra readiness.

Chưa push/commit, chưa chạy lại GitHub Actions với patch và chưa chạy toàn
bộ backend suite sau patch. Không có thay đổi deployment hoặc shared branch.
