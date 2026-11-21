import type { ResourceKind } from '../types/portal';
export const workflowTransitions: Partial<Record<ResourceKind, Record<string, string[]>>> = {
  contracts: {
    'Bản nháp': ['Chờ ký số'],
    'Chờ ký số': ['Chờ xác nhận cọc'],
    'Chờ xác nhận cọc': ['Đang hiệu lực'],
  },
  invoices: {
    Nháp: ['Đã phát hành'],
    'Đã phát hành': ['Yêu cầu điều chỉnh'],
    'Đã thanh toán': ['Yêu cầu điều chỉnh'],
    'Yêu cầu điều chỉnh': ['Chờ duyệt điều chỉnh'],
    'Chờ duyệt điều chỉnh': ['Đã phát hành'],
  },
  maintenance: {
    'Đã phân công': ['Chờ duyệt chi phí'],
    'Chờ duyệt chi phí': ['Đang thực hiện'],
    'Đang thực hiện': ['Chờ nghiệm thu'],
    'Chờ nghiệm thu': ['Đã nghiệm thu', 'Yêu cầu làm lại'],
    'Yêu cầu làm lại': ['Đang thực hiện'],
  },
  tasks: {
    'Chờ tiếp nhận': ['Đang thực hiện'],
    'Đang thực hiện': ['Chờ nghiệm thu'],
    'Chờ nghiệm thu': ['Hoàn thành', 'Yêu cầu làm lại'],
    'Yêu cầu làm lại': ['Đang thực hiện'],
  },
  meters: { 'Chờ ghi số': ['Chờ xác nhận'], 'Chờ xác nhận': ['Đã xác nhận'] },
  handovers: {
    'Chờ kiểm tra': ['Chờ xác nhận'],
    'Chờ xác nhận': ['Hoàn thành', 'Yêu cầu kiểm tra lại'],
    'Yêu cầu kiểm tra lại': ['Chờ kiểm tra'],
  },
  incidents: {
    'Chờ phân công': ['Đang xử lý', 'Trùng lặp'],
    'Đang xử lý': ['Chờ nghiệm thu', 'Trùng lặp'],
    'Chờ nghiệm thu': ['Đã giải quyết', 'Đang xử lý'],
  },
  'temporary-residence': {
    'Chưa cập nhật': ['Chờ chủ nhà xác nhận'],
    'Chờ chủ nhà xác nhận': ['Đã xác nhận chỗ ở'],
    'Đã xác nhận chỗ ở': ['Đã cung cấp kết quả bên ngoài'],
  },
};
