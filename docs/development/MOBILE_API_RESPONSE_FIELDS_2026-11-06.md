# BHOME Mobile — Các trường backend trả về theo màn hình

Ngày đối chiếu: **06/11/2026**. Bổ sung tích hợp Incident/Maintenance trong working tree sau lượt kiểm kê ban đầu; xem [bàn giao và mapping đầy đủ](MOBILE_INCIDENT_MAINTENANCE_INTEGRATION_2026-11-06.md). Source: merge `ec95481`, chứa `origin/develop` tại `9ff1919`, cùng các thay đổi mobile chưa commit trong workspace.

## 1. Phạm vi và quy ước

Chỉ mô tả chức năng **BHOME Mobile** cho Owner, Staff và Tenant. Không kiểm kê màn Owner Web/Public Web.

- **Đã nối:** có lời gọi API trong luồng đăng nhập thật, chưa đồng nghĩa đã nghiệm thu trên thiết bị/provider production.
- **Một phần:** đã lấy dữ liệu phụ hoặc một số chức năng, còn thiếu nghiệp vụ chính.
- **Chưa nối:** mobile chưa gọi API nghiệp vụ; dữ liệu preview không tính là dữ liệu backend.
- Các khối TypeScript là **kiểu dữ liệu mobile đang khai báo**, không phải response JSON đã capture. Chênh lệch với DTO backend được ghi ở mục 9.
- Có trường được trả về nhưng chưa hiển thị trên giao diện; danh mục trường không có nghĩa mọi trường đã được render.
- `?`: optional trong kiểu client; `| null`: cho phép null. Backend mới có thể luôn trả một trường mà client vẫn khai báo optional để tương thích.
- ID/Guid là `string`; ngày nghiệp vụ thường là `YYYY-MM-DD`; timestamp là chuỗi ISO 8601. Hiển thị theo múi giờ nghiệp vụ.
- Tiền và chỉ số được DTO đánh dấu `WriteAsString` là **chuỗi số**. Không tự quyết định số dư/thanh toán bằng tính toán số thực tại frontend.
- Các route có tiền tố `/api/v1`; query phân trang/lọc được rút gọn khi không ảnh hưởng cấu trúc response.

Điều hướng thật: [workspace/[screen].tsx](../../src/mobile/src/app/workspace/%5Bscreen%5D.tsx). Nhiều đường vào hợp đồng/bàn giao/trả phòng được gom vào `ContractScreen` khi `preview=false`.

## 2. Response dùng chung

### 2.1. Phân trang

`items`: bản ghi trang hiện tại; `page`: trang; `pageSize`: kích thước trang; `totalCount`: tổng số theo bộ lọc và quyền. Không dùng `items.length` thay tổng số.

```ts
interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
```

Nguồn kiểu mobile: [packages/client-core/src/invoices.ts](../../packages/client-core/src/invoices.ts).

### 2.2. Danh mục và kết quả tạo/upload

`id`: định danh; `label`: tên hiển thị; `parentId`: định danh cha nếu có. Dùng cho cơ sở, phòng, Staff hoặc đồng hồ tùy endpoint.

Các lệnh tạo cư dân/upload ảnh thường trả `{ id: string }`. Có ID ảnh không đồng nghĩa nghiệp vụ đã hoàn thành.

```ts
interface Named {
  id: string;
  label: string;
  parentId?: string;
}
```

Nguồn kiểu mobile: [src/mobile/src/lib/api.ts](../../src/mobile/src/lib/api.ts).

## 3. Màn dùng chung

### 3.1. Đăng nhập, phiên và đăng xuất — đã nối

API: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout`.

DTO backend cho login/refresh và xác minh phiên:

```ts
interface LoginResponse {
  userId: string; // ID người dùng
  roles: string[]; // Vai trò được cấp
  accessToken: string; // Token truy cập
  expiresAt: string; // Hạn token
  sessionId: string; // ID phiên
  refreshToken: string | null; // Phụ thuộc transport
  sessionExpiresAt: string; // Hạn phiên
}
interface SessionIdentity {
  userId: string;
  sessionId: string;
  roles: string[];
}
```

Mobile hiện khai báo `Session` hẹp hơn, chủ yếu dùng `userId`, `roles`, `accessToken`, `refreshToken`. UI hiện nhập email; chưa nối đăng nhập bằng phone.

Nguồn: [LoginService.cs](../../src/backend/BHome.Application/IdentityAccess/LoginService.cs), [AuthController.cs](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs), [sessions.ts](../../src/mobile/src/lib/sessions.ts).

### 3.2. Đổi mật khẩu — đã nối

Màn `security` gọi `POST /auth/change-password`. Thành công trả **204 No Content**, không có object hồ sơ. Sau đó mobile xóa phiên và yêu cầu đăng nhập lại. Chưa tính là có màn MFA/quản lý thiết bị.

### 3.3. Thông báo — đã nối

- `GET /notifications` → `Page<NotificationItem>`.
- `GET /notifications/unread-count` → `{ unreadCount: number }`, dùng cho badge.
- `GET /notifications/{id}/target` → `NotificationTarget`.
- `POST /notifications/{id}/read`, `POST /notifications/read-all`: client không sử dụng JSON body.

`title`, `summary`: nội dung; `category`: nhóm; `createdAt`, `readAt`: thời điểm; `deliveryState`: trạng thái delivery; `relatedObjectType`, `relatedObjectId`: đối tượng liên quan. Target chỉ hỗ trợ điều hướng; backend kiểm quyền lại khi mở hồ sơ.

```ts
type NotificationItem = {
  id: string;
  category: string;
  title: string;
  summary: string;
  relatedObjectType: string;
  relatedObjectId: string;
  createdAt: string;
  readAt: string | null;
  deliveryState: string;
};

type NotificationTarget = {
  objectType: string;
  objectId: string;
  locationId?: string | null;
  billingPeriod?: string | null;
};
```

Nguồn kiểu mobile: [packages/client-core/src/notifications.ts](../../packages/client-core/src/notifications.ts).

## 4. Mobile Staff

### 4.1. Trang chủ — đã nối một phần

Không có DTO dashboard riêng. Dữ liệu lấy từ:

- `GET /capture/locations` → `Named[]`: cơ sở được phân công.
- `GET /operational-tasks?...dueFrom=...&dueTo=...` → `TaskPage<OperationalTask>`: công việc đến hạn hôm nay, đếm bằng `totalCount`.
- `GET /operational-tasks?...isOverdue=true&status=Assigned` và `status=InProgress` → cùng kiểu: công việc quá hạn. Mobile ghép/sắp xếp tối đa ba việc ưu tiên.
- `GET /contracts/move-out-assignments` → lịch kiểm tra trả phòng bên dưới.
- `GET /capture/meter-tasks?...status=0` → `MeterTask[]` ở mục 4.5.

```ts
interface MoveOutAssignmentResponse {
  contractId: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  status: string;
  proposedDate: string;
  scheduledAt: string;
  version: number;
}
```

Backend trả đủ các trường trên; hook hiện chỉ khai báo/dùng `contractId`, `roomNumber`, `locationName`, `scheduledAt`, `status`. **Ca làm chưa nối**; số sự cố mở đã lấy từ tổng `Submitted` và `InProgress` của `/incidents`. Dấu `—` không có nghĩa bằng 0.

Nguồn: [useStaffDashboard.ts](../../src/mobile/src/features/workspace/useStaffDashboard.ts).

### 4.2. Công việc và chi tiết — đã nối

Màn `work-orders`/`task-detail` dùng **Operational Task**, chưa phải Work Order bảo trì:

- `GET /operational-tasks` → `TaskPage<OperationalTask>`.
- `GET /operational-tasks/{id}` → `OperationalTask`.
- `/history` → dữ liệu lịch sử theo `TaskHistory`.
- `/evidence` → metadata theo `TaskEvidence`.
- `/evidence/{evidenceId}` → file ảnh binary.

`requirements`: yêu cầu; `priority`, `dueAt`: ưu tiên/hạn; `status`, `isOverdue`: trạng thái/quá hạn; `currentResponsibleStaffUserId`: người phụ trách hiện hành; `responsibilityAvailable`: có người phụ trách hợp lệ; `result`: kết quả; `version`: kiểm soát cập nhật. Lịch sử/ảnh là endpoint riêng, không luôn nằm trong object công việc.

```ts
interface TaskPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

interface OperationalTask {
  id: string;
  locationId: string;
  kind: 'AdHoc' | 'MeterReading';
  title: string;
  requirements: string;
  priority: 'Normal' | 'High';
  dueAt: string | null;
  evidenceRequired: boolean;
  status: 'Assigned' | 'InProgress' | 'PendingVerification' | 'Completed' | 'Cancelled';
  isOverdue: boolean;
  currentResponsibleStaffUserId: string | null;
  responsibilityAvailable: boolean;
  result: string | null;
  version: number;
  verifiedAt: string | null;
}

interface TaskHistory {
  id: string;
  action: string;
  note: string;
  occurredAt: string;
  taskVersion: number;
}

interface TaskEvidence {
  id: string;
  contentType: string;
  length: number;
  createdAt: string;
  submissionId: string | null;
}
```

Nguồn kiểu mobile: [src/mobile/src/services/operationalTasks.ts](../../src/mobile/src/services/operationalTasks.ts).

### 4.3. Phòng & Người ở — đã nối

`GET /capture/locations`, `GET /capture/locations/{id}/rooms` → `Named[]`.

`GET /capture/locations/{id}/residents` → mảng theo DTO backend:

```ts
interface ResidentSummaryResponse {
  id: string;
  roomId: string;
  displayLabel: string;
  residentType: number;
  verificationStatus: number;
  confirmedAt: string | null;
}
```

Mobile hiện dùng `id`, `roomId`, `displayLabel`, `verificationStatus`. Không trả toàn bộ CCCD/hồ sơ định danh sâu trong danh sách phòng.

### 4.4. Tiếp nhận và OCR CCCD — đã nối

- `POST /capture/residents` → `{ id: string }`.
- `POST /ocr/identity/{residentId}/{side}` → `Proposal`.
- `POST /capture/residents/{id}/confirm` → `{ id, verificationStatus, confirmedAt }`; thời điểm nullable.

`proposedFields` là dictionary, không phải mọi key luôn có. Mobile xử lý `citizenIdentityNumber`, `fullName`, `dateOfBirth`, `gender`, `nationality`, `placeOfOrigin`, `residentialAddress`, `dateOfIssue`, `dateOfExpiry`; wizard đọc thêm `placeOfIssue` khi có.

`warnings`: mã cảnh báo; `missingFields`: trường thiếu; `confidence`: độ tin cậy theo key; `isFallback`: fallback; `requiresConfirmation`: yêu cầu người xác nhận. Backend còn trả `manualEntryAvailable: true`. Proposal chưa phải dữ liệu đã xác minh.

```ts
interface Proposal {
  engineVersion?: string;
  proposedFields: Record<string, string>;
  warnings: string[];
  missingFields: string[];
  confidence: Record<string, number>;
  isFallback: boolean;
  requiresConfirmation: boolean;
}
```

Nguồn kiểu mobile: [src/mobile/src/lib/api.ts](../../src/mobile/src/lib/api.ts).

### 4.5. Điện nước, OCR và xác nhận ghi số — đã nối

- `GET /capture/meter-tasks` → `MeterTask[]`, **không phải Page**.
- `GET /capture/meter-tasks/{id}` → `MeterTask`.
- `PUT /capture/meter-tasks/{id}/evidence` → `{ id: string }`.
- `POST /ocr/meter-tasks/{id}` → `Proposal`, chỉ số ở `proposedFields.reading`.
- `POST /capture/meter-tasks/{id}/confirm` và `GET /capture/readings/{id}` → `ConfirmedReading`.

`previousValue`: số trước; `decimalPlaces`: số chữ số thập phân cấu hình; `purpose`: mục đích ghi; `billingPeriod`: kỳ phí; `confirmedReadingId`: ID kết quả đã xác nhận. `confirmedValue`, `consumption` là kết quả backend trả.

```ts
interface MeterTask {
  id: string;
  meterId: string;
  location: string;
  room: string;
  meterCode: string;
  utilityType: number;
  display: number;
  decimalPlaces: number;
  purpose: number;
  readingDate: string;
  billingPeriod: string | null;
  status: number;
  previousValue: string | null;
  contractId?: string | null;
  confirmedReadingId?: string | null;
  dueAt?: string | null;
  assignedStaffUserId?: string | null;
  automationPlanId?: string | null;
  version?: number;
  locationId?: string;
  roomId?: string;
}

interface ConfirmedReading {
  id: string;
  taskId: string;
  confirmedValue: string;
  previousValue: string | null;
  consumption: string | null;
  status: number;
  confirmedAt: string;
}
```

Nguồn kiểu mobile: [packages/client-core/src/meter.ts](../../packages/client-core/src/meter.ts).

### 4.6. Sự cố, bảo trì và khẩn cấp — đã nối

Route thực tế là **`/api/v1/incidents`**, không phải `/incident-reports` như tài liệu trước. Staff tiếp tục lấy cơ sở/phòng/tài sản theo scope hiện hành; Tenant dùng `/incidents/reporting-rooms` và `/incidents/reporting-assets`.

Đã nối tạo báo cáo multipart, danh sách/chi tiết/lịch sử/ảnh, tiếp nhận khẩn cấp, hành động và khoản chi khẩn cấp; Work Order bảo trì dùng `/api/v1/work-orders` riêng, gồm phương án, duyệt, bắt đầu, tiến độ/vướng mắc, gửi nghiệm thu, làm lại và nghiệm thu theo quyền.

Toàn bộ trường của `IncidentView`, `WorkOrderView`, `IncidentActivityView`, `IncidentEvidenceView`, `EmergencyActionView`, `MaintenanceHistoryView`, `ExpenseView`, `IncidentNotificationView` và lookup/command có mapping trong [tài liệu bàn giao](MOBILE_INCIDENT_MAINTENANCE_INTEGRATION_2026-11-06.md). Kiểu TypeScript: [incidents.ts](../../src/mobile/src/services/incidents.ts). Các khoản tiền trong DTO Incident/Work Order là JSON number theo backend hiện tại, khác chuỗi số của Billing/Payment.

### 4.7. Lịch làm việc — chỉ nối cơ sở

Chỉ gọi `GET /capture/locations` → `Named[]`; chưa có response lịch ca được dùng. Tài liệu backend mới ghi Shift đã loại bỏ, cần thống nhất lại phạm vi màn.

## 5. Mobile Tenant

### 5.1. Trang chủ — đã nối

Màn ghép dữ liệu, không có response dashboard riêng:

- `GET /contracts?status=Active` → `ContractPage`.
- `GET /invoices`, `GET /invoices/{id}` → `Page<Invoice>`/`Invoice`.
- `GET /debts` → `Page<DebtInvoice>`.
- `GET /notifications?unread=true` → `Page<NotificationItem>`.
- `GET /contracts/expiry-reminders` → `ContractExpiryNotice[]`.
- `GET /invoices/{id}/payment` → `InvoicePayment`, khi hóa đơn Final.

Hiển thị hợp đồng hiện hành, hóa đơn/nợ, số tiền đã trả/còn thiếu, thông báo và nhắc hết hạn. Trang đầu không đại diện toàn bộ lịch sử.

### 5.2. Phòng của tôi — đã nối

Từ `ContractPage`, `ContractView`, `HandoverView` ở mục 6:

- Phòng/cơ sở: `roomNumber`, `locationName`.
- Kỳ thuê/trạng thái: `startDate`, `endDate`, `status`.
- Người ở: `occupants[].id`, `label`, `representative`.
- Bàn giao: `snapshot.date`, `roomCondition`, `assets[].name`, `assets[].observedCondition`, trạng thái biên bản.

Tài sản là snapshot khi bàn giao, không phải inventory hiện tại.

### 5.3. Hóa đơn và chi tiết — đã nối

`GET /invoices` → `Page<Invoice>`; `GET /invoices/{id}` → `Invoice`; `GET /payment-invoices?invoiceIds=...` → `Page<DebtInvoice>` bổ sung nhãn thanh toán.

`total`: tổng; `missingInputs`: dữ liệu còn thiếu; `scheduledFinalDate`: dự kiến chốt; `dueDate`: hạn; `lines`: khoản thuê/điện/nước/phí. Mỗi dòng có đơn giá, số lượng, ngày ở, tiền và snapshot chỉ số.

```ts
interface Invoice {
  id: string;
  roomId: string;
  locationId: string;
  roomNumber: string;
  locationName: string;
  billingPeriod: string;
  status: 'Draft' | 'Final';
  version: number;
  total: string;
  missingInputs: string[];
  scheduledFinalDate: string;
  dueDate: string;
  finalizedAt: string | null;
  representativeTenantUserId: string;
  lines: InvoiceLine[];
}

interface InvoiceLine {
  id: string;
  category: string;
  chargeCode: string;
  name: string;
  policyId: string | null;
  policyVersion: number | null;
  rateDate: string;
  rate: string;
  quantity: string;
  occupiedDays: number;
  periodDays: number;
  amount: string;
  meterReadingId: string | null;
  previousReading: string | null;
  confirmedReading: string | null;
  calculatedAmount?: string | null;
  correctionRequestId?: string | null;
}
```

Nguồn kiểu mobile: [packages/client-core/src/invoices.ts](../../packages/client-core/src/invoices.ts).

### 5.4. Thanh toán và QR — đã nối

`GET /invoices/{id}/payment` → `InvoicePayment`; `/transfer-instructions` → `TransferInstructions`.

- `originalIssuedAmount`: tiền hóa đơn gốc.
- `approvedAdjustmentTotal`: tổng điều chỉnh được duyệt.
- `payableAmount`: nghĩa vụ hiện hành.
- `paidAmount`: tiền đã ghi nhận.
- `outstandingAmount`: còn phải trả.
- `potentialExcessAmount`: tiền thừa cần xem xét, chưa mặc nhiên là tiền hoàn/credit.
- `reviewStatus`, `pendingReview`: đối soát; `financialVersion`: phiên bản tài chính.
- `history`: các lần trả được xác minh; `paidBy`: nhãn người trả; `paidByUserId` có thể null.

QR: mã ngân hàng, số/chủ tài khoản, nội dung và dữ liệu QR. `availability` cho biết có cấp hướng dẫn hay không; tài khoản/QR có thể null. Quét QR chưa xác nhận tiền đã đến.

```ts
interface InvoicePayment {
  invoiceId: string;
  paymentStatus: 'NotIssued' | 'Paid' | 'Unpaid';
  payableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  dueDate: string;
  overdueDays: number;
  transferReference: string;
  pendingReview: boolean;
  history: VerifiedPayment[];
  originalIssuedAmount?: string;
  approvedAdjustmentTotal?: string;
  potentialExcessAmount?: string;
  financialVersion?: number;
  reviewStatus?: string;
}

interface VerifiedPayment {
  id: string;
  amount: string;
  paidAt: string;
  paidBy: string;
  paidByUserId: string | null;
  verificationSource: string;
  verifiedAt: string;
}

interface TransferInstructions {
  invoiceId: string;
  availability: string;
  bankIdentifier: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  outstandingAmount: string;
  transferReference: string;
  transferDescription: string;
  qrPayload: string | null;
  qrImageDataUri: string | null;
  isDevelopmentDemo: boolean;
  receivingAccountVersion: number | null;
}
```

Nguồn kiểu mobile: [packages/client-core/src/payments.ts](../../packages/client-core/src/payments.ts).

### 5.5. Lịch sử thanh toán và công nợ — đã nối

`GET /payment-history` → `Page<PaymentHistory>`; `GET /debts` → `Page<DebtInvoice>`.

`amount`, `paidAt`: khoản trả và thời điểm; `verificationSource`: nguồn xác minh. Tham chiếu ngân hàng/người xác minh có thể null. `overdueDays`: số ngày quá hạn; `outstandingAmount`: dư nợ.

```ts
interface PaymentHistory {
  id: string;
  invoiceId: string;
  locationId: string;
  roomId: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  amount: string;
  paidAt: string;
  paidBy: string;
  verificationSource: string;
  bankReference: string | null;
  verifiedByUserId: string | null;
}

interface DebtInvoice {
  invoiceId: string;
  locationId: string;
  roomId: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  dueDate: string;
  payableAmount: string | null;
  paidAmount: string | null;
  outstandingAmount: string;
  paymentStatus: 'Paid' | 'Unpaid';
  overdueDays: number;
}
```

Nguồn kiểu mobile: [packages/client-core/src/payments.ts](../../packages/client-core/src/payments.ts).

### 5.6. Điều chỉnh hóa đơn — đã nối

`GET /invoice-adjustments?invoiceId=...` → `Page<Adjustment>`; `GET /invoice-adjustments/{id}` → `Adjustment`; `GET /invoices/{id}/adjustments` → `Page<AdjustmentEffect>`. Form có tạo yêu cầu và upload/download ảnh.

`currentAmount`, `proposedAmount`: giá trị lúc gửi và đề xuất; `decision`: quyết định Owner hoặc null; `delta`: chênh lệch; `currentInvoice`: hóa đơn hiện tại; `financials`: tài chính hiện tại; `invoiceSnapshot`: chuỗi snapshot, không phải ảnh. Evidence là metadata; ảnh tải bằng endpoint kiểm quyền.

```ts
interface Adjustment {
  id: string;
  invoiceId: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  requesterId: string;
  invoiceLineId: string | null;
  chargeCode: string | null;
  currentAmount: string;
  proposedAmount: string | null;
  reason: string;
  invoiceSnapshot: string;
  invoiceStatus: string;
  invoiceVersion: number;
  financialVersion: number;
  status: string;
  version: number;
  submittedAt: string;
  evidence: AdjustmentEvidence[];
  currentInvoice: Invoice;
  decision: AdjustmentDecision | null;
  currentFinancialVersion: number;
  financials: AdjustmentFinancials | null;
  currentChargeAmount: string | null;
}

interface AdjustmentEvidence {
  id: string;
  contentType: string;
  length: number;
}

interface AdjustmentDecision {
  outcome: string;
  invoiceStatus: string;
  chargeCode: string | null;
  beforeAmount: string;
  correctedAmount: string | null;
  delta: string;
  effectiveBefore: string;
  effectiveAfter: string;
  paidAtDecision: string;
  reason: string;
  ownerId: string;
  decidedAt: string;
}

interface AdjustmentFinancials {
  originalIssuedAmount: string;
  approvedAdjustmentTotal: string;
  effectivePayableAmount: string;
  allocatedPayments: string;
  outstandingAmount: string;
  potentialExcessAmount: string;
  financialVersion: number;
  reviewStatus: string;
}

interface AdjustmentEffect {
  id: string;
  invoiceStatus: string;
  chargeCode: string | null;
  delta: string;
  beforeAmount: string;
  correctedAmount: string | null;
  decidedAt: string;
}
```

Nguồn kiểu mobile: [packages/client-core/src/adjustments.ts](../../packages/client-core/src/adjustments.ts).

### 5.7. Điện nước theo kỳ — đã nối qua hóa đơn

`GET /invoices` → `Page<Invoice>`, lọc `lines` Electricity/Water có `meterReadingId` và `confirmedReading`.

Trường dùng: `billingPeriod`, `roomNumber`, `locationName`, `lines[].category`, `meterReadingId`, `previousReading`, `confirmedReading`, `quantity`. `quantity` là tiêu thụ; đơn vị kWh/m³ theo loại phí. Chưa nối nguồn xem số riêng trước khi lập hóa đơn.

### 5.8. Hồ sơ — chỉ nối vai trò

`GET /auth/me` → `{ userId, sessionId, roles }`; màn chỉ khai báo/dùng `roles`. Chưa gọi `/account/profile` lấy/sửa liên hệ.

### 5.9. Báo sự cố và yêu cầu — đã nối; tạm trú chưa nối nghiệp vụ chính

Tenant báo sự cố tại `/incidents` bằng multipart kèm tối đa 5 ảnh. “Yêu cầu của tôi” đọc danh sách có phân trang/lọc trạng thái/mức độ, mở chi tiết theo ID backend trả, đọc ảnh báo cáo và lịch sử đã được backend lọc. Có hủy/bổ sung ảnh trước quyết định Owner theo điều kiện hiện hành; không truy cập Work Order nội bộ hoặc chi phí.

Tạm trú vẫn mới lấy phòng qua hợp đồng Active; mã hồ sơ và kết quả tại màn là bản nháp, chưa có response xác nhận lưu. Phần tạm trú không thuộc phạm vi thay đổi Incident/Maintenance.

## 6. Hợp đồng dùng chung trên Mobile

### 6.1. Danh sách, chi tiết, lựa chọn, cấu hình — đã nối

- `GET /contracts` → `ContractPage`/`ContractSummary`.
- `GET /contracts/{id}` → `ContractView`.
- `GET /contracts/preparation` → `Preparation`.
- `GET /contracts/configuration` → `ContractConfiguration`.
- `GET /contracts/preparation/accounts` → lựa chọn `{ id, label }`, theo quyền Owner.

`requiredDeposit`: cọc yêu cầu; `appliedHoldingDeposit`: cọc giữ chỗ áp dụng; `signatures`: từng người ký; `activatedAt`: thời điểm kích hoạt; `onboardingDraft`: nháp tiếp nhận. Blocker là giới hạn, không phải thao tác hoàn thành.

```ts
interface ContractPage {
  items: ContractSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
}

interface ContractSummary {
  onboardingDraft?: boolean;
  id: string;
  roomId: string;
  locationId: string;
  locationName: string;
  roomNumber: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
}

interface ContractView {
  onboardingDraft?: boolean;
  id: string;
  roomId: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  requiredDeposit: string;
  terms: string;
  previousContractId: string | null;
  residentIds: string[];
  signatures: Signature[];
  activatedAt: string | null;
  actualEndDate?: string | null;
  ownerSignerId: string;
  tenantUserId: string | null;
  representativeResidentId: string;
  holdingContractId: string | null;
  appliedHoldingDeposit: string;
  isDevelopmentDemo?: boolean;
  roomNumber?: string;
  locationName?: string;
  occupants?: { id: string; label: string; representative: boolean }[] | null;
  locationId: string;
}

interface Signature {
  id: string;
  signerUserId: string;
  status: string;
  signedAt: string | null;
}

interface NamedOption {
  id: string;
  label: string;
  parentId?: string;
}

interface Preparation {
  locations: NamedOption[];
  rooms: (NamedOption & { locationId: string; status: string })[];
  residents: (NamedOption & {
    roomId: string;
    tenantUserId: string | null;
    verified: boolean;
    residentType?: string;
  })[];
  ownerSigners: NamedOption[];
}

interface ContractConfiguration {
  template: ContractTemplate;
  signingMode: string;
  holdingBlocker: string;
  settlementBlocker: string;
}

interface ContractTemplate {
  id: string;
  version: number;
  title: string;
  notice: string;
  available: boolean;
  developmentOnly: boolean;
  blocker: string | null;
  fields: string[];
}
```

Nguồn kiểu mobile: [packages/client-core/src/contracts.ts](../../packages/client-core/src/contracts.ts).

### 6.2. Nháp chính và PDF — đã nối tạo/xem/lưu

- `GET /contracts/main-drafts/preparation` → `MainDraftPreparation`.
- POST/PUT/GET bản nháp → `MainDraftView`.
- `POST /contracts/main-drafts/{id}/documents` → `MainDraftFiles`.
- `GET /contracts/main-drafts/{id}/documents/{fileId}` → binary DOCX/PDF.
- `/documents/{fileId}/preview` → `DraftPreviewInfo`.
- `/documents/{fileId}/pages/{page}` → ảnh trang PDF.

`residents`: người ở, số định danh mask; `charges`: giá/phí; `blockers`: điều kiện thiếu; `previewError`: lỗi PDF. `MainDraftView.input` là dữ liệu nháp được backend trả lại, không chỉ là request.

Chưa có điểm gọi UI rõ ràng cho `signing-review`/`release` dù shared client có khai báo.

```ts
interface MainDraftPreparation {
  roomId: string;
  locationId: string;
  locationName: string;
  roomNumber: string;
  address: string;
  effectiveOn: string;
  residents: {
    id: string;
    fullName: string;
    maskedCitizenNumber: string;
    dateOfIssue: string | null;
    representative: boolean;
    phone?: string | null;
  }[];
  charges: { id: string; name: string; chargeCode: string; rate: string; version: number }[];
  securityDeposit: string | null;
  paymentTerms: string | null;
  ownerName: string | null;
  blockers: string[];
}

interface MainDraftView {
  id: string;
  status: string;
  version: number;
  input: MainDraftInput;
  preparation: MainDraftPreparation;
}

interface MainDraftInput {
  roomId: string;
  representativeResidentId: string;
  residentIds: string[];
  startDate: string;
  endDate: string;
  notes: string;
  tenantPhone: string;
  tenantPlaceOfIssue: string;
  expectedVersion: number;
}

interface MainDraftFiles {
  docx: ContractDocumentView;
  pdf: ContractDocumentView | null;
  previewError: string | null;
}

interface DraftPreviewInfo {
  fileId: string;
  pages: DraftPreviewPage[];
}

interface DraftPreviewPage {
  number: number;
  width: number;
  height: number;
}
```

Nguồn kiểu mobile: [packages/client-core/src/mainDrafts.ts](../../packages/client-core/src/mainDrafts.ts).

### 6.3. Tài liệu, lịch sử, cọc, ký và kích hoạt — đã nối theo role

- `/contracts/{id}/previews` → metadata `PreviewDocument`.
- `/contracts/{id}/history` → `ContractAudit[]`.
- `/contracts/{id}/versions` → `id`, `previousContractId`, `kind`, `status`, `startDate`, `endDate`, `monthlyRent` nullable, `terms`.
- `/contracts/{id}/deposit-verifications` → `DepositVerification[]`.
- `/contracts/{id}/activation-readiness` → `Readiness`.
- `/digital-signing/certificates` → `Certificate[]`.
- `/contracts/{id}/signing/layout` → `SigningLayout`.
- `/digital-signing/signature-image` → `SignatureImageView`; `/content` trả ảnh.

Các route đọc trên dùng GET. Document/ảnh trang trả binary. `ready` do backend quyết định; `verifiedDeposit`, `remainingDeposit`: cọc xác minh/còn thiếu. `Certificate.usable` không có nghĩa đã ký; trạng thái từng người nằm trong `signatures`. `suggested` là tọa độ tỷ lệ trang.

```ts
interface PreviewDocument {
  id: string;
  contractId: string;
  kind: string;
  snapshotHash: string;
  templateId: string | null;
  templateVersion: number | null;
  developmentOnly: boolean;
  recordedAt: string;
}

interface ContractAudit {
  action: string;
  actorId: string | null;
  occurredAt: string;
}

interface DepositVerification {
  id: string;
  bankTransactionReference: string;
  amount: string;
  verificationReason: string;
  verifiedByUserId: string;
  verifiedAt: string;
}

interface Readiness {
  ready: boolean;
  verifiedDeposit: string;
  remainingDeposit: string;
  blockers: string[];
}

interface Certificate {
  id: string;
  provider: string;
  providerUserIdHint: string;
  serialNumber: string;
  subject: string;
  validFrom: string;
  validTo: string;
  locked: boolean;
  usable: boolean;
}
```

Nguồn kiểu mobile: [packages/client-core/src/contracts.ts](../../packages/client-core/src/contracts.ts).

```ts
interface SignaturePlacement {
  page: number;
  x: number;
  y: number;
  width: number;
}

interface SigningLayout {
  pageCount: number;
  pages: { width: number; height: number }[];
  suggested: SignaturePlacement | null;
  party: 'Owner' | 'Tenant';
  hasPicture: boolean;
  signerName: string;
}

interface SignatureImageView {
  present: boolean;
  width: number;
  height: number;
  version: string | null;
  updatedAt: string | null;
}
```

Nguồn kiểu mobile: [packages/client-core/src/signing.ts](../../packages/client-core/src/signing.ts).

### 6.4. Bàn giao — đã nối

`GET /contracts/{id}/handover` → `HandoverView | null`; `/handover/history` → `HandoverHistory[]`; `/handover/choices` → `HandoverChoices` theo quyền Staff.

Có tạo/sửa, Tenant xác nhận/tranh chấp, Staff xác nhận qua client hợp đồng. `version`: phiên bản biên bản; `tenantConfirmedVersion`: phiên bản Tenant xác nhận; `snapshot`: ngày, hiện trạng, chìa khóa, tài sản, chỉ số, ảnh. `value`: số xác nhận; `evidenceHash`: hash bảo toàn bằng chứng, không phải ảnh.

```ts
interface HandoverView {
  version: number;
  status: string;
  snapshot: HandoverSnapshot;
  tenantConfirmedVersion: number | null;
  tenantConfirmedAt: string | null;
  staffConfirmedAt: string | null;
}

interface HandoverSnapshot {
  date: string;
  roomNumber: string;
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  assets: HandoverAsset[];
  electricity: HandoverReading;
  water: HandoverReading;
  evidenceIds: string[];
}

interface HandoverAsset {
  id: string;
  name: string;
  inventoryCondition: string;
  observedCondition: string;
}

interface HandoverReading {
  id: string;
  meterCode: string;
  utilityType: number;
  date: string;
  value: string;
  evidenceId: string;
  evidenceHash: string;
}

interface HandoverHistory {
  version: number;
  action: string;
  actorId: string;
  occurredAt: string;
  note: string;
  snapshot: HandoverSnapshot;
}

interface HandoverChoices {
  assets: HandoverAsset[];
  readings: HandoverReading[];
  evidence: PreviewDocument[];
}
```

Nguồn kiểu mobile: [packages/client-core/src/contracts.ts](../../packages/client-core/src/contracts.ts).

### 6.5. Gia hạn, nhắc hết hạn và trả phòng — đã nối theo role

- `GET /contracts/expiry-reminders` → `ContractExpiryNotice[]`.
- `GET /contracts/{id}/move-out` → `MoveOut | null`.
- `/move-out/inspection-preparation` → `InspectionPreparation`.
- `/move-out/inspections` → `FinalInspection[]`.
- `/move-out/settlement-summary` → `SettlementSummary`, Owner/Tenant.
- `/move-out/settlement-history` → `SettlementReview[]`, Owner/Tenant.
- `/move-out/history` → `version`, `action`, `actorId`, `occurredAt`, `snapshot` dạng chuỗi JSON.

Các route đọc trên dùng GET. `baseline`: bàn giao trước; `observed`: kiểm tra cuối; `ownerDecision`: quyết định xem xét. `unresolvedItems`, `resolved`: điều kiện chặn/đã giải quyết. `refundAmount` chưa chứng minh đã chuyển tiền.

Mobile đọc tổng hợp mới `calculation`, `depositDeductions`; chưa nối thao tác hoàn tiền/duyệt khấu trừ mới thành luồng UI.

```ts
interface ContractExpiryNotice {
  id: string;
  contractId: string;
  roomNumber: string;
  locationName: string;
  endDate: string;
  stage: string;
  createdAt: string;
}

interface MoveOut {
  id: string;
  status: string;
  proposedDate: string;
  reason: string;
  inspectionScheduledAt: string | null;
  pendingReason: string;
  inspectionNotes: string | null;
  inspectedAt: string | null;
  electricityReadingId: string | null;
  waterReadingId: string | null;
  evidenceIds: string[];
  inspectionStaffId?: string | null;
  version?: number;
}

interface InspectionPreparation {
  baseline: HandoverView | null;
  baselineContractId: string | null;
  finalReadings: HandoverReading[];
  otherTenantsRemain: boolean;
}

interface FinalInspection {
  id: string;
  version: number;
  baselineContractId: string;
  baselineVersion: number;
  baseline: HandoverSnapshot;
  observed: HandoverSnapshot;
  staffId: string;
  inspectedAt: string;
  ownerDecision: string | null;
  ownerReason: string | null;
  reviewedAt: string | null;
}

interface SettlementSummary {
  obligationReference?: string;
  depositDeductions?: DepositDeductionPlan | null;
  financialReference?: string;
  calculation?: {
    issuedTotal: string;
    approvedAdjustmentTotal: string;
    payableTotal: string;
    verifiedInvoicePayments: string;
    roomOutstanding: string;
    contractSpecificOutstanding: string | null;
    potentialInvoiceExcess: string;
    depositAllocated: string | null;
    depositRefunded: string | null;
    depositReserved: string | null;
    availableSecurityDeposit: string | null;
    depositPositionConsistent: boolean;
  } | null;
  contractId: string;
  depositContractId: string;
  roomNumber: string;
  verifiedSecurityDeposit: string;
  appliedHoldingDeposit: string;
  contractSpecificOutstanding: string | null;
  approvedFinalCharges: string | null;
  approvedDeductions: string | null;
  refundAmount: string | null;
  invoices: {
    invoiceId: string;
    billingPeriod: string;
    shared: boolean;
    financials: {
      originalIssuedAmount: string;
      approvedAdjustmentTotal: string;
      effectivePayableAmount: string;
      allocatedPayments: string;
      outstandingAmount: string;
      potentialExcessAmount: string;
    };
  }[];
  unresolvedItems: string[];
  otherActiveContracts: boolean;
  resolved: boolean;
  reference: string;
  transferVerificationStatus: string;
}

interface DepositDeductionPlan {
  id: string;
  contractId: string;
  depositContractId: string;
  inspectionId: string;
  inspectionVersion: number;
  version: number;
  approvedByUserId: string;
  approvedAt: string;
  reason: string;
  obligationReference: string;
  total: string;
  items: DepositDeductionItem[];
  evidence: { id: string; length: number; sha256: string }[];
  isDevelopmentDemo: boolean;
}

interface DepositDeductionItem {
  assetId: string | null;
  reasonCode: 'TenantDamage';
  amount: string;
  description: string;
  evidenceIds: string[];
}

interface SettlementReview {
  id: string;
  decision: string;
  settled: boolean;
  reviewedAt: string;
  reviewedByUserId: string;
}
```

Nguồn kiểu mobile: [packages/client-core/src/contracts.ts](../../packages/client-core/src/contracts.ts).

## 7. Mobile Owner

### 7.1. Tổng quan — đã nối số lượng

Gọi bốn danh sách và lấy `totalCount`:

- `GET /locations?pageSize=1`: tổng cơ sở.
- `GET /rooms?pageSize=1`: tổng phòng.
- `GET /rooms?pageSize=1&roomStatus=2`: phòng đang ở.
- `GET /contracts?pageSize=1`: tổng hợp đồng, tất cả trạng thái.

Adapter frontend tạo object sau; **không phải DTO dashboard backend**:

```ts
interface OwnerOverview {
  locations: number;
  rooms: number;
  occupiedRooms: number;
  contracts: number;
}
```

Chưa lấy doanh thu/công nợ/chi phí trên tổng quan mobile.

### 7.2. Phê duyệt và vận hành — đã nối Operational Task

Dùng kiểu mục 4.2; vận hành có thêm tác vụ đồng hồ mục 4.5. Trung tâm phê duyệt này chưa đại diện tất cả phê duyệt Incident, điều chỉnh, cọc hay chi phí.

### 7.3. Thiết lập — cần sửa tương thích

Có gọi danh mục cơ sở/phòng/Staff/đồng hồ dạng `Named[]`, kết quả tạo thường `{ id }`. Tuy nhiên còn gọi `/capture/chains`, `/chain` đã bị bỏ khỏi controller mới; tải khởi tạo có thể thất bại. Form còn RoomType trong khi `RoomInput` backend hiện chỉ có `locationId`, `roomNumber`, `capacity`.

Không tính là hoạt động đầy đủ chỉ vì có `api.request`. Chưa thực hiện request ghi dữ liệu trong lượt này.

## 8. Màn chưa nối: dữ liệu backend mới sẵn có

### 8.1. Hồ sơ cá nhân

`GET /account/profile` trả kiểu dưới; mobile chưa gọi lấy/sửa thông tin liên hệ. `version` là chuỗi, khác version số ở hợp đồng/biên bản.

```ts
interface ProfileResponse {
  userId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  isActive: boolean;
  version: string;
}
```

### 8.2. Tạm trú

`GET /residence-tasks` → Page của bản ghi dưới; `GET /residence-tasks/{contractId}/{residentId}` → bản ghi. Mobile chưa nối các trường nghiệp vụ này.

```ts
interface ResidenceTaskResponse {
  contractId: string;
  residentId: string;
  locationId: string;
  roomId: string;
  roomNumber: string;
  residentLabel: string;
  residentRole: string;
  tenantUserId: string | null;
  residenceFrom: string;
  actualResidenceFrom: string | null;
  status: string;
  hasEvidence: boolean;
  resultAt: string | null;
  ownerConfirmed: boolean;
  ownerConfirmedAt: string | null;
  history: {
    action: string;
    actorId: string;
    occurredAt: string;
    note: string | null;
  }[];
}
```

Tenant đăng ký bên ngoài qua VNeID; BHOME theo dõi kết quả/bằng chứng; Staff không đăng ký/duyệt thay.

### 8.3. Sự cố, bảo trì, khẩn cấp — đã tích hợp sau kiểm kê

Backend dùng `/incidents` và `/work-orders`. Mobile hiện có type riêng, service, hook refresh, màn list/detail, form action theo quyền và gallery tải ảnh có xác thực. Xem [ma trận API và mapping từng trường](MOBILE_INCIDENT_MAINTENANCE_INTEGRATION_2026-11-06.md) để biết giới hạn và bằng chứng kiểm thử. Không còn xếp nhóm này vào “chưa nối”.

### 8.4. Chức năng khác chưa có response được mobile dùng

- Staff “Gửi thông báo”: chưa gửi qua API.
- Staff “Tài sản”, “Hóa đơn”, “Theo dõi công nợ”: route thật mở màn chưa khả dụng.
- Tùy chọn thông báo: chưa lấy/lưu preference trong luồng thật.
- Hồ sơ Owner/Staff: chưa lấy full name/phone/email, chủ yếu dùng role từ phiên.
- Ngân hàng/quyết toán, hỗ trợ và quy chế trong hồ sơ: action chưa khả dụng.
- Main Draft review/release: chưa có luồng UI gọi mới.
- Hoàn tiền/khấu trừ: đọc được trong summary, chưa nối action mới.
- Phone login, quên/reset mật khẩu: chưa có luồng UI mobile.

## 9. Khác biệt backend và khai báo mobile

Đối chiếu DTO source, chưa phải đo response live:

- Login/refresh: backend có thêm `expiresAt`, `sessionId`, `sessionExpiresAt`; `refreshToken` nullable. `Session` mobile hẹp hơn.
- Auth me: có `userId`, `sessionId`, `roles`; hồ sơ Tenant chỉ khai báo `roles`.
- ResidentSummary: có thêm `residentType`, `confirmedAt`.
- OCR proposal: có thêm `manualEntryAvailable`; `sourceImageHash` bị `JsonIgnore`, không phải trường public.
- MoveOutAssignment: có thêm `roomId`, `proposedDate`, `version` so với hook dashboard.
- DebtInvoice: có thêm `originalIssuedAmount`, `approvedAdjustmentTotal`, `potentialExcessAmount`, đều chuỗi số nullable.
- ContractConfiguration: backend cho `holdingBlocker`, `settlementBlocker` null, client đang khai báo `string`.
- MoveOut: backend cho `evidenceIds` null, client khai báo mảng không null.
- SettlementSummary: có thêm `roomId`, `tenantUserId`; `calculation` còn có `approvedDepositDeductions: string | null`.
- SettlementReview: có thêm `financialSnapshot: string`.
- Asset: form chỉ khai báo subset, backend có thêm `category`, `condition`, `status`, `version`.

Không sửa interface trong lượt tạo tài liệu. Các khác biệt cần xét khi nối/sửa UI, không tự xem là lỗi runtime đã tái hiện.

## 10. Màn thử nghiệm OCR

`/ocr-test` dùng trong phát triển, không phải nghiệp vụ Tenant:

- `GET /ocr/diagnostics`: kiểm tra khả dụng, UI không đọc DTO nghiệp vụ.
- `POST /ocr/diagnostics/auto` → `AutomaticDiagnosticResult`.
- Typed/manual diagnostic → `DiagnosticResult`.

`analysis` có trạng thái/nguồn/độ tin cậy phân loại, loại ảnh/candidate/cảnh báo, proposal CCCD hoặc chỉ số và crop nếu có. Chưa chắc chắn thì vẫn cần kiểm tra thủ công.

```ts
interface AutomaticDiagnosticResult {
  analysis: AutomaticAnalysis;
  elapsedMilliseconds: number;
}

interface AutomaticAnalysis {
  classificationStatus: 'classified' | 'unknown' | 'ambiguous' | 'unavailable' | 'manual';
  detectedCategory: string;
  classificationConfidence: number | null;
  classificationSource: string;
  candidateCategories: string[];
  warnings: string[];
  identityProposal: Proposal | null;
  meterProposal: Proposal | null;
  partialCategory?: string | null;
  detectionConfidence?: number | null;
  cropPreviewDataUri?: string | null;
}
```

Nguồn kiểu mobile: [src/mobile/src/lib/automaticOcr.ts](../../src/mobile/src/lib/automaticOcr.ts).

```ts
interface DiagnosticResult {
  proposal: Proposal;
  elapsedMilliseconds: number;
}
```

Nguồn kiểu mobile: [src/mobile/src/lib/ocrDiagnostics.ts](../../src/mobile/src/lib/ocrDiagnostics.ts).

## 11. Binary, response rỗng và lỗi

- DOCX/PDF/ảnh bằng chứng/ảnh trang ký/preview trả binary. Metadata không phải URL ảnh công khai.
- `204 No Content`: không có JSON body.
- Mobile đọc HTTP status, `code`, `correlationId` nếu có và header `X-Correlation-ID`. Validation có thể là Problem Details; không coi mọi lỗi là DTO nghiệp vụ.
- Null, dữ liệu chưa tải hoặc response rỗng không đồng nghĩa số tiền/số lượng bằng 0 hay thao tác thành công.

## 12. Nguồn và kiểm chứng

Kiểm tra tĩnh điều hướng, điểm gọi API và interface/DTO. Không gọi API live, không chạy seed/migration, không ghi dữ liệu người dùng. Không lấy kết quả test cũ làm bằng chứng cho lượt này.

Nguồn backend:

- [CaptureContracts.cs](../../src/backend/BHome.Application/Ocr/CaptureContracts.cs), [IOcrService.cs](../../src/backend/BHome.Application/Ocr/IOcrService.cs).
- [ContractContracts.cs](../../src/backend/BHome.Application/Contracts/ContractContracts.cs), [ContractWorkflowContracts.cs](../../src/backend/BHome.Application/Contracts/ContractWorkflowContracts.cs), [SettlementCalculation.cs](../../src/backend/BHome.Application/Contracts/SettlementCalculation.cs).
- [InvoiceContracts.cs](../../src/backend/BHome.Application/Billing/InvoiceContracts.cs).
- [PaymentContracts.cs](../../src/backend/BHome.Application/PaymentsDebt/PaymentContracts.cs), [TransferInstructionsService.cs](../../src/backend/BHome.Application/PaymentsDebt/TransferInstructionsService.cs).
- [OperationsContracts.cs](../../src/backend/BHome.Application/Operations/OperationsContracts.cs), [PropertyContracts.cs](../../src/backend/BHome.Application/PropertyManagement/PropertyContracts.cs).

Tài liệu là snapshot source ngày 06/11/2026. Khi DTO/controller hoặc UI đổi, cần cập nhật mục tương ứng. Backend quyết định quyền và trạng thái nghiệp vụ.
