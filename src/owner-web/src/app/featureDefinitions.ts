import type { FeatureDefinition } from '../types/portal';
export const featureDefinitions: FeatureDefinition[] = [
  {
    kind: 'notifications',
    source: '03_notifications',
    title: 'Trung tâm thông báo',
    subtitle: 'Theo dõi và quản lý trung tâm thông báo toàn chuỗi BHOME',
    group: 'Tổng quan',
    action: 'Tạo thông báo nội bộ',
    columns: [
      {
        field: 'code',
        label: 'Mã hồ sơ',
      },
      {
        field: 'name',
        label: 'Nội dung',
      },
      {
        field: 'location',
        label: 'Cơ sở',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Chưa đọc', 'Đã đọc'],
    tabs: ['Tất cả', 'Chưa đọc', 'Đã đọc'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuD68GzX2_PghIgApw29jzwhiVqp5K0lnmmxgGbqeY5MBzkRMCIgYZ9c9OQi8tYVZWgCRAEO2lxmXyNvBp1hF6lCUBV71uc3aRWuQyAWko-p9RC1sA_XVnSeQPLrraJ_CG9TWZz8_OS63x29Cy0bI3dJuCkxKHbp148_RsumpVki1d6v6FMb4R5PM69EckvAH9XM5Abmot9ZNq7Ah786fLNAO2oosFcPD2GLs2M591Q',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDVBH1F8oz9aon6zgV44l-2ASGZuucqHuOaXeFo-v3K_5BYSDOVOw8cnGcwrKh5GAjN39NGrv7HAgVdxHF7pceJr_A3ty1FmsIlenh6rxo8Oj_CirdoZ3J5ERHihFJP5qaBOTv2Jc1WRn1LI_EbaIbA2M6iPBynca6cC7mGqe2C19BIVFoLctrb-Ltao3kzga1i4JlyFiQn9FaxmtrzJo4PA5Y47uAzWJ6YUe4eDTI',
    ],
  },
  {
    kind: 'locations',
    source: '04_locations',
    title: 'Quản lý cơ sở',
    subtitle: 'Quản lý thông tin hạ tầng, quy mô phòng và đội ngũ vận hành chuỗi BHOME',
    group: 'Quản lý cơ sở',
    action: 'Thêm cơ sở mới',
    columns: [
      {
        field: 'name',
        label: 'Mã & Tên cơ sở',
      },
      {
        field: 'address',
        label: 'Địa chỉ',
      },
      {
        field: 'capacity',
        label: 'Quy mô',
      },
      {
        field: 'occupancy',
        label: 'Lấp đầy',
      },
      {
        field: 'amount',
        label: 'Doanh thu dự kiến',
      },
      {
        field: 'manager',
        label: 'Quản lý',
      },
    ],
    statuses: ['Đang vận hành', 'Đang sửa chữa', 'Tạm đóng'],
    tabs: ['Tất cả', 'Đang vận hành', 'Đang sửa chữa', 'Tạm đóng'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB42OmPkwWxe8rfS27HbmFLMTPsopmw37QfRubAlFzvea-dvS6pv_OOC828A3yXzR3jIhTZl1yri9crDT-3-XCM7VpusM9SyIkEUz9KnI1CK3Gz7RkW1H6Tc1SZjapHvf7tO2od1w-ondP_NJxxS7apULneV6TkmHha9eDJyUvPmSLMl_ZlhCN6GVFYbL9ch4OxnyhJGEiET0Pme1bX47V8pctrkWFMdBdc6UBZ3jQ',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDy5J6I265N6USuLYRUyCUcU6-VEyL-3t9t2o8bPpGeVfJPgVg68jNrHFtmLmSlFJGbJP_GUJrEo4mCrRqj2IDygRKvrG-NamKwyaw5CB_BTk2rhVpr3CrMUZQVtvIewOtf_c1dZv3-GwcGtu8gGdkF6nOJrhxXasm_saWSBukL877Bvg1y4hh4P3yXGFxBoYAVh-pvU43q3fUiqoKVQ_Z2UkYh5Wqxx_VcgpoWDtQ',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBEan_kDbw-TJuFJtYQqilS40zZRXQjcVn7OZWwvG6J3SpoIPrZLRiK3Zm3Ww2EunmCNL5-tdtc1Q-8sZUS9keu7j69QbWRj9fDCyeTfWvGKimVs5_pITZ5xULbwzgJVItSmsZ24tP0xUMGgQqqs5u8Hx7BX_dUjxhpbIwMqxShPo5eP-EoXOuYvx3pzwhLwkwp7s5Htyi2LoAOhd2A9P7xDvu8_DpOWJTKK4Qk8sU',
    ],
  },
  {
    kind: 'rooms',
    source: '05_rooms',
    title: 'Quản lý danh sách phòng & Sơ đồ tầng',
    subtitle: 'Sắp xếp và theo dõi trạng thái phòng theo từng tầng và cơ sở',
    group: 'Quản lý cơ sở',
    action: 'Thêm phòng mới',
    columns: [
      {
        field: 'code',
        label: 'Mã hồ sơ',
      },
      {
        field: 'name',
        label: 'Nội dung',
      },
      {
        field: 'location',
        label: 'Cơ sở',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Đang thuê', 'Đang giữ chỗ', 'Trống khai thác', 'Bảo trì'],
    tabs: ['Tất cả', 'Đang thuê', 'Đang giữ chỗ', 'Trống khai thác', 'Bảo trì'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDf3tAtYiKHXYPI--HBJgqb5NLMv-qUt7YSFWahXhTnksW8eXVJKee0pBMw4c7HlrD5G_lSAmmICEh6J_zliDq7-Jhuc3hObnu30dZkmwClJ5nwzrwzlGv563O0On5GbjugsbxPaNVFaBCwpkDwxl0mnWR2tVrkUIeK4QTQaQbq0qsH4i0U0apf7hSqYNo-ycW0YOxH3NoSNcQshDglYswbeP6D5ZRxZ-ze5CQZOno',
    ],
  },
  {
    kind: 'room-types',
    source: '06_room_types',
    title: 'Quản lý loại phòng',
    subtitle: 'Theo dõi và quản lý quản lý loại phòng toàn chuỗi BHOME',
    group: 'Quản lý cơ sở',
    action: 'Thêm loại phòng mới',
    columns: [
      {
        field: 'name',
        label: 'Mã & Tên loại phòng',
      },
      {
        field: 'location',
        label: 'Cơ sở áp dụng',
      },
      {
        field: 'capacity',
        label: 'Diện tích / Sức chứa',
      },
      {
        field: 'amount',
        label: 'Giá thuê niêm yết',
      },
      {
        field: 'occupancy',
        label: 'Số phòng & Tỷ lệ',
      },
      {
        field: 'assetSummary',
        label: 'Tài sản mẫu',
      },
    ],
    statuses: ['Đang áp dụng', 'Ngừng áp dụng'],
    tabs: ['Tất cả', 'Đang áp dụng', 'Ngừng áp dụng'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [],
  },
  {
    kind: 'assets',
    source: '07_assets',
    title: 'Quản lý tài sản & Thiết bị',
    subtitle: 'Theo dõi và quản lý quản lý tài sản & thiết bị toàn chuỗi BHOME',
    group: 'Quản lý cơ sở',
    action: 'Nhập thêm tài sản',
    columns: [
      {
        field: 'code',
        label: 'Mã tài sản',
      },
      {
        field: 'name',
        label: 'Tên tài sản',
      },
      {
        field: 'category',
        label: 'Loại',
      },
      {
        field: 'location',
        label: 'Cơ sở & Vị trí',
      },
      {
        field: 'date',
        label: 'Ngày mua / BH',
      },
      {
        field: 'amount',
        label: 'Nguyên giá',
      },
      {
        field: 'status',
        label: 'Tình trạng',
      },
    ],
    statuses: ['Vận hành tốt', 'Cần kiểm tra', 'Hỏng / Chờ sửa'],
    tabs: ['Tất cả', 'Vận hành tốt', 'Cần kiểm tra', 'Hỏng / Chờ sửa'],
    kpis: [
      'Tổng tài sản quản lý',
      'Đang vận hành tốt',
      'Báo hỏng / Sửa chữa',
      'Cần thanh lý / Thay thế',
    ],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCSSUHjJx-UsTNcVnbxgpDGByLcaWKSkv3WWCbOG7WaozpoI6b-tbeJlDVRGai8bGR4NiSp6CBlfeC-8rQuz07ibOzWL6-dpLeLCC15YMsOrbs5Hn81o4uWZ9CiuUvFmwzOdwHkMVojwGfjw4ZnJeIMUtkspVy8km1hu1WwNJ1YxpW0Onltpv7_nbH2nPDD6z4-73tofOEnNjZu8fZoB__DcKM48qgxhA98fphl3A4',
    ],
  },
  {
    kind: 'pricing',
    source: '08_pricing',
    title: 'Giá thuê & Biểu phí dịch vụ',
    subtitle: 'Thiết lập giá thuê, đơn giá điện nước và dịch vụ theo kỳ hiệu lực',
    group: 'Quản lý cơ sở',
    action: 'Thêm chính sách giá mới',
    columns: [
      {
        field: 'location',
        label: 'Cơ sở & Vị trí',
      },
      {
        field: 'category',
        label: 'Loại phòng',
      },
      {
        field: 'capacity',
        label: 'Diện tích',
      },
      {
        field: 'minimum',
        label: 'Giá sàn (Tối thiểu)',
      },
      {
        field: 'amount',
        label: 'Giá trần (Niêm yết)',
      },
      {
        field: 'holdingDeposit',
        label: 'Cọc giữ chỗ',
      },
      {
        field: 'deposit',
        label: 'Cọc hợp đồng',
      },
      {
        field: 'roomCount',
        label: 'Số căn',
      },
    ],
    statuses: ['Đang áp dụng', 'Chờ áp dụng', 'Ngừng áp dụng'],
    tabs: ['Tất cả', 'Đang áp dụng', 'Chờ áp dụng', 'Ngừng áp dụng'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [],
  },
  {
    kind: 'staff',
    source: '09_staff',
    title: 'Quản lý nhân viên',
    subtitle: 'Theo dõi và quản lý quản lý nhân viên toàn chuỗi BHOME',
    group: 'Nhân sự & Vận hành',
    action: 'Thêm nhân viên mới',
    columns: [
      {
        field: 'name',
        label: 'Nhân viên',
      },
      {
        field: 'contact',
        label: 'Liên hệ',
      },
      {
        field: 'category',
        label: 'Vai trò chức danh',
      },
      {
        field: 'location',
        label: 'Cơ sở trực thuộc',
      },
      {
        field: 'date',
        label: 'Ngày vào làm',
      },
      {
        field: 'amount',
        label: 'Lương & Phụ cấp',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Đang làm việc', 'Nghỉ phép', 'Đã nghỉ việc'],
    tabs: ['Tất cả', 'Đang làm việc', 'Nghỉ phép', 'Đã nghỉ việc'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAR1uxbtH8YIrX3AgEyyrDk0hx-MTNyx-X1YOOtqkliYY6ITu57HA8-EyWyEP5Pxyw3-ZMP18WFQd_KTwUECJxWuAb5EmYSeKZaQRrXUOApYPCZD_1pFiCFmO-wHXyi-ulEtt9Q4qAqaK0jjhAKu6g88158TBPC1w1mgGy9cXzovvM1ZrBs0Lnx0Jc-uFjq_PW5EoI0KhwoGE8Nsic1v1rgX7U3OWLTHBgiFseXoSE',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB4psdP2975VdK_FHFP_FeF4dAuBrsG_WG9rCoJqwmgJOUmf7CSE4c5pM_vBVsY36G6oDmVks_th-Ju-X4FjAphcQxx5efrJpM_whsrfm-1nxCSD4-yqlexPftJ80TJKDjBBMDt9sZylWCS8JjpD2_hq5yDg4JcmUplxZYQj3bu2Zm9k9p_WgLU8tKCtp-HACTdr37__1SEO9YGGaq8Uc7vfiZTVBVt8LaJXnOAxfA',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAPm1owQgOtg15KHgdEtd74ujQ4zJv2MWDR58AmWUPetWFtpuU4GsElhAiRkdaHeGfBUq27xH5gYXx2_ggnAavTDB_GnnbwtLCPOJBSG-LdyCP3XC2MsAY_YvdersOEiKhDYMDI3aN4d2Sg-n77Bh6gyymv6_voDK-Dz3KnIN6P2IcTSnQbs9kGoyjtt0RHeg0hgTSfmbiDnPHesy63cWvfE-WsM4qJoS_tqk78GOw',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAe4Y4H0e7OL6cicC6Hxpf283sDkfBI9x1CJUNc9HhtIWRyr8nJE8j32_LwEQ_XLfSUt6GaQw6sHLzVexZiPRQK_e-uGrykDfXpNiSoqWaaOTFU3Dmf_IU6PNYsOleESrNA8Wk6_XybRWqs__JnNWGsWzDQWy2R0BW-3WSSIaMwo8S4LOEfx4D3c00b4jDXGbrtBR9llc5-30jOIsYto2G7Hjb9-pMmBM4Au888wd8',
    ],
  },
  {
    kind: 'schedules',
    source: '10_staff_schedule',
    title: 'Lịch làm việc & Phân ca nhân sự',
    subtitle: 'Theo dõi và quản lý lịch làm việc & phân ca nhân sự toàn chuỗi BHOME',
    group: 'Nhân sự & Vận hành',
    action: 'Tạo lịch phân ca mới',
    columns: [
      {
        field: 'name',
        label: 'Nhân viên & Chức danh',
      },
      {
        field: 'mon',
        label: 'Thứ 2 14/10',
      },
      {
        field: 'tue',
        label: 'Thứ 3 15/10',
      },
      {
        field: 'wed',
        label: 'Thứ 4 16/10',
      },
      {
        field: 'thu',
        label: 'Thứ 5 17/10 (Nay)',
      },
      {
        field: 'fri',
        label: 'Thứ 6 18/10',
      },
      {
        field: 'sat',
        label: 'Thứ 7 19/10',
      },
      {
        field: 'sun',
        label: 'Chủ Nhật 20/10',
      },
    ],
    statuses: ['Bản nháp', 'Đã xuất bản'],
    tabs: ['Tất cả', 'Bản nháp', 'Đã xuất bản'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDin3C7opF1dYk4jbcCyHfXDUw3fLcR-_ktEh9kNx7P5nAjoqElDReRu8-Rha3em3KOxh6TFOQBWJED9MvjF0jZ8y6UEvd8ocmTshXwi9dlmvHWtmEdwdmAF-_wioS9r1Kia2QCh6uYQvalB6kqrXCtEPq5sen01hVU6-TjpBqQfLW2icnuperKqJXdBmdEfZtkSJPtumOBuEFIdjOMORMRr3_wL3vgCHlwOETg33E',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAXI3cp1kmvoCz8IdMQuQbJQDs3M7LKr1df0-ryAYdiIfibeO-UMQWCppnS_LMI7b-Q2cgHEcn0oBwK21sHTleiiuxr4kKXVplKzR-HstC1Py_lZc4H5RTDf82VLBhp9nnKYcA9bCbHEbPNNk-zh05RH2C81tWGCigVB1J3ovGckXNAgDDL90bKmVevnrg8ryCcvL-zpTEAWuHel5tkG3BgUfs1LCY9AsywWnecxQs',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAPWU0LCa43Hi2E9-OdIPG4rKBmEGI_ELOlskMVvqOYnZCpKs3XX6gQHKLFRPYpkpUZx5yIKQJZinc7jHDMcdcIXBRCHPz78kGxX4S-DLxSzw0vqWioAYcAWm3AyALzwmv-u1nzRMOt24OSpYankytphgeGVst04eun6mgmlfuruDg04YNf4SB1UiWNoRREyrYnzwNgmH_ZjHq1X7blEBsstPejkJuf6Z835qAtyWs',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCyQyqWZba1r18UoiQTfXG6y-ba0ekm4Y66BbauOAqlroXaG4D4Gu2yIFOM2KjIwz4wh44viAsK--gXI77KLyVuIKhbz5SpKJrLPiWOPYAf4vgExG65_zSrwM6ZPAbfvPCvGloUffWlnzR4Ztvh8gBwdFOr72fzV-jCz00OkoGKelyBxHPKBNsZpuZtWDiLiRdDbp4ccuFVxYWHngcQuJOWa1R8lYac9cJVT2jGckA',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCE8wnXrUv9M0TwtnbW9SkX6omHw4jZUpVfi0bkCn52TcCeAEkFtD1zGbfHjV-Yacf4Oi7MHf1za1zk-AP9WHZ-kKSYqx4NbzUjZNe7zQL1GUe4pjzcBlB6kM2EfejdXpa0tORpGnGFmAxZeGFxrKcYfyHrduB26-SG8Eo6ZOmTky97lkJnpLs3zAesWaI7ScxsIojf5pcOls2uUMuGLesOWMSGcvTTqQPbBRFtZUw',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCK98RU-djHgyz9vzIv5Oa43yQ_4lmTt8YW6hJzlbRVjnYG-utUWO2I7GXWU3wVfSf0rk_-scRHYJB3X01bljEVQK3VrnokBLckEBMeBGnjnfW6NvrjPSQzRRcLD7N8TBfrBd9JMNXQAVrjzekwK5rQ4l54J0ESsYb-Nm2BFF64loA9kv-rky6K2LCiMbIeDUdCHK2SQEQmMO_-LWBPRPqSJGgBhJlF1v14jhOPU_Q',
    ],
  },
  {
    kind: 'tasks',
    source: '11_operational_tasks',
    title: 'Vận hành & Giám sát phiếu tác vụ',
    subtitle: 'Theo dõi và quản lý vận hành & giám sát phiếu tác vụ toàn chuỗi BHOME',
    group: 'Nhân sự & Vận hành',
    action: 'Tạo công việc mới',
    columns: [
      {
        field: 'name',
        label: 'Mã & Tên công việc',
      },
      {
        field: 'location',
        label: 'Cơ sở / Vị trí',
      },
      {
        field: 'staff',
        label: 'Người xử lý',
      },
      {
        field: 'date',
        label: 'Hạn chót',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: [
      'Chờ tiếp nhận',
      'Đang thực hiện',
      'Chờ nghiệm thu',
      'Hoàn thành',
      'Yêu cầu làm lại',
    ],
    tabs: [
      'Tất cả',
      'Chờ tiếp nhận',
      'Đang thực hiện',
      'Chờ nghiệm thu',
      'Hoàn thành',
      'Yêu cầu làm lại',
    ],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCzJDDNcvAes0RaAFzIFSxZiisxfyzHeLt6yE8SLc1yeTf9EQ4zjBeCwPYAxMVLXJoE74nSWkDNaHsYjr2E8OCAI8xD64aP-foQpXtlQbIxIuHCaVilLDkcYX_95GdRps1CwZJBNETcqrz67JtRma69uGYK5YtpHdeWM6k-ez7U34ou4RYRbxLQ2RCqXw0gG0Wjd-IGbfAiJzb9vF2qVDVm28ZwT_v9xpKKYAmDpec',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBsICDKbr67jZveuiL9L7w5sA_RkO8tta0NePItykx3qXy4GMvI25em3Kfj6QganY4NQDIU-0Y3Hx-PBRgdoXo5xYC_7xtaZOXAb3rIvIKxl4fnxE3fYV7xkbagYMEV47mCb7-2WZsuZxxcUWc6alFm0Rrx9QLe-7uuRXHxlg79dNCjRByj-S28AfVBNCdnfIqdHDQdETi5XWe0pAels91qFgeIyFfMyzh03e67Ir8',
    ],
  },
  {
    kind: 'tenants',
    source: '12_tenants',
    title: 'Quản lý khách thuê',
    subtitle: 'Theo dõi và quản lý quản lý khách thuê toàn chuỗi BHOME',
    group: 'Khách thuê & Hợp đồng',
    action: 'Thêm khách thuê mới',
    columns: [
      {
        field: 'name',
        label: 'Họ và tên / Mã',
      },
      {
        field: 'contact',
        label: 'Liên hệ & CCCD',
      },
      {
        field: 'room',
        label: 'Phòng & Cơ sở',
      },
      {
        field: 'category',
        label: 'Vai trò',
      },
      {
        field: 'contract',
        label: 'Hợp đồng',
      },
      {
        field: 'residence',
        label: 'Tạm trú VNeID',
      },
    ],
    statuses: ['Đang ở', 'Chờ nhận phòng', 'Đã trả phòng'],
    tabs: ['Tất cả', 'Đang ở', 'Chờ nhận phòng', 'Đã trả phòng'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBAsPDYg2mEmv4sotD7aVAexctseUfnTYJenuhT0bc7k6cGRfddma6QEwkbqzzG7Awf8TNHh8xobweNrxyMnFqcqZLYj9826cShry2tuxpcVTYVzkakXjw-3RehqoSgUUPsnvUXR8UYWmOkgF06KgDRaJvwtPpVli8pN2-g-_EEoMoJ5Yg9WRdogPCe40GVgfrlweepFvBzaRhgzHt13FHRstyPW9wn7JntU9WTcDo',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBLlrzn-pcHZGDlz3tGsC6GYCMpweM5AdNtEs88XBBnfJ5gTPhHemqFpCz7_n2vWgihw9-aiH_ETQU4C_LNWQp51m5nJ9yPqG-I_WVom2YeJiuP81rjFKfaxnfsLeSXYwpw0iIWKR2BZDMd_S7VGkrpQUcC1E-6uPdW0AdquRTpW6FBT8EhJuqhpsnJR1kbG9sg5Ac5GZtlg5eleaJm-j-ZyZlcob9XpI3RxoHk2v4',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCutV8LgXj139GCSrj91K1p5hSPyLqPhyTj58N2EhuCvuSy2BPYhdckxRGTdNnnOKpPXYC0Bj3owG5z0vHmAQgcpdKcvTn1QgHU81sEXWDFozQ6zl-QsvMP1vXI-Vk8Xan2CDezJ6ovs6R2iXjyYsYRA4bcCxxfHxqTSnDrl0D_DC6_KhXmXYaavfspQXf4n-plP79s9UeC45p8BqlVq8M6gbRnDscw5689ctagosA',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuC5FwfcJLzUzuLuQKb-_hOKjSmT8irqB5xm3BYyNU_UceKS85MA6GOo_P9pLXmdPL3pyuie8BodTtAbe1kubqRpeP_Bm9IHeEfan7rc4LVo-_PTUfWDVz4wehF74DAbqwpc12y_HyDmHcqg3P_PBS3fJ-zOJ8B0_lb4p7zZ7u0Yaafgh2hLd6bwrd36MHvymkBcbcgO6JQHiVe3ksouTXeNsnkcD6A_fOnFDMjGxnY',
    ],
  },
  {
    kind: 'contracts',
    source: '13_contracts',
    title: 'Quản lý hợp đồng',
    subtitle: 'Theo dõi và quản lý quản lý hợp đồng toàn chuỗi BHOME',
    group: 'Khách thuê & Hợp đồng',
    action: 'Tạo hợp đồng mới',
    columns: [
      {
        field: 'code',
        label: 'Mã hợp đồng',
      },
      {
        field: 'room',
        label: 'Loại & Phòng',
      },
      {
        field: 'tenant',
        label: 'Khách thuê đại diện',
      },
      {
        field: 'period',
        label: 'Thời hạn hợp đồng',
      },
      {
        field: 'amount',
        label: 'Giá thuê & Cọc',
      },
      {
        field: 'signature',
        label: 'Trạng thái ký số',
      },
      {
        field: 'status',
        label: 'Tình trạng',
      },
    ],
    statuses: ['Bản nháp', 'Chờ ký số', 'Chờ xác nhận cọc', 'Đang hiệu lực', 'Đã kết thúc'],
    tabs: ['Tất cả', 'Bản nháp', 'Chờ ký số', 'Chờ xác nhận cọc', 'Đang hiệu lực', 'Đã kết thúc'],
    kpis: ['Tổng số hợp đồng', 'Chờ ký số', 'Sắp hết hạn', 'Tiền cọc ký quỹ'],
    images: [],
  },
  {
    kind: 'handovers',
    source: '14_handover',
    title: 'Bàn giao & Trả phòng',
    subtitle: 'Theo dõi và quản lý bàn giao & trả phòng toàn chuỗi BHOME',
    group: 'Khách thuê & Hợp đồng',
    action: 'Tạo biên bản nghiệm thu',
    columns: [
      {
        field: 'code',
        label: 'Mã hồ sơ',
      },
      {
        field: 'name',
        label: 'Nội dung',
      },
      {
        field: 'location',
        label: 'Cơ sở',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Chờ kiểm tra', 'Chờ xác nhận', 'Hoàn thành', 'Yêu cầu kiểm tra lại'],
    tabs: ['Tất cả', 'Chờ kiểm tra', 'Chờ xác nhận', 'Hoàn thành', 'Yêu cầu kiểm tra lại'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAhZFHbIPa39fMahH2ekBtN_oNZV7wpBzQNBn24IPm0Z_g6drzQZFSflFlS_Yb59eYbBPfi3UsnZpPMKyamrKloDVKCwI5qRTueKZfCLEClRjqbJ_6P4lUTb9cQnODobC4ay7C8Ey-LKlMVd_MSDJMKbeLJEhEKjZGhaQDICE2g4XTORkTRcYAdy2aOUdsdTkinFcmiwTRLVy3HsxJ2Uklpjt-HfEgKvwBWthib5Ck',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuC6SA3moSbcgi1IkI4usgprLEtmhFjw9E2w0Zch5_tA3aWPMcZNaZI1wG7pteKGPsghg4FGd8EQas6yaLUp68rdDVAR4mXcutdSj20qAD_0EuMbuECrbqGqWFDzFBTVAF7vhZFAT8upX8_Z_Njk68KP1NV2Mo4idXchF5FZP892Wz2dRb1UeCrFYYn0GdoBlj-f0mlZZ3kHdbWHcToG0JaJEmuwYkpXb_glXN-4Wkc',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBoiJCsnOf_yhemINXomoVjrHIYqeRJZKMaUOkJCFVpENPynWJKcTaWUNWG7nfYRsCA2i_CBq5ak-hvEAw0AMDvemUEWCTFZoVP1iwhumubC674MHcYzibQnSyPsTYxKCFLrDEkIa8t6lcxFTP_lmOulYVf3G5zrllTAjlmuJdkvqKnvcw28tEzulSemRsG-_DxIMuRKLTm-U_dpRo6F1Hxg1O9YHwTT7iQjnfB29w',
    ],
  },
  {
    kind: 'temporary-residence',
    source: '15_temporary_residence',
    title: 'Theo dõi Đăng ký Tạm trú',
    subtitle: 'Khách thuê đăng ký bên ngoài BHOME. Chủ nhà chỉ xác nhận thông tin chỗ ở.',
    group: 'Khách thuê & Hợp đồng',
    action: 'Cập nhật thông tin cư trú',
    columns: [
      {
        field: 'code',
        label: 'Mã HS VNeID / DVC',
      },
      {
        field: 'tenant',
        label: 'Khách thuê & CCCD',
      },
      {
        field: 'room',
        label: 'Cơ sở & Phòng',
      },
      {
        field: 'date',
        label: 'Ngày nhận phòng',
      },
      {
        field: 'status',
        label: 'Trạng thái tiến độ',
      },
    ],
    statuses: [
      'Chưa cập nhật',
      'Chờ chủ nhà xác nhận',
      'Đã xác nhận chỗ ở',
      'Đã cung cấp kết quả bên ngoài',
    ],
    tabs: [
      'Tất cả',
      'Chưa cập nhật',
      'Chờ chủ nhà xác nhận',
      'Đã xác nhận chỗ ở',
      'Đã cung cấp kết quả bên ngoài',
    ],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuApKsY4kizo2LDFfPYjEjYBE0_aHjhpx-ZoeOsnmP9NcFUG7cDe5cx6twn26u3AiUVQHRmFIT-idYCZHwmCTHb3JEJNJfJzxxA0VMfvGqorslLPfesCPKp-GKYpYvfadAnjg5lgxQzMpoKa_A156D6pES0Bphca-AdRBrs0IO-yQLzOjfovf5RJAvmRDNRD8jmGJ3ACV-0w5o6ZiUh6el9_Texr-D8b00VTrB1YInA',
    ],
  },
  {
    kind: 'meters',
    source: '16_meter_readings',
    title: 'Quản lý chỉ số điện nước',
    subtitle: 'Theo dõi và quản lý quản lý chỉ số điện nước toàn chuỗi BHOME',
    group: 'Tài chính & Hóa đơn',
    action: 'Ghi chỉ số mới',
    columns: [
      {
        field: 'room',
        label: 'Phòng & Cơ sở',
      },
      {
        field: 'tenant',
        label: 'Khách thuê',
      },
      {
        field: 'electricity',
        label: 'Điện (Cũ → Mới)',
      },
      {
        field: 'water',
        label: 'Nước (Cũ → Mới)',
      },
      {
        field: 'evidence',
        label: 'Minh chứng',
      },
      {
        field: 'staff',
        label: 'Người ghi',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Chờ ghi số', 'Chờ xác nhận', 'Đã xác nhận'],
    tabs: ['Tất cả', 'Chờ ghi số', 'Chờ xác nhận', 'Đã xác nhận'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCZoaS01ACjjtSjsxfYTt_vTahoiQfV4kZgAf82l7bfilabb3qk6byxSnyfuojp-AR2OKD-q-aVpQAOHuaOlhJj9LPGFZ9hZUiaiIVqwyhPsKv-R-4_HzyqTt-0fhKGfklFcjGAuHj-VaNzWmaVAk3ipbBqCCh9OAl8sDVqV56MD5NTCNPoyzvfjoj7reY0UAmI3fBKYwBQIKdB5aBFrBZK5Gph2s7xbDdanKiyk7Q',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCCSYCjp5vtuF7pKrSkdyTJDk5GscTm7tb820tweviHB_cG4dZ8jcZ82_OnLUWYYTpiUlbawtqcrYjvIok9Cm_I6DQe8yubNNcdPeMa1cDDh4bMzYwQ-iXQP-NDPJeMMeBWHkaWqq63lqIaulrmnpTiqn023Jb9EcOUmiGl2MH-6zuYgEWiwEXp_UEKXWHMiups_awDF3XeFA0jo9UPcUHbOyO1Xqd9_hjDyAaC8UM',
    ],
  },
  {
    kind: 'invoices',
    source: '17_invoices',
    title: 'Quản lý hóa đơn tiền phòng & dịch vụ',
    subtitle: 'Theo dõi và quản lý quản lý hóa đơn tiền phòng & dịch vụ toàn chuỗi BHOME',
    group: 'Tài chính & Hóa đơn',
    action: 'Tạo hóa đơn nháp',
    columns: [
      {
        field: 'code',
        label: 'Mã HĐ',
      },
      {
        field: 'room',
        label: 'Phòng & Cơ sở',
      },
      {
        field: 'tenant',
        label: 'Khách thuê',
      },
      {
        field: 'rent',
        label: 'Tiền phòng',
      },
      {
        field: 'utilities',
        label: 'Điện nước',
      },
      {
        field: 'service',
        label: 'Phí DV',
      },
      {
        field: 'amount',
        label: 'Tổng cộng',
      },
      {
        field: 'debt',
        label: 'Còn nợ',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: [
      'Nháp',
      'Đã phát hành',
      'Đã thanh toán',
      'Yêu cầu điều chỉnh',
      'Chờ duyệt điều chỉnh',
    ],
    tabs: [
      'Tất cả',
      'Nháp',
      'Đã phát hành',
      'Đã thanh toán',
      'Yêu cầu điều chỉnh',
      'Chờ duyệt điều chỉnh',
    ],
    kpis: ['Tổng doanh thu phải thu', 'Đã thanh toán', 'Chưa thu / Quá hạn', 'Yêu cầu điều chỉnh'],
    images: [],
  },
  {
    kind: 'payments',
    source: '18_payments',
    title: 'Đối soát & Khớp lệnh chuyển khoản ngân hàng',
    subtitle: 'Theo dõi và quản lý đối soát & khớp lệnh chuyển khoản ngân hàng toàn chuỗi BHOME',
    group: 'Tài chính & Hóa đơn',
    action: 'Nhập giao dịch demo',
    columns: [
      {
        field: 'code',
        label: 'Mã GD (Bank Ref)',
      },
      {
        field: 'date',
        label: 'Thời gian',
      },
      {
        field: 'amount',
        label: 'Số tiền',
      },
      {
        field: 'tenant',
        label: 'Người chuyển & NH',
      },
      {
        field: 'description',
        label: 'Nội dung thực tế',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Chờ đối soát', 'Đã đối soát'],
    tabs: ['Tất cả', 'Chờ đối soát', 'Đã đối soát'],
    kpis: ['Tổng chuyển khoản', 'Đã đối soát', 'Chờ khớp lệnh', 'Tỷ lệ tự động hóa'],
    images: [],
  },
  {
    kind: 'debts',
    source: '19_debts',
    title: 'Quản lý công nợ & Thu hồi nợ tiền phòng',
    subtitle: 'Theo dõi và quản lý quản lý công nợ & thu hồi nợ tiền phòng toàn chuỗi BHOME',
    group: 'Tài chính & Hóa đơn',
    action: 'Ghi nhận hẹn thanh toán',
    columns: [
      {
        field: 'room',
        label: 'Phòng & Cơ sở',
      },
      {
        field: 'tenant',
        label: 'Khách thuê',
      },
      {
        field: 'date',
        label: 'Hạn nộp',
      },
      {
        field: 'amount',
        label: 'Phải thu',
      },
      {
        field: 'debt',
        label: 'Nợ tồn',
      },
      {
        field: 'aging',
        label: 'Quá hạn',
      },
      {
        field: 'reminder',
        label: 'Tiến độ đôn đốc',
      },
    ],
    statuses: ['Chưa nhắc', 'Đã ghi nhận nhắc', 'Đã hẹn lịch'],
    tabs: ['Tất cả', 'Chưa nhắc', 'Đã ghi nhận nhắc', 'Đã hẹn lịch'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [],
  },
  {
    kind: 'incidents',
    source: '20_incidents',
    title: 'Quản lý báo cáo sự cố & Tiếp nhận phản ánh',
    subtitle: 'Theo dõi và quản lý quản lý báo cáo sự cố & tiếp nhận phản ánh toàn chuỗi BHOME',
    group: 'Sự cố & Bảo trì',
    action: 'Ghi nhận sự cố mới',
    columns: [
      {
        field: 'code',
        label: 'Mã & Mức độ',
      },
      {
        field: 'room',
        label: 'Cơ sở & Vị trí',
      },
      {
        field: 'tenant',
        label: 'Người báo & T.Gian',
      },
      {
        field: 'description',
        label: 'Nội dung sự cố',
      },
      {
        field: 'evidence',
        label: 'Ảnh',
      },
      {
        field: 'staff',
        label: 'Kỹ thuật viên',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Chờ phân công', 'Đang xử lý', 'Chờ nghiệm thu', 'Đã giải quyết', 'Trùng lặp'],
    tabs: ['Tất cả', 'Chờ phân công', 'Đang xử lý', 'Chờ nghiệm thu', 'Đã giải quyết', 'Trùng lặp'],
    kpis: ['Tổng phản ánh', 'Sự cố khẩn cấp', 'Đang xử lý', 'Phản hồi trung bình'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAYAemFoSTKpnZ5YteAlrVcj6t7Au2glkDbO8-ZhSCFtxFXQGL1XJgRFgVMJa79YolH1fga4-MjqcB4NAcUTKUPSmIzExHFPyTyqGt0GxWpxOkLXX9TZcriZrI0B5Eu0l1lrrhkdCpQAQEH67PjVRK3lyuF7HPq1F2sgnUZkK69D2Dh66vBwmK-c5Lme_KrdVM3I6ijbJGElWlHyEGmRteutGz5E-T5R4d-vOIW7_I',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDBcEdpqtIsw-9Cmf7P_PqwQmXldkVoByV72-JNW7e4dKLt1GDF46kTP5hjHd8IGMuXfahd_UJo8zD5Y3sw7ELS6O32gv2a-xMItq0sLuwlRPgG3TTuJzmCgaUazuN4BTsHcx_F8iaAYat3EZcD9nbQy8fpd4JZT6lS5SebFxaSTr34BPkxsl8teepGkQ6BBlTL-Pwc5GmK4Krp1bIMnukWJVCcwtGehsAHwIcHWK4',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAO2BJfHNZSSrChTGrv4HtNrScjmhhDFMW-JG-CFkIxjfSO8D1vWmraGVuUjZ8X-S0MMj9FLqWrtU04_d9lVQj1jUmwxlOBtMx1XyUhBkBcWJc8KQeTkp3PjrnugAQWu2nlCoHnl3lHO9XI91V5Cz5G_zQ2aczRZe7j1LhmCmxGoMfnECiunaw6AtzUwJDPcSH1TRB0U27UreVPPw-GDPXzyO7DYSJsSePaYgWYPBc',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBBJJxINdmANhndO87qXy9NVSEU6aKbwDMADUc4-9Ct0HFmcbifKnm7tZeGztJSI2Nc-BYX1MKnkoxy3zEXI4ZqD6LzrqdKLRz0U5wHmUfn13F5oL0pGvEz2ZaAKaGkCR5fXL8ef6orBlCY5cXd8nTyHGfJ0_bfjNL_ncnl-RY4aeh3MsCu7w2cqkNlJBNa2Jihtbl9u5DbSgyQshEJ78c547lhDjB0yJSOAcZS_ls',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBJHhq6Jn3fZUuDKw1FkPt-6bLtNKA6LJQBM5fPkgg9ynKZn7lS8T1_vkaKGC9LCUAEOJV3iIsFYYzIHMO_-juGnztVaONQh6RtTblyliFXxCq3tR_kDKLjpTlrhUO26EJWgPCBS48fhrwcLAEIBG7G9Uh6ozz-I5jG1iqkhdxpYWTSv-w6xrI-iYZvikWlcxeQghRr1B1o8u_lxyOQsuPH0YNPfTeQ7gwNQgzsfyk',
    ],
  },
  {
    kind: 'maintenance',
    source: '21_maintenance',
    title: 'Quản lý bảo trì & Lệnh sửa chữa',
    subtitle: 'Theo dõi và quản lý quản lý bảo trì & lệnh sửa chữa toàn chuỗi BHOME',
    group: 'Sự cố & Bảo trì',
    action: 'Tạo lệnh bảo trì mới',
    columns: [
      {
        field: 'code',
        label: 'Mã WO & Ngày',
      },
      {
        field: 'room',
        label: 'Vị trí & Hạng mục',
      },
      {
        field: 'staff',
        label: 'Kỹ thuật viên',
      },
      {
        field: 'amount',
        label: 'Dự toán / Thực tế',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: [
      'Đã phân công',
      'Chờ duyệt chi phí',
      'Đang thực hiện',
      'Chờ nghiệm thu',
      'Đã nghiệm thu',
      'Yêu cầu làm lại',
    ],
    tabs: [
      'Tất cả',
      'Đã phân công',
      'Chờ duyệt chi phí',
      'Đang thực hiện',
      'Chờ nghiệm thu',
      'Đã nghiệm thu',
      'Yêu cầu làm lại',
    ],
    kpis: ['Tổng phiếu bảo trì', 'Chờ duyệt chi phí', 'Đang sửa chữa', 'Chi phí bảo trì'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDsaU0yz6AxIaoGlSjieWMKUaw_ByemN2K4oqQ4rdMb2p0AsS_HLS2DppV6UFl2C1s88lR21P-at758a6P4j0dP3Yz7MeuuwXWz4vLHTifsT_JX5f9XamKvPBhphe8ud6klvWZOE1xs5W0xMzBwJz6pxmVGt28ySjypWpbO8KQ3G4kJn5d6rSr3rZAgrZV_x-ReikcBm7YfgGROHgN0SP3gYno3-cMCjTjNANWbzAQ',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDHNkcfagNZ2iwA9arrHwTKIXEydiDpfjEdp_vrYvLE_TRkaEnl60CgugkpY7QSCaNYiNPGRPA-8KukZAYOb-43cfnpU2TX2Qf1tE2oEiG4VqJjR5KnDIOvwxVjRv3fMu1kfrEMlgLXEncE5oemyBKV_6C4KEGrSukoQmiPeaeP7Qpwpm4S6LFa9TDTO9LRuJKLMGXHjoTobTQcu7PjM9h3tR8Mxj2IQ293gnqZO9o',
    ],
  },
  {
    kind: 'expenses',
    source: '22_expenses',
    title: 'Quản lý chi phí vận hành & Vốn đầu tư',
    subtitle: 'Theo dõi và quản lý quản lý chi phí vận hành & vốn đầu tư toàn chuỗi BHOME',
    group: 'Báo cáo & Phân tích',
    action: 'Ghi nhận khoản chi mới',
    columns: [
      {
        field: 'code',
        label: 'Mã phiếu chi',
      },
      {
        field: 'date',
        label: 'Ngày chi',
      },
      {
        field: 'location',
        label: 'Cơ sở',
      },
      {
        field: 'category',
        label: 'Khoản mục chi phí',
      },
      {
        field: 'staff',
        label: 'Người đề xuất / Phụ trách',
      },
      {
        field: 'amount',
        label: 'Số tiền (VND)',
      },
      {
        field: 'evidence',
        label: 'Chứng từ',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Chờ duyệt', 'Đã duyệt', 'Đã ghi nhận'],
    tabs: ['Tất cả', 'Chờ duyệt', 'Đã duyệt', 'Đã ghi nhận'],
    kpis: ['Tổng chi phí tháng', 'Chi phí nhân sự', 'Đầu tư & Nâng cấp', 'So với dự toán'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDwh9nk7RSzEWX3Qsm8YbOlp5XGR3PcxdFxJflEIczyz42KKRdp04RWPLRZbnGlMFkgmlj7qVAK42MBJE5ictorx0fWBG8OPaK9xfbpbefrDAB3ZBLLV-Wg3iEYuSO1f6lCDVOzlVBgha-5oEbhBaYS0oXAidyO6cCPESKqmC3H3HisHjVqlJ-PBhU5MRLj51HHKw8aHW9dAFv8yNC3bnM5kTPtz9XaUItbeYGA8Sk',
    ],
  },
  {
    kind: 'public-content',
    source: '25_public_content',
    title: 'Quản lý nội dung hiển thị công khai',
    subtitle:
      'Kiểm duyệt thông tin, giá tham khảo và hình ảnh công khai. Không đặt phòng hay thanh toán trực tuyến.',
    group: 'Báo cáo & Phân tích',
    action: 'Thêm nội dung công khai',
    columns: [
      {
        field: 'code',
        label: 'Mã hồ sơ',
      },
      {
        field: 'name',
        label: 'Nội dung',
      },
      {
        field: 'location',
        label: 'Cơ sở',
      },
      {
        field: 'status',
        label: 'Trạng thái',
      },
    ],
    statuses: ['Bản nháp', 'Đã xuất bản'],
    tabs: ['Tất cả', 'Bản nháp', 'Đã xuất bản'],
    kpis: ['Tổng số hồ sơ', 'Đang hoạt động', 'Cần xử lý', 'Đã hoàn thành'],
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCGcqktGk13il-Mu-pn9lxNaf1yKY7o7_D07ny1A60zVGShW_rFX1jKNulSCo3HDczTmFebO8-mLh5jhCf2qP_Nswz4iDz6KepGj79FCXUYRS6Qv_ke_SRqFUrSD81I3LiwyorRh4fNFRsPLeSCzr-XuOcVSXz-YKDh6IP1tCuSpGFErHNT3uc4vuOkMIq2zkjx_IW7quNfCbGroDk20hDEHlXe1OipL7qZtUB-pMI',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBKNg_v0lSLB5YqrEKgwDSSPVqt6KXzONP5CYfcJAjYAP_MJwJR6SD7J2qUGHyvHIEuBEkkPsba0kWrZ0y5fBVUMfsrFRxl8nP2UfYy1DIgf1JlgC6QahWvbiL1gc_-IKDAS_67eh5G1LD0dT0LrrVqZqxk6x2-pEIprC6J3HpMSmMR8T2z7IG6X9DQDSj-NLeV-m4WC2R3T820JuLMEOO9rUziALDeHnKdETROIE4',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuArT4hIqgsRAJgFxOpTguwobi44zzRyzo6DNSk8s4XSeawMLSSeBdflghHoC1w3hNEABmlOhyxw63sYGpYY4uAeK3qAogTVapIEqycwRGVCbEiGEuQd4uMDN0rJP9ESt_UWj08chssHjI9MTfAPCVFbe0GwcNePkENWkrnbxTR4ZKtkEt4aHmCfV-qFTlQUb8jgPeSvQDsu8zj8M7USnZl47AMuD0dz4zF_fhb0MnE',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAAm5YAgrk8XYtLckj1UPCiFfLl8yalubp6kwBNCrnoMF8OL2g37jP046iUMUT8-12DvOBJ9G-kB_-DdK9L5lwFqp1j3L-9DDfzZ4Z3Edv5iDLt8QbvYRAizd0XTBhWVNo2r10DS6ZRtCrKAtMcPj54_nTwBcK6AdNoh5-I6Jh4OtgxJcJDavIt0DheM-Qa3tgkMTskd0g3X6snQX0KQgtHwDwT7PuV7lw-E7AkTHo',
    ],
  },
];
