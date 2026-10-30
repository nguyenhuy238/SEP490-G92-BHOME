import { workflowTransitions } from '../workflowTransitions';
import { prepareProperty, applyPropertyCommand } from '../../features/property/mockProperty';
import { createSeed } from '../mock/seed';
import { featureDefinitions } from '../../app/featureDefinitions';
import type {
  DemoDatabase,
  PortalRecord,
  PortalRepository,
  ResourceKind,
  Scenario,
} from '../../types/portal';

export const STORAGE_KEY = 'bhome-owner-demo-v1';
const delay = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 120);
    signal?.addEventListener('abort', abort, { once: true });
  });
export const invoiceBalance = (row: PortalRecord) =>
  Math.max(0, row.amount + Number(row.attributes.approvedAdjustment || 0) - row.paid);

export function createMockRepository(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): PortalRepository {
  let cached: DemoDatabase | undefined;
  function load(): DemoDatabase {
    if (cached) return structuredClone(cached);
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return prepareProperty(createSeed());
    try {
      const data = JSON.parse(raw) as DemoDatabase;
      if (
        data.version !== 1 ||
        !data.records ||
        !Array.isArray(data.audit) ||
        !Array.isArray(data.scenarios)
      )
        throw new Error();
      for (const kind of Object.keys(createSeed().records) as ResourceKind[])
        if (!Array.isArray(data.records[kind])) throw new Error();
      return prepareProperty(data);
    } catch {
      throw new Error(
        'Dữ liệu demo không hợp lệ. Dùng Khôi phục dữ liệu demo trong thanh công cụ.',
      );
    }
  }
  function commit(db: DemoDatabase, kind: ResourceKind, recordId: string, action: string) {
    db.audit.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action,
      kind,
      recordId,
    });
    db.audit = db.audit.slice(0, 500);
    // Persist first: quota/storage failures must not report false success.
    storage.setItem(STORAGE_KEY, JSON.stringify(db));
    cached = structuredClone(db);
  }
  function find(db: DemoDatabase, kind: ResourceKind, id: string) {
    const row = db.records[kind].find((row) => row.id === id);
    if (!row) throw new Error('Hồ sơ không còn tồn tại. Vui lòng tải lại.');
    return row;
  }
  function validate(db: DemoDatabase, kind: ResourceKind, row: PortalRecord) {
    if (
      !featureDefinitions
        .find((definition) => definition.kind === kind)
        ?.statuses.includes(row.status)
    )
      throw new Error('Trạng thái không thuộc danh mục hỗ trợ.');
    if (!row.name.trim() || !row.code.trim()) throw new Error('Tên và mã hồ sơ là bắt buộc.');
    if (!Number.isSafeInteger(row.amount) || row.amount < 0)
      throw new Error('Số tiền phải là số nguyên VND không âm trong giới hạn an toàn.');
    if (
      db.records[kind].some(
        (other) =>
          other.id !== row.id &&
          other.code === row.code &&
          (kind !== 'rooms' || other.locationId === row.locationId),
      )
    )
      throw new Error('Mã hồ sơ đã tồn tại.');
    if (row.locationId && !db.records.locations.some((location) => location.id === row.locationId))
      throw new Error('Cơ sở không tồn tại.');
    if (row.roomId) {
      const room = find(db, 'rooms', row.roomId);
      if (room.locationId !== row.locationId) throw new Error('Phòng không thuộc cơ sở đã chọn.');
    }
    if (
      row.tenantId &&
      !db.records.tenants.some(
        (tenant) => tenant.id === row.tenantId && tenant.roomId === row.roomId,
      )
    )
      throw new Error('Khách thuê không thuộc phòng đã chọn.');
    if (
      kind === 'meters' &&
      (row.current < row.previous || row.previous < 0 || !Number.isFinite(row.current))
    )
      throw new Error('Chỉ số mới phải lớn hơn hoặc bằng chỉ số cũ.');
    if (
      kind === 'meters' &&
      (!Number.isFinite(Number(row.attributes.waterCurrent || 0)) ||
        Number(row.attributes.waterCurrent || 0) < Number(row.attributes.waterPrevious || 0))
    )
      throw new Error('Chỉ số nước mới không được nhỏ hơn chỉ số cũ.');
    if (kind === 'incidents' && !['Khẩn cấp', 'Thông thường'].includes(row.category))
      throw new Error('Mức độ sự cố phải là Khẩn cấp hoặc Thông thường.');
    if (
      kind === 'pricing' &&
      ['electricityRate', 'waterRate', 'serviceRate'].some(
        (key) =>
          row.attributes[key] !== undefined &&
          (!Number.isSafeInteger(Number(row.attributes[key])) || Number(row.attributes[key]) < 0),
      )
    )
      throw new Error('Đơn giá phải là số nguyên VND không âm.');
    if (
      kind === 'rooms' &&
      row.category &&
      !db.records['room-types'].some((type) => type.id === row.category)
    )
      throw new Error('Loại phòng không tồn tại.');
    if (
      row.staffId &&
      ['tasks', 'schedules', 'maintenance'].includes(kind) &&
      !db.records.staff.some(
        (staff) =>
          staff.id === row.staffId && (!row.locationId || staff.locationId === row.locationId),
      )
    )
      throw new Error('Nhân viên chưa được phân công cho cơ sở này.');
    if (kind === 'contracts' && row.endDate <= row.date)
      throw new Error('Ngày hết hạn phải sau ngày bắt đầu.');
    if (kind === 'schedules') {
      if (row.endDate < row.date) throw new Error('Khoảng ngày phân ca không hợp lệ.');
      for (const value of Object.values(row.attributes))
        if (
          /^\d{2}:\d{2}/.test(value) &&
          !/^([01]\d|2[0-3]):[0-5]\d[–-]([01]\d|2[0-3]):[0-5]\d$/.test(value)
        )
          throw new Error('Ca dùng định dạng HH:mm–HH:mm.');
      if (
        row.staffId &&
        db.records.schedules.some(
          (other) =>
            other.id !== row.id &&
            other.staffId === row.staffId &&
            other.date <= row.endDate &&
            other.endDate >= row.date,
        )
      )
        throw new Error('Nhân viên đã có lịch trong khoảng thời gian này.');
    }
  }
  return {
    async executeProperty(command) {
      await delay();
      const db = load();
      applyPropertyCommand(db, command);
      commit(db, 'rooms', 'property', `Mô phỏng: ${command.kind}${'reason' in command ? ` — ${command.reason}` : ''}`);
    },
    async read(signal) {
      await delay(signal);
      const db = load();
      db.records.debts = db.records.debts
        .map((row) => {
          const invoice = db.records.invoices.find((invoice) => invoice.id === row.invoiceId);
          return invoice
            ? {
                ...row,
                amount: invoice.amount + Number(invoice.attributes.approvedAdjustment || 0),
                paid: invoice.paid,
              }
            : row;
        })
        .filter(
          (row) =>
            row.amount > row.paid &&
            db.records.invoices.some(
              (invoice) => invoice.id === row.invoiceId && invoice.status !== 'Nháp',
            ),
        );
      return db;
    },
    async save(kind, input) {
      await delay();
      const db = load();
      const row = structuredClone(input);
      const old = db.records[kind].find((old) => old.id === row.id);
      if (kind === 'debts' && !old)
        throw new Error('Công nợ được tính từ hóa đơn; không tạo số dư độc lập.');
      if (kind === 'payments' && !old && row.amount <= 0)
        throw new Error('Giao dịch cần số tiền lớn hơn 0 VND.');
      if (kind === 'invoices' && (!old || old.status === 'Nháp')) {
        const parts = ['rent', 'utilities', 'service'].map((key) =>
          Number(row.attributes[key] || (key === 'rent' ? row.amount : 0)),
        );
        if (parts.some((value) => !Number.isSafeInteger(value) || value < 0))
          throw new Error('Các khoản tiền hóa đơn phải là số nguyên VND không âm.');
        row.amount = parts.reduce((sum, value) => sum + value, 0);
        row.attributes.rent = String(parts[0]);
        row.attributes.utilities = String(parts[1]);
        row.attributes.service = String(parts[2]);
      }
      if (kind === 'tenants' && row.roomId)
        row.contractId =
          db.records.contracts.find(
            (contract) => contract.roomId === row.roomId && contract.status === 'Đang hiệu lực',
          )?.id || '';
      validate(db, kind, row);
      if (old && ['payments', 'debts'].includes(kind))
        throw new Error(
          'Dữ liệu đối soát và số dư được quản lý theo hóa đơn; không sửa trực tiếp.',
        );
      if (
        kind === 'contracts' &&
        (!old || old.status !== 'Bản nháp') &&
        row.status !== 'Bản nháp' &&
        !old
      )
        throw new Error('Hợp đồng mới phải bắt đầu ở bản nháp.');
      if (old && old.status !== row.status)
        throw new Error('Dùng thao tác chuyển trạng thái để bảo toàn quy trình.');
      if (
        old &&
        kind === 'contracts' &&
        old.status !== 'Bản nháp' &&
        (row.amount !== old.amount || row.roomId !== old.roomId || row.tenantId !== old.tenantId)
      )
        throw new Error('Hợp đồng sau bản nháp không được đổi điều khoản trực tiếp.');
      if (old && kind === 'invoices' && old.status !== 'Nháp') {
        const changed = Object.keys(row).some(
          (key) =>
            !['attributes', 'description'].includes(key) &&
            JSON.stringify(row[key as keyof PortalRecord]) !==
              JSON.stringify(old[key as keyof PortalRecord]),
        );
        if (changed) throw new Error('Hóa đơn đã phát hành bất biến. Hãy dùng yêu cầu điều chỉnh.');
        if (!['Yêu cầu điều chỉnh', 'Chờ duyệt điều chỉnh'].includes(old.status))
          throw new Error('Hóa đơn đã phát hành không được sửa.');
        if (row.attributes.approvedAdjustment !== old.attributes.approvedAdjustment)
          throw new Error('Khoản điều chỉnh phải được phê duyệt qua quy trình.');
        for (const key of new Set([...Object.keys(old.attributes), ...Object.keys(row.attributes)]))
          if (
            !['requestedAdjustment', 'adjustmentReason'].includes(key) &&
            row.attributes[key] !== old.attributes[key]
          )
            throw new Error('Không được sửa chi tiết hóa đơn đã phát hành.');
      }
      if (kind === 'invoices' && !old && row.status !== 'Nháp')
        throw new Error('Hóa đơn mới phải là bản nháp.');
      if (old) db.records[kind] = db.records[kind].map((item) => (item.id === row.id ? row : item));
      else db.records[kind].unshift(row);
      if (kind === 'invoices' && !old)
        db.records.debts.push({
          ...row,
          id: `debt-${row.id}`,
          invoiceId: row.id,
          status: 'Chưa nhắc',
        });
      commit(db, kind, row.id, old ? 'Cập nhật bản ghi demo' : 'Tạo bản ghi demo');
      return row;
    },
    async remove(kind, id) {
      await delay();
      const db = load();
      find(db, kind, id);
      if (
        ![
          'locations',
          'rooms',
          'room-types',
          'assets',
          'staff',
          'pricing',
          'public-content',
          'notifications',
          'schedules',
        ].includes(kind)
      )
        throw new Error('Không xóa lịch sử nghiệp vụ.');
      const relation = (
        {
          locations: 'locationId',
          rooms: 'roomId',
          tenants: 'tenantId',
          staff: 'staffId',
          assets: 'assetId',
        } as Partial<Record<ResourceKind, keyof PortalRecord>>
      )[kind];
      if (
        relation &&
        Object.values(db.records)
          .flat()
          .some((row) => row.id !== id && row[relation] === id)
      )
        throw new Error('Hồ sơ đang được tham chiếu, không thể xóa.');
      if (kind === 'room-types' && db.records.rooms.some((row) => row.category === id))
        throw new Error('Loại phòng đang được sử dụng.');
      db.records[kind] = db.records[kind].filter((row) => row.id !== id);
      commit(db, kind, id, 'Xóa bản ghi demo');
    },
    async transition(kind, id, status) {
      await delay();
      const db = load(),
        row = find(db, kind, id);
      if (row.status === status) return;
      if (
        !featureDefinitions
          .find((definition) => definition.kind === kind)
          ?.statuses.includes(status)
      )
        throw new Error('Trạng thái không thuộc danh mục hỗ trợ.');
      if (workflowTransitions[kind] && !workflowTransitions[kind]![row.status]?.includes(status))
        throw new Error('Chuyển trạng thái không hợp lệ.');
      if (kind === 'payments') throw new Error('Dùng khớp giao dịch với hóa đơn để đối soát.');
      if (
        kind === 'rooms' &&
        ['Trống khai thác', 'Bảo trì'].includes(status) &&
        db.records.contracts.some(
          (contract) => contract.roomId === id && contract.status === 'Đang hiệu lực',
        )
      )
        throw new Error('Phòng đang có hợp đồng hiệu lực; cần hoàn tất quy trình kết thúc riêng.');
      if (
        kind === 'tenants' &&
        status === 'Đã trả phòng' &&
        db.records.contracts.some(
          (contract) => contract.tenantId === id && contract.status === 'Đang hiệu lực',
        )
      )
        throw new Error(
          'Khách đang có hợp đồng hiệu lực; cần kiểm tra bàn giao và kết thúc hợp đồng trước.',
        );
      validate(db, kind, row);
      if (kind === 'contracts' && status === 'Chờ xác nhận cọc' && !row.signed)
        throw new Error('Cần ghi nhận xác nhận chữ ký hai bên (demo).');
      if (kind === 'contracts' && status === 'Đang hiệu lực') {
        if (!row.tenantId || !row.roomId)
          throw new Error('Cần gán khách thuê đại diện và phòng trước khi kích hoạt.');
        if (!row.signed || !row.depositConfirmed)
          throw new Error('Cần xác nhận chữ ký hai bên và khoản cọc (demo).');
        if (
          db.records.contracts.some(
            (other) =>
              other.id !== id && other.roomId === row.roomId && other.status === 'Đang hiệu lực',
          )
        )
          throw new Error('Phòng đang có hợp đồng hiệu lực.');
        find(db, 'rooms', row.roomId).status =
          row.category === 'Giữ chỗ' ? 'Đang giữ chỗ' : 'Đang thuê';
        find(db, 'tenants', row.tenantId).status = 'Đang ở';
      }
      if (kind === 'invoices' && status === 'Đã phát hành' && row.status === 'Nháp') {
        if (
          !db.records.meters.some(
            (meter) => meter.roomId === row.roomId && meter.status === 'Đã xác nhận',
          )
        )
          throw new Error('Cần chỉ số điện nước đã xác nhận trước khi phát hành.');
        if (
          db.records.invoices.some(
            (other) =>
              other.id !== id &&
              other.contractId === row.contractId &&
              other.date.slice(0, 7) === row.date.slice(0, 7) &&
              other.status !== 'Nháp',
          )
        )
          throw new Error('Đã có hóa đơn kỳ này cho hợp đồng.');
      }
      if (
        kind === 'invoices' &&
        row.status === 'Chờ duyệt điều chỉnh' &&
        status === 'Đã phát hành'
      ) {
        const delta = Number(row.attributes.requestedAdjustment);
        if (
          !Number.isSafeInteger(delta) ||
          !row.attributes.adjustmentReason?.trim() ||
          row.amount + Number(row.attributes.approvedAdjustment || 0) + delta < row.paid
        )
          throw new Error(
            'Điều chỉnh cần số nguyên VND, lý do và không làm tổng phải thu thấp hơn số đã phân bổ.',
          );
        row.attributes.approvedAdjustment = String(
          Number(row.attributes.approvedAdjustment || 0) + delta,
        );
        row.attributes.requestedAdjustment = '0';
      }
      if (
        kind === 'incidents' &&
        status === 'Đã giải quyết' &&
        db.records.maintenance.some(
          (work) => work.incidentId === id && work.status !== 'Đã nghiệm thu',
        )
      )
        throw new Error('Cần nghiệm thu mọi lệnh sửa chữa liên quan trước khi đóng sự cố.');
      if (
        kind === 'handovers' &&
        status === 'Hoàn thành' &&
        (row.attributes.staffConfirmed !== 'true' ||
          row.attributes.tenantConfirmed !== 'true' ||
          ['Cửa & khóa', 'Điều hòa', 'Tủ lạnh', 'Điện nước'].some(
            (item) => row.attributes[`check-${item}`] !== 'true',
          ))
      )
        throw new Error(
          'Cần kiểm tra đầy đủ hiện trạng và xác nhận của nhân viên, khách thuê (demo).',
        );
      row.status = status;
      if (kind === 'public-content') row.published = status === 'Đã xuất bản';
      commit(db, kind, id, `Chuyển trạng thái demo: ${status}`);
    },
    async reconcile(paymentId, invoiceId) {
      await delay();
      const db = load(),
        payment = find(db, 'payments', paymentId),
        invoice = find(db, 'invoices', invoiceId);
      if (payment.status === 'Đã đối soát') {
        if (payment.invoiceId === invoiceId) return;
        throw new Error('Giao dịch đã phân bổ cho hóa đơn khác.');
      }
      if (!['Đã phát hành', 'Đã thanh toán'].includes(invoice.status))
        throw new Error('Chỉ khớp với hóa đơn đã phát hành.');
      if (payment.amount > invoiceBalance(invoice))
        throw new Error('Số tiền vượt dư nợ. Cần quy trình xử lý tiền thừa riêng.');
      invoice.paid += payment.amount;
      if (invoiceBalance(invoice) === 0) invoice.status = 'Đã thanh toán';
      payment.invoiceId = invoice.id;
      payment.tenantId = invoice.tenantId;
      payment.locationId = invoice.locationId;
      payment.roomId = invoice.roomId;
      payment.status = 'Đã đối soát';
      commit(db, 'payments', paymentId, 'Khớp giao dịch demo — không kết nối ngân hàng');
    },
    async saveScenario(scenario: Scenario) {
      await delay();
      const db = load();
      db.scenarios = [
        ...db.scenarios.filter((old) => old.id !== scenario.id),
        structuredClone(scenario),
      ];
      commit(db, 'expenses', scenario.id, 'Lưu kịch bản độc lập');
    },
    async markAllRead() {
      await delay();
      const db = load();
      db.records.notifications.forEach((row) => {
        row.status = 'Đã đọc';
      });
      commit(db, 'notifications', 'all', 'Đọc tất cả thông báo');
    },
    async recordDebtFollowup(id, date, note) {
      await delay();
      const db = load(),
        row = find(db, 'debts', id);
      if (!note.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('Cần ghi chú và ngày hẹn hợp lệ.');
      row.attributes.followupDate = date;
      row.attributes.followupNote = note.trim();
      row.status = 'Đã hẹn lịch';
      commit(db, 'debts', id, 'Ghi nhận hẹn thanh toán demo — không gửi tin nhắn');
    },
    async reset() {
      const db = createSeed();
      storage.setItem(STORAGE_KEY, JSON.stringify(db));
      cached = undefined;
    },
  };
}
