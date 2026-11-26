# JOB-10 — Handoff nghiệp vụ hợp đồng và quyết toán

## Quy tắc Billing đã thống nhất

- Một hóa đơn định kỳ cho mỗi phòng/kỳ, gồm điện, nước, dịch vụ của kỳ hiện tại và tiền thuê của tháng kế tiếp.
- Không phân bổ phí cố định theo số ngày ở. Dịch vụ theo người tính đủ tháng cho mỗi người có thời gian cư trú giao với kỳ, không đếm trùng khi gia hạn.
- Chọn hợp đồng đối chiếu tự động: Main/Renewal đã kích hoạt, thuộc phòng, bắt đầu trước tháng kế tiếp, kết thúc thực tế (nếu có) hoặc dự kiến từ tháng kế tiếp trở đi. Sắp theo CreatedAt tăng dần, sau đó Id để ổn định. Đối chiếu hiệu lực lịch sử của kỳ, không chỉ trạng thái Active ngày chạy JOB-10.
- Không có hợp đồng đối chiếu: bỏ qua sinh hóa đơn mới. Không đổi trạng thái phòng. Bản nháp đã tồn tại nhưng không còn hợp đồng đủ điều kiện không được phát hành; hóa đơn Final lịch sử không sửa.
- Giữ kiểm tra các bộ giá đã ký không đồng nhất, không đoán giá.
- Các trường DB/API cũ RepresentativeContractId, RepresentativeTenantUserId và cấu hình PartialMonth được giữ để tương thích. InvoiceService bắt buộc FullMonth khi lập/tính lại hóa đơn. Lựa chọn đại diện thủ công cũ không còn ảnh hưởng tới việc lập hóa đơn.
- Kỳ thực tế của khoản tiền thuê mới được ghi trong FixedChargeCoverage/v1.source.BillingPeriod trên dòng RENT, là BillingPeriod của hóa đơn cộng một tháng. Hóa đơn cũ giữ ý nghĩa kỳ cũ; không sửa Final.

## Chuyển cho người phụ trách hợp đồng — chưa triển khai

1. Khi lập hợp đồng chính thức cho người thuê mới vào phòng đang có hợp đồng hoạt động, lấy toàn bộ bộ giá đã ký từ hợp đồng hoạt động được tạo sớm nhất của phòng. Không lấy lại giá phòng hiện tại. Chỉ phòng không có hợp đồng đang hoạt động mới lấy chính sách giá phòng. Đảm bảo đồng nhất tiền thuê tháng, điện, nước, các dịch vụ, phương thức tính phí, phiên bản/nguồn đơn giá; lưu snapshot đã ký và kiểm tra lại lúc ký/kích hoạt. Không đổi người đại diện ký hợp đồng (RepresentativeResidentId).
2. Kiểm tra toàn bộ đường tạo Main (trực tiếp, từ giữ chỗ, tạo thử nếu dùng chung), giá xem trước và snapshot thực tế. Giá đã ký của hợp đồng cũ không bị ghi đè. Không phát hành hợp đồng mới với bộ giá khác các hợp đồng hiện hành.
3. Thanh toán ban đầu: tiếp tục thu tiền thuê tháng bắt đầu thuê theo nghiệp vụ hiện tại, không thu lại tiền thuê cùng kỳ. Loại phí dịch vụ khỏi thanh toán tạo hợp đồng theo yêu cầu riêng của nhóm; phí dịch vụ tính trong hóa đơn định kỳ/ quyết toán. Kiểm tra trường hợp nhiều người vào cùng một phòng để không thu tiền thuê phòng trùng. Không thay đổi SePay hay trạng thái Paid từ frontend.
4. Gia hạn: giữ hiệu lực thực tế của phiên bản trước và phiên bản mới chính xác để Billing có thể chọn theo kỳ lịch sử. Không đếm trùng người thuê.

## Chuyển cho người phụ trách trả phòng/quyết toán — chưa triển khai

1. Chỉ kích hoạt trả phòng của phòng khi tất cả khách thuê thuộc các hợp đồng hiện hành xác nhận trả phòng. Các hợp đồng kết thúc đồng loạt tại ngày trả phòng; xử lý việc xác nhận, đồng bộ trạng thái, idempotency và phân quyền trong module hợp đồng.
2. Quyết toán toàn bộ điện, nước theo chỉ số chốt, dịch vụ tháng trả phòng và các khoản còn thiếu. Phí cố định theo tháng, không chia theo số ngày ở. Tính dịch vụ đủ tháng cho người cư trú trong kỳ, trừ người đã kết thúc trước kỳ. Đối chiếu khoản đã phát hành/đã thu để không thu trùng.
3. **Trường hợp tiền thuê thu trước:** Hóa đơn kỳ N đã tính tiền thuê N+1, nhưng phòng trả trước hoặc trong tháng N+1. Quyết toán phải đọc đúng kỳ của dòng RENT, đối chiếu nghĩa vụ đã phát hành, số tiền thực thu đã xác minh, tiền cọc và khoản điều chỉnh. Nếu tiền thuê N+1 đã thu nhưng không còn nghĩa vụ thuê tương ứng, xử lý hoàn/cấn trừ theo quy tắc quyết toán được thống nhất; nếu chưa thu thì xử lý nghĩa vụ không còn phù hợp bằng điều chỉnh hợp lệ, không tự xóa hóa đơn Final. Không mặc định hoàn toàn bộ khi khách thực tế còn nghĩa vụ trong tháng N+1.
4. Nếu không còn hợp đồng đủ điều kiện đối chiếu khi JOB-10 chạy, không trông chờ hóa đơn định kỳ để thu điện/nước/dịch vụ tháng trả phòng. Chốt các khoản đó trong quyết toán. Cần thống nhất cách xử lý bản nháp đã tồn tại trước khi toàn phòng xác nhận trả.
5. Rà soát FinalFixed, FinalUtility, ledger thanh toán ban đầu và ledger quyết toán theo kỳ khoản thu thực tế, không giả định dòng RENT của hóa đơn kỳ N luôn thuộc tháng N. Giữ lịch sử đã phát hành và không thanh toán trùng.

## Ranh giới triển khai

Không chỉnh sửa module tạo/ký/kích hoạt/gia hạn hợp đồng, thanh toán ban đầu của hợp đồng hoặc logic trả phòng/quyết toán trong thay đổi JOB-10 này. Các quy tắc trên là yêu cầu chuyển giao, chưa phải chức năng đã được triển khai. Khi các module đó hoàn tất, cần kiểm tra integration từ tạo hợp đồng đến hóa đơn và quyết toán.
