# 30NICE Mail Cloud 0.6.0 — Luồng khách hàng và cấp phát tin cậy

## Thay đổi
- Thiết lập khách hàng dùng chung ngữ cảnh, tự tạo mã nội bộ, lưu tên miền đang thiết lập; quản trị doanh nghiệp và hộp thư là hai loại tài khoản riêng.
- Lời mời quản trị 48 giờ, dùng một lần; khách hàng tự đặt mật khẩu rồi đăng ký MFA. Chỉ lưu mã băm liên kết. Hệ thống trả liên kết để người quản trị bàn giao, chưa tự gửi email.
- Tách xác minh quyền sở hữu DNS khỏi kết nối dịch vụ Mailcow. Chỉ tên miền đã xác minh và kết nối mới được tạo hộp thư.
- Kiểm tra hạn mức thực tế, đặt chỗ giao dịch, hàng đợi bền vững, worker có lease và thử lại. Chỉ báo sẵn sàng sau khi đọc lại Mailcow. Thử lại không tự đổi mật khẩu hộp thư tồn tại.
- Sửa hợp đồng Mailcow items/attr và truy vấn danh sách hộp thư tương thích máy chủ đang dùng. Khóa, đổi dung lượng và đặt lại mật khẩu có kiểm chứng.
- Đối soát chỉ đọc phát hiện chênh lệch; không tự áp đặt lại hạn mức kinh doanh. Tác vụ cũ thiếu bí mật mã hóa chuyển sang lỗi có giải thích.
- Quản lý gói dịch vụ, liên hệ khách hàng, trạng thái worker/cấp phát/chênh lệch và nhật ký vận hành thực tế.
- Phiên quản trị chuyển sang cookie HttpOnly, Secure, SameSite Strict; kiểm tra nguồn trình duyệt, thu hồi phiên và ràng buộc thông tin định danh quản trị. Không lưu JWT quản trị trong localStorage.
- Phiên webmail lưu bền vững trong PostgreSQL với thông tin kết nối mã hóa; kiểm tra trạng thái tài khoản và thu hồi khi khóa hoặc đặt lại mật khẩu. Chữ ký cá nhân lưu theo hộp thư.
- Backup cấu hình v2 bổ sung HTTPS, vhost khách hàng và dịch vụ thuộc Mail Cloud; không thu thập khóa các site khác trên VPS.

## Kiểm chứng
- TypeScript portal/API; các bộ smoke auth, domain, adapter, alias, DNS và webmail.
- PostgreSQL thật trong schema tạm: hạn mức đồng thời, chống trùng, rollback/thử lại, phân quyền tenant, mã hóa, lời mời một lần, MFA/cookie, phiên qua khởi động lại.
- Chrome: toàn bộ luồng tạo khách hàng đến hộp thư sẵn sàng, chuyển tenant nhanh, xóa mật khẩu tạm, chặn hết dung lượng, màn hình 320/390px.
- Mailcow thật bằng tên miền .invalid và database tạm riêng: cấp phát, đăng nhập, nháp có tệp, gửi/đọc nội bộ cùng hộp thư thử, đổi dung lượng, khóa/mở, đặt lại mật khẩu, thu hồi phiên; đã dọn tài nguyên thử.
- Local production build dùng webpack do node_modules là junction ngoài worktree; CI Linux dùng npm ci và production build mặc định.

## Vận hành và giới hạn
- Migration 007–009 tương thích bổ sung. Backup PostgreSQL trước migration. Deploy kiểm tra API, portal và heartbeat worker mới; rollback mã nguồn khi thất bại.
- Người đang dùng JWT cũ cần đăng nhập lại và xác thực MFA. Không thay mật khẩu hoặc khóa MFA hiện có.
- Chưa hoàn tất: chạy API/portal với tài khoản hệ thống tối thiểu quyền; kênh cảnh báo ra ngoài; diễn tập phục hồi đầy đủ cả thư; thanh toán/hóa đơn; offboarding và chính sách lưu giữ; bộ lọc/tự trả lời nâng cao.
- DNS vẫn do chủ tên miền cập nhật tại nhà cung cấp. DKIM phải dùng khóa đúng từng tên miền; bản ghi tùy chọn không được coi là lỗi chặn sử dụng webmail.
- Không tự tăng gói, không tự ghi đè dung lượng hoặc đặt lại mật khẩu của hộp thư khách hàng đang dùng.
