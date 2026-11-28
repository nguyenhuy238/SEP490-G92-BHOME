# Kiến trúc BHOME cho nhóm sinh viên

Mục tiêu: mỗi thành viên tự tìm được code xử lý một nghiệp vụ, giải thích điều kiện và thay đổi đúng nơi, không cần đọc toàn bộ hệ thống. Đây là hướng tổ chức mã nguồn của nhánh `refactor/bhome-single-project`, không phải đặc tả nghiệp vụ mới.

## 1. Backend — một project, các tầng trách nhiệm rõ ràng

Giữ Modular Monolith .NET 8 + PostgreSQL. Bốn project backend trước đây được hợp nhất thành `src/backend/BHome.Api/BHome.Api.csproj`; namespace CLR cũ vẫn giữ để không đổi hợp đồng kiểu. DigitalSigning vẫn là subsystem riêng. Không tạo thêm project, microservice, framework hoặc tầng điều phối chỉ để chuyển tiếp.

| Tầng                               | Đọc và sửa ở đây                                                                  | Không đặt ở đây                      |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| `Controllers/<Nghiệp vụ>`          | HTTP route, binding DTO, policy, gọi service                                      | Tự tính tiền hoặc truy vấn DB        |
| `Services/<Nghiệp vụ>`             | Use case, quyền tài nguyên, trạng thái, transaction qua repository, calculator    | EF mapping, SQL, giao diện           |
| `DTOs/`, `Interfaces/`             | DTO/contract types và interface riêng; một số kiểu liên quan vẫn nằm cùng service | Logic HTTP hoặc persistence          |
| `Domain/<Nghiệp vụ>`               | Entity, enum và quy tắc/công thức thuần                                           | HTTP, database, dependency injection |
| `Repositories/`, `Data/`           | Repository thực, EF mapping, Compact24, migrations                                | Tự thay đổi giá hoặc quy tắc đã chốt |
| `Integrations/`, `BackgroundJobs/` | Adapter OCR/storage/provider, worker và lịch nền                                  | Thay đổi nghiệp vụ qua đường tắt     |
| `Configuration/`                   | Đăng ký DI, cấu hình ứng dụng                                                     | Nghiệp vụ trong composition root     |

Đường dẫn trong bảng tính từ `src/backend/BHome.Api/`. Luồng chạy: Controller → Service → Domain (quy tắc) và repository interface → Repository/Data → PostgreSQL. Hướng phụ thuộc logic giữ nguyên; `Configuration/` đăng ký implementation. Vì cùng assembly, kiểm tra ranh giới namespace trong `ArchitectureTests` thay thế kiểm tra phụ thuộc assembly trước đây. Không chuyển kiểm soát giao dịch, tính nhất quán và bảo vệ dữ liệu lên controller.

### Quy ước tổ chức

- Tên file theo trách nhiệm thực: `*Controller`, `*Service`, `*Repository`, `*Contracts`, `*Calculation`/`*Calculator`. Không đặt service chính trong file `Contracts` lớn khiến người mới khó tìm. Nhóm DTO/interface nhỏ cùng service được phép nếu cả nhóm rất ngắn và có chung trách nhiệm (ví dụ thông báo hết hạn hợp đồng).
- Tách công thức thuần khỏi entity khi công thức được dùng độc lập; không đổi kiểu số, thứ tự làm tròn, dữ liệu tham chiếu hoặc công thức. Chỉ tách calculator khi nó có trách nhiệm thực, không tạo wrapper 1 dòng.
- Giữ các partial class có cùng dependency/transaction nhưng đặt phần code theo nghiệp vụ. Không nhân đôi DI, repository, DTO hay service chỉ để đạt số file/tầng mục tiêu. `Data/Compact24/Migrations/` chứa lịch sử migration Compact24; giữ nguyên ID, SQL và logical resource names của migration đã phát hành.
- Đọc `AGENTS.md` và [bản đồ Backend](../business-flows/BACKEND.md) trước khi sửa.

## 2. Ví dụ thật — hóa đơn tháng

```text
BHome.Api/Controllers/Billing/InvoicesController.cs
BHome.Api/Services/Billing/
  InvoiceService.cs                # Quyền, tạo/refresh/chốt, khóa phòng
  InvoiceCalculator.cs             # Lập dòng phí, tổng và missing inputs
  ContractBillingPrices.cs         # Biểu phí trong hợp đồng đã chốt
  FixedChargeCalculation.cs        # Phí cố định và phần đã tính trước
  PersonMonthOccupancy.cs           # Số người tính phí
  BillingAutomationService.cs       # Cấu hình lịch tự động
  BillingAutomationOperations.cs    # Preview, queue, chạy thủ công
BHome.Api/DTOs/Billing/InvoiceContracts.cs # Request/response + repository interface
BHome.Api/Domain/Billing/
  Invoice.cs                        # Entity, trạng thái, dòng hóa đơn
  InvoiceMath.cs                    # Amount, CalendarDate
BHome.Api/Repositories/Billing/
  InvoiceRepository.cs              # Đọc/ghi và khóa dữ liệu
  MeterBillingCoverage.cs           # Chỉ số và phần đã thu
  FixedChargeCoverage.cs            # Khoản cố định đã thu
```

`InvoiceService` gọi thẳng `InvoiceCalculator.CalculateAsync` trong cùng khóa phòng, không tạo thêm DI/service public. Calculator đọc dữ liệu qua interface, không phải hàm thuần; `InvoiceMath` mới là công thức thuần. Tạo, refresh và kiểm tra trước chốt dùng cùng nội dung tính tiền. Tìm bằng Ctrl+P `InvoiceCalculator.cs`, sau đó F12 tại các lời gọi để truy vết. Không đọc giá phòng mới thay snapshot hợp đồng.

## 3. Frontend — feature trước, trách nhiệm sau

Giữ React/TypeScript, Expo Router và client-core hiện tại. Không đưa vào Redux/MediatR tương đương hoặc API client mới. Tìm `app/router.tsx` (Owner) hoặc route Expo `app/` và `WorkspaceScreenView.tsx` (Mobile), sau đó đi theo feature.

- `pages/` hoặc `screens/`: điểm vào màn hình, trạng thái điều hướng; component đơn giản có thể đặt trực tiếp trong feature nhỏ.
- `components/` hoặc nhóm nghiệp vụ con: UI/form/dialog; tên nhóm phải có ý nghĩa (ký, giữ chỗ, bàn giao, quyết toán).
- `hooks/` hoặc `use*`: dữ liệu, mutation, state dùng chung. Không buộc mọi màn hình có một hook riêng nếu nó không đơn giản hơn.
- `services/` và `packages/client-core/src`: HTTP API, types và validation ở biên; không tự tính lại tiền, quyết định thanh toán hoặc bypass quyền ở frontend. Không sao chép client hiện có.

Không thay đổi URL route, màn hình, label, styles, validation, mock/live, thứ tự thao tác hoặc payload khi di chuyển file. Di chuyển test/mock imports cùng production imports, không tạo file re-export cho đường dẫn cũ khi toàn bộ consumer đã chuyển. Xem [bản đồ Frontend](../business-flows/FRONTEND.md) để tìm đường dẫn đang chạy.

## 4. Cách tự làm chủ một use case

1. Chọn hành động của Chủ trọ/Nhân viên/Khách thuê và route hiện tại.
2. Mở màn hình, tìm hàm request và endpoint; theo controller vào service.
3. Đọc điều kiện quyền, trạng thái, khóa giao dịch, công thức và repository; tìm bảng/JSONB thực từ mapping Compact24, không suy luận từ tên entity.
4. Giải thích nhánh thành công, lỗi và test liên quan. Tự sửa một yêu cầu nhỏ trên branch riêng, chạy test mục tiêu và demo với dữ liệu thử.

Nghiệm thu kiến trúc không chỉ là số file ít hơn: thành viên phải chỉ ra được nơi sửa và tự kiểm tra được hành vi. Refactor không chứng minh nhóm đã làm chủ code nếu chưa tự thực hành.
