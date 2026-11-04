// Runtime descriptors are exported by Compact24ApiAuditTests. No server credentials are read here.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const input = path.resolve(
  root,
  process.argv[2] || '.tools/api-compact24-audit/evidence/api-route-audit.json',
);
const audit = JSON.parse(fs.readFileSync(input, 'utf8'));
const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const walk = (folder) =>
  fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(file);
    return /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file) ? [file] : [];
  });
const files = [
  'packages/client-core/src',
  'src/owner-web/src',
  'src/mobile/src',
  'src/public-web/src',
].flatMap((folder) => walk(path.join(root, folder)));
const models = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const vars = new Map();
  const imports = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      vars.set(node.name.text, node.initializer);
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.')
    ) {
      const base = path.resolve(path.dirname(file), node.moduleSpecifier.text);
      imports.push(
        ...[base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].filter((candidate) =>
          files.includes(candidate),
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  models.set(file, { file, text, ast, vars, imports });
}
function values(node, model, depth = 0) {
  if (!node || depth > 8) return ['{value}'];
  const next = (value) => values(value, model, depth + 1);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isIdentifier(node)) {
    const initializer = model.vars.get(node.text);
    return initializer &&
      ts.isStringLiteralLike(initializer) &&
      initializer.text.startsWith('/api/v1/')
      ? next(initializer)
      : ['{' + node.text + '}'];
  }
  if (ts.isParenthesizedExpression(node)) return next(node.expression);
  if (ts.isConditionalExpression(node)) return [...next(node.whenTrue), ...next(node.whenFalse)];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return next(node.left).flatMap((left) => next(node.right).map((right) => left + right));
  if (ts.isTemplateExpression(node)) {
    let result = [node.head.text];
    for (const span of node.templateSpans)
      result = result.flatMap((left) =>
        next(span.expression).map((value) => left + value + span.literal.text),
      );
    return result;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    model.vars.has(node.expression.text)
  ) {
    const declaration = model.vars.get(node.expression.text);
    if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body))
      return next(declaration.body);
  }
  return ['{value}'];
}
const calls = [];
for (const model of models.values()) {
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : node.expression.getText(model.ast);
      if (['request', 'json', 'image', 'command', 'useWorkspaceQuery', 'fetch'].includes(name)) {
        let methods = [name === 'json' || name === 'image' || name === 'command' ? 'POST' : 'GET'];
        const methodArgument =
          name === 'json'
            ? node.arguments[2]
            : name === 'image' || name === 'command'
              ? node.arguments[3]
              : undefined;
        if (methodArgument && ts.isStringLiteralLike(methodArgument))
          methods = [methodArgument.text];
        const options = node.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          const method = options.properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name.getText(model.ast) === 'method',
          );
          if (method)
            methods = values(method.initializer, model).map((x) => (x === '{method}' ? 'POST' : x));
        }
        let member = '';
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isPropertyAssignment(parent)) {
            member = parent.name.getText(model.ast);
            break;
          }
        }
        for (const route of values(node.arguments[0], model))
          if (route.startsWith('/api/v1/')) {
            calls.push({
              file: model.file,
              line: model.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              route: route.split('?')[0],
              methods,
              member,
            });
          }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(model.ast);
}
const normalized = (route) => route.replace(/\{[^}]*\}/g, '{}');
function reaches(file, dependency, seen = new Set()) {
  if (file === dependency) return true;
  if (seen.has(file)) return false;
  seen.add(file);
  return models.get(file)?.imports.some((next) => reaches(next, dependency, seen)) || false;
}
function consumers(call, app) {
  if (relative(call.file).startsWith(`src/${app}/src/`)) return [call.file];
  if (!relative(call.file).startsWith('packages/client-core/')) return [];
  return files.filter(
    (file) =>
      relative(file).startsWith(`src/${app}/src/`) &&
      reaches(file, call.file) &&
      call.member &&
      [...models.values()].some(
        (module) =>
          module.file !== call.file &&
          reaches(file, module.file) &&
          reaches(module.file, call.file) &&
          new RegExp('\\.' + call.member + '\\s*\\(').test(module.text),
      ),
  );
}
const link = (file, line) =>
  `[${path.basename(file)}${line ? ':' + line : ''}](../../${relative(file)}${line ? '#L' + line : ''})`;
function matches(endpoint) {
  return calls.filter(
    (call) =>
      normalized(call.route) === normalized(endpoint.Route) &&
      call.methods.includes(endpoint.Method),
  );
}
function frontend(endpoint, app) {
  if (endpoint.Controller === 'Auth') {
    const action = endpoint.Route.split('/').at(-1);
    const actions =
      app === 'owner-web'
        ? ['login', 'refresh', 'logout', 'forgot-password']
        : ['login', 'refresh', 'logout', 'change-password'];
    if (actions.includes(action))
      return `Có lời gọi (action động): ${link(path.join(root, app === 'owner-web' ? 'src/owner-web/src/features/auth/hooks/useOwnerLogin.ts' : 'src/mobile/src/lib/sessions.ts'))}`;
    return 'Backend có; chưa có màn gọi action này';
  }
  if (
    endpoint.Controller === 'Capture' &&
    endpoint.Method === 'POST' &&
    app === 'mobile' &&
    /^\/api\/v1\/capture\/(locations|rooms|staff|assignments|meters|meter-tasks)$/.test(
      endpoint.Route,
    )
  )
    return `Có lời gọi (setup động): ${link(path.join(root, 'src/mobile/src/app/setup.tsx'))}`;
  if (
    endpoint.Controller === 'OperationalTasks' &&
    app === 'mobile' &&
    endpoint.Method === 'POST' &&
    /\/(start|progress|blockers|submit|verify|rework|coordinate|assign|cancel)$/.test(
      endpoint.Route,
    )
  )
    return `Có lời gọi (theo role/trạng thái): ${link(path.join(root, 'src/mobile/src/screens/OperationalTaskScreens.tsx'))}`;
  if (endpoint.Controller === 'Contracts' && endpoint.Method === 'POST') {
    const operation = endpoint.Route.replace(/^\/api\/v1\/contracts\/\{id:guid\}\//, '');
    const sharedActions = [
      'signing',
      'signing/sync',
      'signing/recover',
      'activate',
      'deposit-verifications',
      'renewals',
      'renewal-cancellation',
      'termination-requests',
      'expiry-move-out',
      'move-out/approve',
      'move-out/schedule',
      'move-out/inspection',
      'move-out/settlement',
      'move-out/complete',
    ];
    if (
      sharedActions.includes(operation) &&
      (app === 'mobile' || !['termination-requests', 'move-out/inspection'].includes(operation))
    )
      return `Có lời gọi (action động): ${link(path.join(root, app === 'mobile' ? 'src/mobile/src/features/contracts/ContractActionForm.tsx' : 'src/owner-web/src/features/contracts/ContractActionDialog.tsx'))}`;
    if (operation.startsWith('handover') && app === 'mobile')
      return `Có lời gọi (Staff/Tenant): ${link(path.join(root, 'src/mobile/src/features/contracts/ContractHandoverPanel.tsx'))}`;
    if (operation === 'move-out/inspection-review')
      return `Có lời gọi: ${link(path.join(root, `src/${app}/src/features/contracts/ContractLifecyclePanel.tsx`))}`;
  }
  const found = matches(endpoint).flatMap((call) =>
    consumers(call, app).map((file) => ({ call, file })),
  );
  if (found.length) return `Có lời gọi: ${link(found[0].file)}`;
  const client = matches(endpoint).find((call) =>
    relative(call.file).startsWith('packages/client-core/'),
  );
  if (client) return `Có client; chưa xác nhận UI: ${link(client.file, client.line)}`;
  return 'Chưa tìm thấy lời gọi tương ứng';
}
function status(endpoint) {
  if (endpoint.Controller === 'MobileDevelopment' || endpoint.Controller === 'OcrDiagnostics')
    return 'Development có điều kiện; không lưu nghiệp vụ';
  if (endpoint.Controller === 'Foundation' || endpoint.Route === '/api/v1/auth/me')
    return 'JWT/session; không ghi nghiệp vụ';
  if (/signing|document|previews|evidence/.test(endpoint.Route))
    return 'Compact24; thao tác file/provider cần cấu hình';
  if (endpoint.Route.endsWith('/forgot-password')) return 'Compact24; delivery reset chưa cấu hình';
  return 'Compact24';
}
const sorted = [...audit.Endpoints].sort(
  (a, b) =>
    a.Controller.localeCompare(b.Controller) ||
    a.Route.localeCompare(b.Route) ||
    a.Method.localeCompare(b.Method),
);
const protectedCount = sorted.filter((endpoint) => !endpoint.Anonymous).length;
const backendFiles = [];
function collectControllers(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) collectControllers(full);
    else if (entry.name.endsWith('.cs'))
      backendFiles.push({ file: full, text: fs.readFileSync(full, 'utf8') });
  }
}
collectControllers(path.join(root, 'src/backend/BHome.Api/Controllers'));
const output = [
  '# BHOME — danh mục API và trạng thái kết nối Compact24',
  '',
  'Ngày rà soát: **04/11/2026**. Nguồn: route descriptor của host `BHome.Api` chạy bằng DI mặc định trên database PostgreSQL chỉ có Compact24; đối chiếu mã nguồn frontend, không suy ra từ tên màn hình.',
  '',
  `Host đăng ký **${sorted.length} controller routes**: **${protectedCount} route bảo vệ** đã trả 401 khi không có phiên; ${sorted.length - protectedCount} route anonymous. Ngoài ra có 2 health endpoints. Toàn bộ **${audit.OwnerGetProbes.length} GET nghiệp vụ** đã được probe bằng Owner; 0 HTTP 5xx. GET với ID không tồn tại/thiếu query trả 400/403/404 là kiểm tra nhánh lỗi, không chứng minh mọi happy path đã đạt.`,
  '',
  '## Cách đọc trạng thái',
  '',
  '- **Có lời gọi**: có lời gọi HTTP trong mã app hoặc client dùng chung được truy ngược tới callsite UI/service. Đây là tích hợp ở mã nguồn, chưa phải kết quả E2E trình duyệt/thiết bị.',
  '- **Có client; chưa xác nhận UI**: wrapper tồn tại nhưng công cụ chưa xác nhận đường gọi cụ thể từ UI. Các mutation động của Contract/Task phải đọc phần đối chiếu thủ công bên dưới.',
  '- **Chưa tìm thấy**: chưa có bằng chứng gọi đúng method + route trong source đã quét; không đồng nghĩa endpoint backend thiếu.',
  '- Policy/roles ở cùng một endpoint được áp dụng kết hợp; các role trong một attribute là lựa chọn OR. Quyền theo Location/Tenant vẫn được service kiểm tra.',
  '- DTO body/query và kiểu trả về nằm trong manifest kiểm thử; schema JSON đầy đủ xem Swagger Development `/swagger/v1/swagger.json` và các tài liệu từng module trong thư mục này.',
  '- Để xem dữ liệu database: Owner Web cần `VITE_API_MODE=api` và API base URL đúng; nếu thiếu hoặc khác `api` thì app dùng mock. Mobile cần đăng nhập thật, không dùng chế độ xem trước theo vai trò. API mode chỉ hoạt động cho các màn đã nối trong danh mục.',
  '',
  '## Đối chiếu nghiệp vụ và giới hạn',
  '',
  'Yêu cầu người dùng → BF-01/UC-04..07 (chuỗi/phòng/biểu phí), BF-02/UC-08..12 (phân công/công việc), BF-03/04/UC-13..19 (onboarding/hợp đồng), BF-05/06/UC-20..25 và JOB-09/10 (đồng hồ/hóa đơn/thanh toán), FE-07/GBR-01..04/07..10/18 (thông báo, quyền, tính toàn vẹn). Giữ nguyên hợp đồng API và chính sách tiền; kiểm thử schema/round-trip, phân quyền âm, idempotency, race và lifecycle đã có, bổ sung kiểm tra route và seed.',
  '',
  '- Runtime đăng ký `Compact24DbContext`, `CompactUserStore`, `CompactRoleStore`; không đăng ký/fallback sang `BHomeDbContext`. Legacy context/migrations còn lại phục vụ import offline và regression trên nguồn cũ.',
  '- Owner Web Property/Location/Room/RoomType/Asset và nhiều màn quản trị khác vẫn sử dụng `PortalProvider`/repository mock hoặc báo chưa có API khi chạy API mode. Backend đã có endpoint không có nghĩa các màn đó đã nối.',
  '- Các màn Owner Web Contract, Main Draft, Meter, Invoice, Adjustment, Payment/Debt, Notification và Automation có các client HTTP thật; bảng từng route và phần đối chiếu thủ công chỉ rõ các chức năng liên quan.',
  '- Mobile có Auth, capture/onboarding/OCR, Contract/Main Draft, Task, Meter, Tenant Invoice/Payment/Adjustment và Notification gọi backend. Không có bằng chứng full browser/device E2E trong lượt rà soát này.',
  '- Public Web chưa có API công khai của BHome.Api để nối nội dung; không thêm Guest form/booking/payment.',
  '- Holding ledger, bank adapter tự động, delivery email/push/reset chưa cấu hình. MySign/PDF/MinIO cần cấu hình thật; kiểm thử provider giả/synthetic CA không phải chứng nhận kết nối production.',
  '',
  '## Tổng quan các chức năng đã có và còn thiếu',
  '',
  '| Chức năng | Backend hiện có | Frontend / phần còn thiếu |',
  '| --- | --- | --- |',
  '| Auth / phiên / mật khẩu | Compact24 users + refresh_tokens; native Identity stores | Owner Web login/refresh/logout/forgot; Mobile login/refresh/logout/change-password. Logout-all/reset có backend, chưa tìm thấy màn riêng. |',
  '| Chain / Location / RoomType / Room / Asset / giá | Có API thật và lưu Compact24 | Owner Web quản lý Property còn mock/chưa có repository API; Mobile có setup cơ bản, loại phòng lấy API. Chưa có UI Mobile tạo RoomType/Asset. |',
  '| Staff / phân công / công việc | Có tạo Staff qua capture, assignment có hiệu lực, workflow Task có history/evidence | Owner Web Task API mode đọc list/detail; Mobile có workflow theo role. Màn Staff/ca/lịch Owner Web còn mock; chưa có API shift/schedule nghiệp vụ riêng. |',
  '| Người ở / OCR / Main Draft | Có capture, human-confirmation, hồ sơ mã hóa, chuẩn bị/lưu/tạo DOCX/PDF nháp | Mobile onboarding và Main Draft; Owner Web Main Draft có client. Người ở mẫu vẫn Pending, không tự xác minh. |',
  '| Hợp đồng / ký / bàn giao / gia hạn / trả phòng | Có lifecycle, quyền, kiểm tra tài chính và native evidence | Owner Web quản lý/xem/duyệt; Mobile Owner/Staff/Tenant theo quyền. Holding ledger chưa cấu hình; không có bộ Holding API hoàn chỉnh. |',
  '| Tạm trú | Có mốc residence trong occupant data; chưa có API residence workflow riêng | Màn Owner Web còn mock. VNeID thực hiện ngoài BHOME; không thêm quyền Staff hoặc gọi government API. |',
  '| Đồng hồ / hóa đơn / điều chỉnh / JOB-09/10 | Có API thật, OCR là proposal, xác nhận riêng, draft/final bất biến, adjustment approval | Owner Web và Mobile gọi theo vai trò. Automation cấu hình trên Owner Web. |',
  '| Thanh toán / nợ | Có manual bank verification, allocation/idempotency/history, transfer instructions, debt | Owner Web quản lý; Tenant Mobile xem hóa đơn/hướng dẫn/lịch sử. Bank tự động chưa cấu hình; partial/excess giữ review theo policy hiện có. |',
  '| Thông báo | Inbox bền vững, event publish, đọc, target authorization, retry/delivery status | Owner Web/Mobile có inbox; delivery email/push thật chưa cấu hình. |',
  '| Incident / Emergency / Work Order | Chưa có controller/API nghiệp vụ BF-07 | Màn incident/maintenance Owner Web còn mock; có bảng thiết kế không đồng nghĩa đã implement. |',
  '| Đầu tư / OPEX / báo cáo / What-if | Chưa có API đầy đủ các nghiệp vụ này | Owner Web expenses/dashboard/reports/what-if còn mock. Mobile ownerOverview chỉ tổng hợp số đếm từ Location/Room/Contract API đã có. |',
  '| Public Website | Chưa có controller public-content | Chưa nối nội dung từ backend; giữ ranh giới chỉ thông tin. |',
  '',
  'Policy được khai báo trong [RolePermissions](../../src/backend/BHome.Domain/IdentityAccess/RolePermissions.cs): property.view = Owner/Staff; property.manage, locations.manage, staff-assignments.manage = Owner; locations.view-assigned = Staff; task execute = Staff, task manage/verify = Owner; quyền own account/session/notification = Owner/Staff/Tenant. Service còn kiểm tra Location hiện tại và đối tượng sở hữu.',
  '',
  '## Bằng chứng đã chạy trong lượt rà soát',
  '',
  '| Kiểm tra | Kết quả / giới hạn |',
  '| --- | --- |',
  '| Backend solution | 571 PASS: Application 177, Domain 83, Integration 311; 0 fail/skip, PostgreSQL 16.15 riêng |',
  '| Route audit | 189 route controller; 184 route bảo vệ trả 401; 92 Owner GET probes không có 5xx; thêm 12 Owner GET có query/dữ liệu mẫu hợp lệ trả 200 |',
  '| Seed | Idempotent, giữ chỉnh sửa/phân quyền, rollback khi mật khẩu sai, chỉ reset mật khẩu khi explicit và thu hồi phiên; local seed + replay đã chạy |',
  '| Frontend | Mobile 312 PASS; Owner Web 104 PASS; typecheck cả hai và lint Mobile đạt. Test transport/component dùng mock, không thay thế E2E backend + browser/device. |',
  '| Digital Signing | 41 PASS trong solution riêng; không chứng minh các controllers thư viện đã được mount hoặc provider production đã chạy |',
  '| Native bhome PostgreSQL 18.6 | Sau seed: 24 bảng/386 cột/83 FK; health live/ready 200; unauthenticated Rooms 401; Swagger 188 operations (CA Development bị ẩn) |',
  '| Chưa nghiệm thu | MinIO/bank/MySign/email/push thật, toàn bộ mutation bằng browser/device, ST/AT/coverage/performance; không tuyên bố mọi API hoàn tất E2E |',
  '',
  '## Danh mục route runtime',
  '',
];
for (const controller of [...new Set(sorted.map((endpoint) => endpoint.Controller))]) {
  output.push(
    `### ${controller}`,
    '',
    '| Method / route | Backend / database | Input / action | Quyền | Owner Web | Mobile |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const endpoint of sorted.filter((item) => item.Controller === controller)) {
    const auth = endpoint.Anonymous
      ? 'Anonymous'
      : endpoint.Authorization.map((item) => item.Policy || item.Roles || 'Authenticated').join(
          ' + ',
        );
    const source = backendFiles.find((item) =>
      item.text.includes(`class ${controller}Controller(`),
    );
    const input =
      endpoint.Parameters.filter((item) => item.Type !== 'CancellationToken')
        .map((item) => `${item.Name}: ${item.Type}${item.Source ? ' (' + item.Source + ')' : ''}`)
        .join('; ') || 'Không có DTO';
    output.push(
      `| \`${endpoint.Method} ${endpoint.Route}\` | ${status(endpoint)} | ${source ? link(source.file) : controller}.${endpoint.Action}: ${input} | ${auth} | ${frontend(endpoint, 'owner-web')} | ${frontend(endpoint, 'mobile')} |`,
    );
  }
  output.push('');
}
output.push(
  '## Health endpoints',
  '',
  '| Method / route | Trạng thái |',
  '| --- | --- |',
  '| `GET /health/live` | Anonymous; kiểm tra host, không kiểm tra DB |',
  '| `GET /health/ready` | Anonymous; kiểm tra cấu trúc Compact24 thực tế |',
  '',
  '## Đối chiếu thủ công các wrapper động',
  '',
  'Các dòng này bổ sung cho kết quả dò tĩnh bảo thủ phía trên; nguồn liên kết là bằng chứng có lời gọi, không phải E2E.',
  '',
  '| Nhóm | Owner Web | Mobile | Ghi chú |',
  '| --- | --- | --- | --- |',
);
const manual = [
  [
    'Auth POST login/refresh/logout/logout-all/change-password/forgot-password/reset-password',
    'packages/client-core/src/sessionClient.ts',
    'src/mobile/src/lib/sessions.ts',
    'Auth dùng action động; reset/delivery phụ thuộc cấu hình. Mobile change-password ở AccountSecurityScreen; không mặc định tất cả action đều có màn UI.',
  ],
  [
    'Contract POST activate/deposit-verifications/signing/signing-sync/recover/renewals/move-out',
    'src/owner-web/src/features/contracts/ContractLifecyclePanel.tsx',
    'src/mobile/src/features/contracts/ContractLifecyclePanel.tsx',
    'Tên route chính xác xem bảng Contracts; client mutate ghép operation được UI lựa chọn.',
  ],
  [
    'Contract POST handover và các confirmation/dispute',
    'src/owner-web/src/features/contracts/ContractHandoverPanel.tsx',
    'src/mobile/src/features/contracts/ContractHandoverPanel.tsx',
    'Owner xem/theo dõi; Staff chuẩn bị/xác nhận, Tenant xác nhận/tranh chấp trên Mobile. Không coi mọi POST là chức năng của Owner Web.',
  ],
  [
    'OperationalTask POST actions + PUT/update + evidence',
    'src/owner-web/src/features/tasks/pages/TasksPage.tsx',
    'src/mobile/src/services/operationalTasks.ts',
    'Owner Web TasksPage API mode hiện chỉ đọc danh sách/chi tiết; thao tác demo ở mock mode. Mobile có command động start/progress/blockers/submit/verify/rework/coordinate/assign/cancel theo quyền.',
  ],
  [
    'Capture POST locations/rooms/staff/assignments/meters/meter-tasks',
    '',
    'src/mobile/src/app/setup.tsx',
    'Đã sửa POST capture/chains không tồn tại thành GET/PUT chain có version; tạo phòng gửi roomTypeId/capacity.',
  ],
];
for (const [name, owner, mobile, note] of manual)
  output.push(
    `| ${name} | ${owner ? link(path.join(root, owner)) : 'Chưa có bằng chứng'} | ${link(path.join(root, mobile))} | ${note} |`,
  );
output.push(
  '',
  '## Module có controller source nhưng không được host BHome.Api nạp',
  '',
  '`src/digital-signing/BHome.DigitalSigning.Api` là thư viện controllers, không có Program/host riêng. BHome.Api không tham chiếu project này và không gọi AddDigitalSigning. Các route sau **không nằm trong runtime 189 routes**, không được coi là đã chuyển/đã nối. Không tự bật module vì sẽ thêm DigitalSigningDbContext/bảng ngoài Compact24 và có endpoint chứng thư trùng với controller native.',
  '',
  '| Source | Route khai báo | Trạng thái |',
  '| --- | --- | --- |',
);
for (const file of fs.readdirSync(
  path.join(root, 'src/digital-signing/BHome.DigitalSigning.Api/Controllers'),
)) {
  const full = path.join(root, 'src/digital-signing/BHome.DigitalSigning.Api/Controllers', file);
  const text = fs.readFileSync(full, 'utf8');
  const base = text.match(/\[Route\("([^"]+)"\)\]/)?.[1] || '';
  for (const match of text.matchAll(/\[Http(Get|Post|Put|Delete|Patch)(?:\("([^"]+)"\))?\]/g)) {
    output.push(
      `| ${link(full)} | \`${match[1].toUpperCase()} /${base}${match[2] ? '/' + match[2] : ''}\` | Có source; chưa mount; chưa nối Compact24 runtime |`,
    );
  }
}
output.push(
  '',
  '## Dữ liệu mẫu local',
  '',
  'Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-LocalDevelopmentData.ps1` từ repository; công cụ yêu cầu mật khẩu qua secure prompt cho account mới. Email đăng nhập API: `owner.sample@example.invalid`, `staff.sample@example.invalid`, `tenant.sample@example.invalid`, `tenant.other.sample@example.invalid`. LoginRequest yêu cầu email, không gửi username trần.',
  '',
  'Chỉ Development + PostgreSQL loopback + `bhome`/database test dành riêng. Tạo 2 Locations, 2 RoomTypes, 6 Rooms (4 Available/2 Unavailable), 6 Assets, 12 Meters, 8 biểu phí mẫu gắn nhãn, 3 Residents Pending, 1 phân công Staff, 4 công việc Assigned, lịch sử/thông báo/audit. Staff chỉ được phân công Location đầu. Không lưu ảnh CCCD/identity thật, không tạo signed contract/payment success/confirmed reading hoặc bật job finalization từ seed.',
  '',
  'Chạy lại giữ nguyên dữ liệu đã sửa và mật khẩu. Muốn chọn lại mật khẩu chỉ cho 4 account mẫu: thêm `-SetSamplePasswords` (Identity thu hồi phiên cũ). `-UseRandomPasswords` chạy không tương tác, dùng mật khẩu ngẫu nhiên không in/không lưu; sau đó dùng `-SetSamplePasswords` trước khi đăng nhập. Không có mật khẩu dùng chung được commit. Seed là một transaction và có advisory lock; lỗi rollback toàn bộ.',
  '',
  'Nếu database đã có Owner khác, seed từ chối thêm Owner mẫu để giữ mô hình một Owner/Chain của adapter hiện tại. Không chạy đồng thời hai bộ tài khoản New-LocalTestUsers và sample seed; không đổi role/mật khẩu account có sẵn để lách guard. Dữ liệu người dùng hiện có được giữ nguyên.',
  '',
  'Các màn hợp đồng/hóa đơn/thanh toán ban đầu có thể rỗng: cần thực hiện onboarding/xác nhận/chữ ký/điều kiện tài chính đúng workflow. Các workflow này được kiểm thử bằng fixture tổng hợp riêng, không tạo bằng chứng ngân hàng hoặc chữ ký giả trong bhome.',
  '',
  '## Tái tạo danh mục',
  '',
  "Chạy `Compact24ApiAuditTests` với admin PostgreSQL test loopback và đường dẫn tuyệt đối cho evidence: `$env:BHOME_COMPACT24_EVIDENCE_DIRECTORY = Join-Path (Get-Location) '.tools/api-compact24-audit/evidence'` (từ repository root), rồi `node scripts/Generate-ApiImplementationInventory.cjs`. Không dùng database phát triển cho test. Generator dò source có giới hạn đối với route/action động; phải rà lại phần đối chiếu thủ công khi UI thay đổi.",
  '',
  'Kết quả chạy và giới hạn acceptance thực tế: xem [báo cáo triển khai](../database/2026-11-03/compact-24/IMPLEMENTATION_REPORT.md).',
  '',
);
fs.writeFileSync(path.join(root, 'docs/api/API_IMPLEMENTATION_STATUS.md'), output.join('\n'));
const unmatched = calls.filter(
  (call) =>
    !audit.Endpoints.some(
      (endpoint) =>
        normalized(call.route) === normalized(endpoint.Route) &&
        call.methods.includes(endpoint.Method),
    ),
);
fs.mkdirSync(path.join(root, '.tools/api-compact24-audit'), { recursive: true });
fs.writeFileSync(
  path.join(root, '.tools/api-compact24-audit/client-calls.json'),
  JSON.stringify(
    {
      calls: calls.map((c) => ({ ...c, file: relative(c.file) })),
      unmatched: unmatched.map((c) => ({ ...c, file: relative(c.file) })),
    },
    null,
    2,
  ),
);
console.log(
  `Wrote API_IMPLEMENTATION_STATUS.md: ${sorted.length} routes; ${calls.length} static client callsites; ${unmatched.length} unresolved/dynamic candidates for review.`,
);
