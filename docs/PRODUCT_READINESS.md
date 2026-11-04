# Theo dõi hoàn thiện sản phẩm 30NICE Mail Cloud

Kiểm tra ngày 05/11/2026, tại main sau PR #46. Đây là danh sách nghiệm thu; CI xanh không đồng nghĩa sản phẩm đã hoàn thiện hoặc đã triển khai.

## Bằng chứng hiện có
- Webmail có đọc/soạn, nháp, BCC, tìm kiếm, sao, đọc/chưa đọc, lưu trữ, Thùng rác và xác nhận xóa vĩnh viễn. CI có smoke test tương ứng; chưa có bằng chứng browser end-to-end toàn bộ.
- API/portal đã chạy local mock; HTTP health và info qua portal trả 200. Báo cáo local hiện ghi commit 1396d76, chưa chứng minh các PR sau commit này trên local.
- Main đã gộp tạo khách hàng, kiểm tra quyền thành viên, trạng thái danh sách và điều kiện health deploy. Các PR tương ứng có CI thành công.
- Workflow deploy là manual; chưa chạy deploy hoặc diễn tập rollback trong lượt nâng cấp này.

## Thứ tự nghiệm thu tiếp theo

| Ưu tiên | Phạm vi | Bằng chứng cần có để chấp nhận | Trạng thái |
|---|---|---|---|
| 1 | Webmail đầy đủ trên browser | Dữ liệu test riêng; đăng nhập, đọc, soạn rich text, nháp và mở lại, tìm, tệp đính kèm, trả lời/tất cả/chuyển tiếp; desktop/mobile; ảnh và kết quả thao tác | Chưa xác minh đầy đủ |
| 1 | Phản hồi bất đồng bộ | Browser trì hoãn response, đổi thư/thư mục/tenant, đăng xuất; dữ liệu cũ không xuất hiện lại | Có guard và smoke helper; thiếu browser regression |
| 1 | Mailbox/provisioning | PostgreSQL và Mailcow test riêng; create/update/disable/reset password/retry; timeout và kết quả không chắc chắn không sinh trùng hoặc mất quyền | Smoke dùng fake; thiếu integration thực |
| 1 | Tenant isolation | Hai tenant thật trong DB test; đọc/ghi chéo bị chặn tại mọi route và adapter; duplicate concurrent được kiểm tra | Có kiểm tra server; thiếu ma trận integration đầy đủ |
| 2 | Alias | API CRUD và giao diện; tenant sở hữu domain nguồn/đích; đồng bộ Mailcow; kiểm tra lặp và trùng | Có bảng aliases; chưa có route trong app.module.ts |
| 2 | Onboarding khách hàng | Tạo tenant → quản trị tenant → domain TXT → DNS → mailbox → webmail; lỗi có hướng dẫn và thử lại | Có các phần rời; chưa nghiệm thu toàn luồng |
| 2 | Gói dịch vụ/dung lượng | Gói cấu hình được, quota tổng/riêng được enforce khi ghi và provisioning | Menu hiện còn placeholder |
| 2 | Vận hành | Máy chủ, audit UI, cảnh báo, tác vụ lỗi, theo dõi capacity; dữ liệu thật và quyền phù hợp | Health động đã có; các menu khác chưa hoàn thiện |
| 2 | Sao lưu/khôi phục | Backup DB và mail plane được mã hóa ngoài VPS; restore vào môi trường riêng; đo RPO/RTO | Chưa có bằng chứng triển khai hoặc drill |
| 3 | Billing/hỗ trợ | Hóa đơn/subscription sandbox, webhook idempotency, grace period; support workflow | Chưa có route tương ứng trong app.module.ts |
| 3 | Khả năng gửi thư | Gửi/nhận Gmail và Outlook, SPF/DKIM/DMARC alignment, SMTP TLS, queue/rate/abuse, theo dõi spam | Người dùng từng xác nhận gửi/nhận; spam chưa xử lý hoàn tất |
| Release | Triển khai an toàn | Commit cụ thể, CI, migration backup, test staging, health nghiêm ngặt, smoke sau deploy, rollback drill | Script có gate; chưa deploy/drill |

## Nguồn đối chiếu
- apps/portal/app/page.tsx: menu và nhánh placeholder.
- apps/portal/app/webmail/: frontend và trạng thái webmail.
- apps/api/src/app.module.ts: danh sách route hiện có.
- infra/db/001_initial_schema.sql: schema, gồm aliases.
- scripts/smoke-*.cjs và .github/workflows/ci.yml: phạm vi smoke.
- infra/deploy-vps.sh và docs/VPS_RELEASE_RUNBOOK.md: release hiện có.

Không đánh dấu một hàng hoàn tất chỉ vì có schema, giao diện, test giả hoặc runbook. Cần kết quả chạy tương ứng với phạm vi của hàng.
