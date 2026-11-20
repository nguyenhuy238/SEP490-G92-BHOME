# Link truy cập BHOME

Cập nhật theo checkpoint triển khai ngày 20/11/2026.

## Staging

| Dịch vụ        | Link truy cập                                  |
| -------------- | ---------------------------------------------- |
| Owner Web      | https://owner-staging.103.146.23.157.sslip.io  |
| Public Website | https://public-staging.103.146.23.157.sslip.io |
| API            | https://api-staging.103.146.23.157.sslip.io    |

Public Staging hiện chưa có cơ sở/phòng được Owner công bố.

## Alias Staging cũ còn được giữ

| Dịch vụ           | Alias tương thích                                 |
| ----------------- | ------------------------------------------------- |
| Owner Web cũ      | https://owner-sepay-test.103.146.23.157.sslip.io  |
| Public Website cũ | https://public-sepay-test.103.146.23.157.sslip.io |
| API và webhook cũ | https://api-sepay-test.103.146.23.157.sslip.io    |

Dùng hostname `*-staging` cho truy cập mới. Alias cũ giữ bundle cũ, cookie phiên cũ
và liên kết/webhook đang dùng; không redirect webhook POST. Cookie vẫn giới hạn theo
host nên lần đầu vào Owner hostname mới cần đăng nhập, không chia sẻ cookie giữa hai host.

## Production

| Dịch vụ        | Link truy cập                         |
| -------------- | ------------------------------------- |
| Owner Web      | https://owner.103.146.23.157.sslip.io |
| Public Website | https://www.103.146.23.157.sslip.io   |
| API            | https://api.103.146.23.157.sslip.io   |

Production vẫn chạy phiên bản cũ, chưa triển khai candidate mới.

## Tài liệu liên quan

- [Thiết lập môi trường cho team](BHOME_TEAM_ENVIRONMENT_SETUP.md)
- [Vận hành Staging](BHOME_STAGING_DEPLOYMENT.md)
- [Phát hành Production](BHOME_PRODUCTION_RELEASE_RUNBOOK.md)
- [Nghiệm thu chuyển hostname Staging](BHOME_STAGING_HOSTNAME_MIGRATION_2026-11-20.md)
