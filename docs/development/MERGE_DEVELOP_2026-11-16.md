# Giải quyết xung đột develop vào member/QHuy

Đầu vào: merge đang thực hiện do người dùng khởi tạo, HEAD `20dbb124`,
develop `b766d55f36b81ecac9f8259affe179ca7c3a4213`. Có 14 file unmerged.
Không khởi tạo merge khác, không thay đổi nhánh đích và không push.

Phạm vi liên quan: BF-01/UC-06 kiểm kê; BF-03/04, UC-17/19 bàn giao;
giữ nguyên các thay đổi BF-06 về bằng chứng giao dịch và yêu cầu hoàn tiền từ develop.
Đây là hợp nhất kỹ thuật, không bổ sung quyết định nghiệp vụ.

## Quyết định hợp nhất

- Giữ no-assets confirmation, handover preparation, discrepancy flags, IHandoverInventory,
  phần partial của RoomInventoryReviewService và dependency IPropertyRepository để tránh vòng DI.
- Giữ sửa lỗi của develop: đọc PurchaseInfo từ cột JSONB vật lý và ghi metadata khi tạo Asset.
  Cập nhật Asset thông thường không ghi đè metadata; thay đổi metadata vẫn qua SetupWorkspaceStore.
  Chỉ khai báo shadow property tại Compact24DomainModel, bỏ khai báo trùng trong cấu hình dùng chung.
- Giữ mapping và notification adapter của fixture legacy dành cho luồng bàn giao.
- Dùng DTO wire của develop trong kiểm thử inventory, tránh deserialize Asset có ID protected setter.
- Kết hợp kiểm tra ảnh riêng tư: không tải trước thao tác người dùng, fixture có PNG signature,
  xác minh ảnh/lỗi bên trong dialog và thu hồi blob URL.
- Giữ cả TenantRefundPetitions và AssetHandoverInventoryProjection trong danh sách migration,
  theo đúng thứ tự. Không tạo thêm migration hoặc migrate database làm việc.

## Kiểm chứng local

Log nằm trong `.tmp/merge-resolution-20261116/` (ignored).

| Lệnh / phạm vi                                                                                                                  | Kết quả                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                                    | Exit 0, 0 warning/error              |
| Application.UnitTests với CI runsettings                                                                                        | 567 pass                             |
| SnapshotMatchesRuntimeAndContainsOnlyTheRuntimeBaseline                                                                         | Pass; không có pending model changes |
| Integration: Compact24OwnerSetupTests, Compact24AssetHandoverTests, Compact24MigrationBaselineTests, ManualBankEvidenceApiTests | 83 pass, không fail/skip             |
| Owner: Incidents, RoomInventoryReviewPanel, ContractHandoverDecisions, ContractLifecycleConsent, TenantRefundRequestsPage       | 28 pass / 5 file                     |
| Mobile: tenant-refund-requests, owner-financial-actions, liveWorkspace-ui, handover-ui                                          | 144 pass / 4 file                    |
| `npm run build`                                                                                                                 | Exit 0                               |
| `npm run typecheck --workspace src/mobile`                                                                                      | Exit 0                               |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`                                                          | Exit 0                               |

`npm run lint` và `npm run format:check` đều exit 0. Git không còn unmerged paths hoặc conflict markers;
`git diff --check` đạt. Container PostgreSQL kiểm thử đã được dừng sau khi chạy.

Integration dùng PostgreSQL/MinIO cô lập; kiểm tra baseline chạy migrate/replay trên database tạm
và xác minh vẫn có 24 bảng. Không khởi chạy lại API hoặc giao diện demo.
Không chạy toàn bộ CI, browser E2E hoặc thiết bị native trong lượt resolve conflict này;
các kết quả lịch sử trong báo cáo bàn giao không được thay bằng kết quả targeted ở đây.
