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
const auditDate = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(auditDate || ''))
  throw new Error('Pass the verified audit date as YYYY-MM-DD after the manifest path.');
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
  if (
    endpoint.Controller === 'Refunds' &&
    app === 'owner-web' &&
    !endpoint.Route.endsWith('/deposit-refunds')
  )
    return `Có lời gọi: ${link(path.join(root, 'src/owner-web/src/features/payments/RefundPanel.tsx'))}`;
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
const probeStatuses = audit.OwnerGetProbes.reduce((counts, probe) => {
  counts[probe.Status] = (counts[probe.Status] || 0) + 1;
  return counts;
}, {});
if (sorted.some((endpoint) => !endpoint.Anonymous && endpoint.AnonymousStatus !== 401))
  throw new Error('Manifest has a protected route without the expected unauthenticated 401.');
if (
  new Set(sorted.map((endpoint) => endpoint.Method + ' ' + endpoint.Route)).size !== sorted.length
)
  throw new Error('Manifest contains duplicate method/route pairs.');
if (audit.OwnerGetProbes.some((probe) => probe.Status >= 500))
  throw new Error(
    'Manifest contains a failed Owner GET probe; review the audit before publishing.',
  );
const output = [
  '# BHOME — danh mục route runtime',
  '',
  'Ngày xác minh audit: **' + auditDate + '**. Schema: ' + audit.SchemaVersion + '.',
  '',
  'Sinh từ action descriptors của BHome.Api và dò callsite client; không sửa bảng này bằng tay. Xem [trạng thái bàn giao và giới hạn](API_IMPLEMENTATION_STATUS.md), [quy ước](API_CONVENTIONS.md) và [mục lục module](README.md).',
  '',
  '**' +
    sorted.length +
    ' controller routes**, ' +
    protectedCount +
    ' protected (anonymous request trả 401), ' +
    (sorted.length - protectedCount) +
    ' anonymous; thêm 2 health endpoints. Owner GET probes: **' +
    audit.OwnerGetProbes.length +
    '**, phân bố HTTP: ' +
    Object.entries(probeStatuses)
      .map(([status, count]) => status + '=' + count)
      .join(', ') +
    '.',
  '',
  'Probe GET dùng ID không tồn tại hoặc thiếu query kiểm nhánh lỗi/không phụ thuộc legacy; không chứng minh mọi happy path. Route Development vẫn xuất hiện trong descriptor nhưng có environment/configuration gate. Có lời gọi nghĩa là có source callsite, chưa phải E2E; client dùng chung chưa chứng minh màn hình đã dùng. Wrapper action động có thể không được dò ra; xem phần đối chiếu thủ công trong trạng thái bàn giao.',
  '',
  'Policy ở nhiều attribute áp dụng kết hợp; các role trong cùng attribute là OR. Service còn kiểm tra Location/Tenant/đối tượng. DTO body/query ở cột Input; response schema xem tài liệu module, DTO source và Swagger Development. Không suy schema JSON từ tên CLR.',
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
      new RegExp(`class\\s+${controller}Controller\\b`).test(item.text),
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
  '## Tái tạo',
  '',
  'Chạy audit trên database test loopback độc lập rồi chạy generator với manifest và ngày audit thực tế. Lệnh đầy đủ: [hướng dẫn bàn giao](API_IMPLEMENTATION_STATUS.md#tái-tạo-và-kiểm-tra-tài-liệu). Generator chỉ ghi file này; bản tổng quan và quyết định nghiệp vụ được duy trì riêng.',
  '',
);
fs.writeFileSync(path.join(root, 'docs/api/API_RUNTIME_ROUTES.md'), output.join('\n'));
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
  `Wrote API_RUNTIME_ROUTES.md: ${sorted.length} routes; ${calls.length} static client callsites; ${unmatched.length} unresolved/dynamic candidates for review.`,
);
