# Thiết lập DNS và webmail khách hàng

Màn hình **Tên miền → DNS và webmail riêng** dùng cùng bảng hướng dẫn với bước tên miền trong **Thiết lập khách hàng**. Chọn khách hàng và tên miền trước khi thao tác.

1. Bấm **Chuẩn bị DNS** để lấy mã TXT còn thiếu. Thêm TXT xác minh tại nhà cung cấp DNS, rồi bấm **Xác minh quyền sở hữu**.
2. Sau khi xác minh, bấm **Chuẩn bị DNS** lần nữa để đọc hoặc tạo DKIM. Khóa đang có không bị đổi; API chỉ trả selector và TXT công khai, không trả khóa riêng.
3. Sao chép các bản ghi hoặc tải hướng dẫn TXT. MX, SPF, DKIM và DMARC là cấu hình email cơ bản. Không tạo nhiều SPF, không ghi đè nguồn gửi cũ khi chưa kiểm tra, không hạ chính sách DMARC đang dùng.
4. Nếu dùng webmail riêng, thêm CNAME `mail` về `mail.30nice.vn`, hoặc giữ A trỏ `5.189.185.36`. Không thêm CNAME trùng tên A. Không để AAAA khi máy chủ chưa phục vụ IPv6 cho hostname đó.
5. Bấm **Kích hoạt webmail riêng**. Hệ thống xử lý nền và hiển thị tiến độ. Sau khi DNS và HTTPS đều đạt, mở webmail và đăng nhập bằng tài khoản hộp thư, không dùng tài khoản quản trị.

`autoconfig` và `autodiscover` được đặt trong nhóm tùy chọn; không chặn sử dụng webmail. Bản ghi CNAME đúng không tự bảo đảm HTTPS và endpoint ứng dụng hoạt động; cần nghiệm thu riêng khi cung cấp tính năng ứng dụng thư. SRV và TLSA không có trong luồng cơ bản.

## Vận hành

Deploy cài `infra/webmail-activate.py` vào `/usr/local/sbin/30nice-webmail-activate` và unit `30nice-webmail@.service`. API chỉ nhận domain ID thuộc tenant của phiên đăng nhập; helper độc lập kiểm tra domain hợp lệ, trạng thái verified và tenant active trong PostgreSQL.

Helper kiểm tra A/AAAA qua hai resolver, tuần tự hóa nginx/certbot bằng khóa hệ thống, từ chối ghi đè vhost không thuộc 30NICE và không thay vhost trung tâm. Chứng chỉ dùng certbot webroot `/var/www/letsencrypt`. CAA và cổng 80 phải cho phép xác thực Let's Encrypt. Certbot renewal vẫn do timer certbot của VPS đảm nhiệm.

Trạng thái không chứa bí mật nằm tại `/var/lib/30nice-mailcloud-webmail/mail.DOMAIN.json`. Khi lỗi cấp chứng chỉ, cấu hình nginx mới được gỡ hoặc cấu hình cũ được khôi phục; dịch vụ khác không bị sửa. Chứng chỉ đã phát hành được giữ lại để thử lại. Xem log bằng `journalctl -u 30nice-webmail@DOMAIN.service`; không đổi trạng thái thành ready bằng tay.

DNS checker ghép TXT nhiều đoạn; đối chiếu DKIM với khóa đang dùng và selector thực tế. SPF có include/redirect hoặc nguồn gửi ngoài mẫu đơn giản được báo cần kiểm tra, không bị khẳng định là sai. Không tự sửa DNS của khách hàng. Khi DNS provider có API, có thể tích hợp tự tạo bản ghi ở giai đoạn sau với quyền riêng của từng khách hàng.

Kiểm thử: `node scripts/smoke-dns-setup.cjs` sau build API; `python3 scripts/smoke-webmail-activation.py` trên Linux kiểm tra đường thành công, domain chưa xác minh, DNS sai, vhost ngoài quản lý và rollback cấp chứng chỉ.
