# Kết nối DNS theo ba bước

- Một nút chính Kiểm tra và tiếp tục: xác nhận TXT, kết nối dịch vụ, lấy DKIM, kiểm tra gửi nhận và đề nghị cấp HTTPS cho webmail riêng.
- Chỉ hiển thị bản ghi của bước hiện tại; bản ghi đã đúng thu gọn, ứng dụng thư là tùy chọn đóng sẵn.
- Sao chép riêng loại, tên/host, nội dung và ưu tiên; chuyển tên ngắn/tên đầy đủ để tránh lặp hậu tố.
- Webmail chung mặc định không cần DNS bổ sung; địa chỉ riêng cần bản ghi mail và HTTPS được xác nhận.
- Hướng dẫn Cloudflare và nhà cung cấp khác; chưa tích hợp Domain Connect hay API sửa DNS tự động.
- Chuyển dịch vụ có hướng dẫn chuẩn bị hộp thư và chuyển MX cuối; không ghi đè SPF/DMARC đã đúng. File hướng dẫn giữ giá trị hiện có đã được kiểm tra.
- Tự kiểm tra tùy chọn 20 giây trong 10 phút, chỉ đọc; cấp HTTPS được theo dõi riêng.

Kiểm chứng: TypeScript, smoke DNS backend, Chrome mô phỏng toàn bộ luồng mới/cũ, lỗi truy vấn DNS, copy đầy đủ DKIM, xuất hướng dẫn, webmail chung/riêng, bản ghi tùy chọn không chặn, bố cục 320/390px.
Không thay schema hoặc DNS production. Tích hợp tự động theo nhà cung cấp là phần tiếp theo, phụ thuộc hỗ trợ và quyền được cấp.
