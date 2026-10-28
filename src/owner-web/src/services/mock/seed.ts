import {
  resourceKinds,
  type DemoDatabase,
  type PortalRecord,
  type ResourceKind,
} from '../../types/portal';
import { featureDefinitions } from '../../app/featureDefinitions';
import stitchRows from './stitchRows.json';

export const DEMO_DATE = '2024-10-18';
export function makeRecord(kind: ResourceKind, value: Partial<PortalRecord> = {}): PortalRecord {
  return {
    id: crypto.randomUUID(),
    code: `DEMO-${kind.toUpperCase()}-${Date.now()}`,
    name: '',
    status: featureDefinitions.find((f) => f.kind === kind)?.statuses[0] || 'Bản nháp',
    category: '',
    description: 'Dữ liệu minh họa BHOME — không có hiệu lực giao dịch thực tế.',
    locationId: '',
    roomId: '',
    tenantId: '',
    contractId: '',
    invoiceId: '',
    incidentId: '',
    assetId: '',
    staffId: '',
    amount: 0,
    paid: 0,
    date: DEMO_DATE,
    endDate: '2025-10-18',
    previous: 0,
    current: 0,
    signed: false,
    depositConfirmed: false,
    published: false,
    attributes: {},
    ...value,
  };
}

export function createSeed(): DemoDatabase {
  const records = Object.fromEntries(
    resourceKinds.map((kind) => [kind, [] as PortalRecord[]]),
  ) as Record<ResourceKind, PortalRecord[]>;
  const locations = [
    ['BHOME Central 1 - Bạch Đằng', '184/12 Bạch Đằng, P.24, Q.Bình Thạnh', 'Trần Minh Quân'],
    [
      'BHOME Riverside 2 - Phan Xích Long',
      '45/8 Phan Xích Long, P.2, Q.Phú Nhuận',
      'Lê Thị Thu Hà',
    ],
    [
      'BHOME Garden 3 - Nguyễn Thị Thập',
      '120/4 Nguyễn Thị Thập, P.Tân Hưng, Q.7',
      'Nguyễn Hoàng Nam',
    ],
  ];
  records.locations = locations.map(([name, address, manager], i) =>
    makeRecord('locations', {
      id: `loc-${i + 1}`,
      code: `CS-0${i + 1}`,
      name,
      status: 'Đang vận hành',
      attributes: { address, manager, amenities: 'Thang máy • Khóa vân tay • Camera • Wifi Mesh' },
    }),
  );
  const names = [
    'Trần Quốc Bảo',
    'Lê Thị Thùy Trang',
    'Nguyễn Văn Hân',
    'Vũ Minh Khang',
    'Trần Đình Phú',
    'Ngô Bảo Trâm',
    'Đặng Nam Anh',
    'Phạm Phương Anh',
  ];
  records['room-types'] = [
    'Studio Ban Công Thoáng',
    'Căn Hộ Gác Lửng Cao Cấp',
    'Căn Hộ 1 Phòng Ngủ Riêng Biệt',
    'Studio Tiêu Chuẩn Tiết Kiệm',
  ].map((name, i) =>
    makeRecord('room-types', {
      id: `type-${i}`,
      code: `LP-0${i + 1}`,
      name,
      status: 'Đang áp dụng',
      amount: [5200000, 5800000, 7200000, 4500000][i],
      attributes: {
        capacity: `${[28, 35, 42, 22][i]} m² • 2 người`,
        amenities: 'Bếp riêng • Điều hòa • Tủ lạnh • Wifi',
        assetSummary: '6 danh mục',
      },
    }),
  );
  records.staff = [
    'Trần Minh Quân',
    'Lê Thị Thu Hà',
    'Nguyễn Hoàng Nam',
    'Võ Văn Tuấn',
    'Nguyễn Thị Vân',
    'Phạm Quốc Bảo',
    'Đỗ Văn Tuấn',
  ].map((name, i) =>
    makeRecord('staff', {
      id: `staff-${i}`,
      code: `NV-00${i + 1}`,
      name,
      locationId: `loc-${(i % 3) + 1}`,
      category: i < 3 ? 'Quản lý cơ sở' : i < 5 ? 'Kỹ thuật viên' : 'Bảo vệ & An ninh',
      status: 'Đang làm việc',
      amount: i < 3 ? 14500000 : 11000000,
      attributes: {
        contact: `nv${i + 1}@example.invalid • 09xx xxx ${100 + i}`,
        mon: '08:00–16:30',
        tue: '08:00–16:30',
        wed: '08:00–16:30',
        thu: '08:00–16:30',
        fri: '08:00–16:30',
        sat: '08:00–16:30',
        sun: 'Nghỉ tuần',
      },
    }),
  );
  for (let location = 0; location < 3; location++) {
    const size = [25, 20, 11][location];
    const occupied = [24, 18, 9][location];
    for (let n = 0; n < size; n++) {
      const idx = records.rooms.length;
      const roomId = `room-${idx}`;
      const locationId = `loc-${location + 1}`;
      const room = makeRecord('rooms', {
        id: roomId,
        code: `P.${Math.floor(n / 6) + 1}${String((n % 6) + 1).padStart(2, '0')}`,
        name: `Phòng ${Math.floor(n / 6) + 1}${String((n % 6) + 1).padStart(2, '0')}`,
        locationId,
        status: n < occupied ? 'Đang thuê' : 'Trống khai thác',
        category: records['room-types'][n % 4].id,
        amount: records['room-types'][n % 4].amount,
        attributes: { floor: String(Math.floor(n / 6) + 1), capacity: '28 m² • 2 người' },
      });
      records.rooms.push(room);
      if (n < occupied) {
        const tenantId = `tenant-${idx}`,
          contractId = `contract-${idx}`,
          invoiceId = `invoice-${idx}`;
        const name = `${names[idx % names.length]}${idx >= names.length ? ` ${Math.floor(idx / names.length) + 1}` : ''}`;
        records.tenants.push(
          makeRecord('tenants', {
            id: tenantId,
            code: `KT-${200 + idx}`,
            name,
            locationId,
            roomId,
            contractId,
            category: 'Đại diện hợp đồng',
            status: 'Đang ở',
            attributes: {
              contact: `09xx xxx ${100 + idx} • CCCD: ***${800 + idx}`,
              residence: idx % 6 === 0 ? 'Chờ xác nhận' : 'Đã cập nhật',
            },
          }),
        );
        records.contracts.push(
          makeRecord('contracts', {
            id: contractId,
            code: `HD-2024-${String(idx + 1).padStart(3, '0')}`,
            name: `Hợp đồng thuê ${room.code}`,
            locationId,
            roomId,
            tenantId,
            category: 'Thuê chính thức',
            status: 'Đang hiệu lực',
            amount: room.amount,
            date: '2024-01-15',
            endDate: idx < 4 ? `2024-10-${22 + idx * 2}` : '2025-01-15',
            signed: true,
            depositConfirmed: true,
            attributes: {
              deposit: String(room.amount * 2),
              signature: 'Hai bên xác nhận — minh họa',
            },
          }),
        );
        const amount = room.amount + 920800 + 330000,
          paid = idx % 9 === 0 ? 0 : amount;
        records.invoices.push(
          makeRecord('invoices', {
            id: invoiceId,
            code: `HD-202410-${idx + 1}`,
            name: `Hóa đơn T10 — ${room.code}`,
            locationId,
            roomId,
            tenantId,
            contractId,
            amount,
            paid,
            date: '2024-10-05',
            status: paid ? 'Đã thanh toán' : 'Đã phát hành',
            attributes: {
              rent: String(room.amount),
              utilities: '920800',
              service: '330000',
              approvedAdjustment: '0',
            },
          }),
        );
        records.debts.push(
          makeRecord('debts', {
            id: `debt-${idx}`,
            code: `CN-${idx + 1}`,
            name: `Công nợ ${room.code}`,
            locationId,
            roomId,
            tenantId,
            invoiceId,
            amount,
            paid,
            status: 'Chưa nhắc',
            date: '2024-10-05',
          }),
        );
        records.meters.push(
          makeRecord('meters', {
            id: `meter-${idx}`,
            code: `DH-${idx + 1}`,
            name: `Chỉ số điện nước ${room.code}`,
            locationId,
            roomId,
            tenantId,
            contractId,
            staffId: 'staff-3',
            previous: 1482 + idx * 20,
            current: 1698 + idx * 20,
            status: idx % 7 ? 'Đã xác nhận' : 'Chờ xác nhận',
            attributes: {
              waterPrevious: '246',
              waterCurrent: '250',
              evidence: '2 ảnh minh họa',
              electricityRate: '3800',
              waterRate: '25000',
            },
          }),
        );
      }
    }
  }
  const imported = stitchRows as Record<string, Record<string, string>[]>;
  for (const kind of [
    'assets',
    'pricing',
    'tasks',
    'incidents',
    'maintenance',
    'expenses',
  ] as const) {
    records[kind] = (imported[kind] || [])
      .filter((row) => Object.values(row).some(Boolean))
      .slice(0, 12)
      .map((row, i) => {
        const def = featureDefinitions.find((f) => f.kind === kind)!;
        return makeRecord(kind, {
          id: `${kind}-${i}`,
          code: row.code?.split(' ')[0] || `${kind.toUpperCase()}-${i + 1}`,
          name: row.name || row.category || row.description || `${def.title} ${i + 1}`,
          description:
            row.description || row.name || row.category || 'Dữ liệu minh họa từ thiết kế Stitch.',
          locationId: `loc-${(i % 3) + 1}`,
          roomId: `room-${i % 20}`,
          tenantId: `tenant-${i % 20}`,
          staffId: `staff-${i % 7}`,
          amount: Number(
            (row.amount || '350000').match(/[\d.]+/)?.[0].replaceAll('.', '') || 350000,
          ),
          status: def.statuses[i % def.statuses.length],
          category:
            kind === 'incidents'
              ? i === 0
                ? 'Khẩn cấp'
                : 'Thông thường'
              : row.category || 'Điện nước',
          attributes: { ...row },
        });
      });
  }
  records.maintenance.forEach((row, i) => {
    row.incidentId = records.incidents[i % records.incidents.length]?.id || '';
    row.assetId = records.assets[i % records.assets.length]?.id || '';
  });
  records.handovers = records.contracts.slice(0, 6).map((contract, i) =>
    makeRecord('handovers', {
      id: `handover-${i}`,
      code: `BB-OUT-2024-0${i + 1}`,
      name: `${i % 2 ? 'Bàn giao nhận phòng' : 'Kiểm tra trả phòng'} ${records.rooms.find((r) => r.id === contract.roomId)!.code}`,
      ...{
        locationId: contract.locationId,
        roomId: contract.roomId,
        tenantId: contract.tenantId,
        contractId: contract.id,
      },
      category: i % 2 ? 'Nhận phòng' : 'Trả phòng',
      amount: contract.amount * 2,
      status: 'Chờ kiểm tra',
      attributes: {
        checklist: 'Cửa & khóa: Tốt|Điều hòa: Tốt|Tủ lạnh: Tốt|Điện nước: Chờ kiểm tra',
        staffConfirmed: 'false',
        tenantConfirmed: 'false',
        damage: '0',
        utility: '0',
      },
    }),
  );
  records['temporary-residence'] = records.tenants.slice(0, 8).map((tenant, i) =>
    makeRecord('temporary-residence', {
      id: `residence-${i}`,
      code: `TT-2024-${101 + i}`,
      name: `Thông tin cư trú — ${tenant.name}`,
      locationId: tenant.locationId,
      roomId: tenant.roomId,
      tenantId: tenant.id,
      status: featureDefinitions.find((f) => f.kind === 'temporary-residence')!.statuses[i % 4],
      description:
        'Khách thuê tự đăng ký ngoài BHOME; Owner xác nhận thông tin chỗ ở. Không gửi hồ sơ chính phủ.',
    }),
  );
  records.schedules = records.staff.map((staff, i) =>
    makeRecord('schedules', {
      ...staff,
      id: `schedule-${i}`,
      code: `CA-${i + 1}`,
      staffId: staff.id,
      name: staff.name,
      status: 'Bản nháp',
      date: '2024-10-14',
      endDate: '2024-10-20',
    }),
  );
  records.payments = records.invoices
    .filter((invoice) => invoice.paid)
    .map((invoice, i) =>
      makeRecord('payments', {
        id: `payment-${i}`,
        code: `DEMO-FT2428800${i + 1}`,
        name: `Chuyển khoản minh họa ${i + 1}`,
        invoiceId: invoice.id,
        roomId: invoice.roomId,
        locationId: invoice.locationId,
        tenantId: invoice.tenantId,
        amount: invoice.paid,
        status: 'Đã đối soát',
        description: `Dữ liệu demo • Thanh toán ${invoice.code}`,
        date: '2024-10-15',
      }),
    );
  records.payments.unshift(
    makeRecord('payments', {
      id: 'payment-pending',
      code: 'DEMO-FT242880099',
      name: 'Giao dịch cần khớp thủ công',
      amount: records.invoices[0].amount,
      status: 'Chờ đối soát',
      locationId: 'loc-1',
      description: 'Giao dịch mẫu chưa phân bổ — không phải dữ liệu ngân hàng thực.',
    }),
  );
  records['public-content'] = records.locations.map((location, i) =>
    makeRecord('public-content', {
      ...location,
      id: `public-${i}`,
      code: `PUBLIC-${i + 1}`,
      locationId: location.id,
      status: 'Đã xuất bản',
      published: true,
      name: location.name,
      amount: 5200000,
      description: [
        'Căn hộ dịch vụ tiện nghi trung tâm Bình Thạnh',
        'Căn hộ 1 phòng ngủ — Trái tim phố ẩm thực',
        'Căn hộ studio view thoáng — Sân thượng chill',
      ][i],
    }),
  );
  records.notifications = [
    ['Sự cố khẩn cấp: Rò rỉ nước nhánh kỹ thuật tầng 3', 'Khẩn cấp', 'incidents'],
    ['Đối soát thanh toán: giao dịch minh họa cần khớp', 'Thanh toán', 'payments'],
    ['Hợp đồng sắp hết hạn: cần liên hệ gia hạn', 'Hợp đồng', 'contracts'],
    ['Chốt số điện nước kỳ T10: còn phòng chờ xác nhận', 'Công việc vận hành', 'meters'],
    ['Khách thuê đã cập nhật thông tin cư trú bên ngoài', 'Tạm trú', 'temporary-residence'],
    ['Bảo trì thiết bị: phiếu chờ nghiệm thu', 'Bảo trì', 'maintenance'],
  ].map(([name, category, target], i) =>
    makeRecord('notifications', {
      id: `notification-${i}`,
      code: `TB-${i + 1}`,
      name,
      category,
      status: i < 4 ? 'Chưa đọc' : 'Đã đọc',
      locationId: `loc-${(i % 3) + 1}`,
      description: 'Thông báo nội bộ từ bộ dữ liệu minh họa. Mở hồ sơ liên quan để xem chi tiết.',
      attributes: { target },
    }),
  );
  return { version: 1, records, scenarios: [], audit: [] };
}
