#!/usr/bin/python3
"""Dedicated systemd job; input is a verified customer domain, never a URL or shell command."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

IP = '5.189.185.36'
MARKER = '# Managed by 30NICE customer webmail'

def valid_domain(domain):
    return len(domain) <= 253 and re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain) is not None

def run(args, timeout=30):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()

def main(domain):
    if not valid_domain(domain) or domain == '30nice.vn':
        raise ValueError('Invalid customer domain')
    host = 'mail.' + domain
    folder = Path('/var/lib/30nice-mailcloud-webmail')
    folder.mkdir(mode=0o755, parents=True, exist_ok=True)
    status = folder / (host + '.json')
    def save(state, message):
        tmp = status.with_suffix('.tmp')
        tmp.write_text(json.dumps({'state': state, 'message': message, 'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        os.chmod(tmp, 0o644)
        tmp.replace(status)
    with (folder / '.activation.lock').open('w') as lock:
        # Serialize nginx/certbot operations across all customer domains.
        fcntl.flock(lock, fcntl.LOCK_EX)
        site = Path('/etc/nginx/sites-available/30nice-webmail-' + host)
        enabled = Path('/etc/nginx/sites-enabled/30nice-webmail-' + host)
        previous = site.read_text() if site.exists() else None
        was_enabled = enabled.is_symlink()
        changed = False
        try:
            save('running', 'Đang kiểm tra quyền sở hữu, DNS và cấp chứng chỉ HTTPS.')
            sql = "select d.status from domains d join tenants t on t.id=d.tenant_id where d.domain='" + domain + "' and t.status='active'"
            if run(['docker', 'exec', 'mailcloud-postgres-1', 'psql', '-U', 'mailcloud', '-d', 'mailcloud', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]) != 'verified':
                raise ValueError('Domain is not verified and active')
            for resolver in ['1.1.1.1', '8.8.8.8']:
                addresses = run(['dig', '@' + resolver, '+time=3', '+tries=1', '+short', 'A', host]).splitlines()
                ips = [x for x in addresses if re.fullmatch(r'\d+\.\d+\.\d+\.\d+', x)]
                ipv6 = run(['dig', '@' + resolver, '+time=3', '+tries=1', '+short', 'AAAA', host]).splitlines()
                if not ips or any(ip != IP for ip in ips) or any(':' in x for x in ipv6):
                    raise ValueError('DNS does not resolve exclusively to the supported server IP')
            if previous is not None and not previous.startswith(MARKER):
                raise ValueError('Refusing to overwrite an unmanaged nginx site')
            if enabled.exists() and (not enabled.is_symlink() or enabled.resolve() != site):
                raise ValueError('Conflicting nginx site link')
            # Refuse a hostname already owned by any other enabled configuration.
            for other in Path('/etc/nginx/sites-enabled').iterdir():
                if other == enabled or not other.is_file():
                    continue
                for names in re.findall(r'server_name\s+([^;]+);', other.read_text()):
                    if host in names.split():
                        raise ValueError('Hostname already belongs to another nginx site')
            webroot = Path('/var/www/letsencrypt')
            webroot.mkdir(parents=True, exist_ok=True)
            http = f'''{MARKER}
server {{
 listen 80; listen [::]:80;
 server_name {host};
 location ^~ /.well-known/acme-challenge/ {{ root /var/www/letsencrypt; }}
 location / {{ return 301 https://$host$request_uri; }}
}}
'''
            # Preserve working HTTPS while an existing certificate is renewed.
            if previous is None:
                site.write_text(http)
            if not was_enabled:
                enabled.symlink_to(site)
            changed = True
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
            run(['certbot', 'certonly', '--webroot', '-w', str(webroot), '--non-interactive', '--agree-tos', '--register-unsafely-without-email', '--keep-until-expiring', '--cert-name', host, '-d', host, '--deploy-hook', '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'], timeout=150)
            ssl = f'''server {{
 listen 443 ssl http2; listen [::]:443 ssl http2;
 server_name {host};
 ssl_certificate /etc/letsencrypt/live/{host}/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/{host}/privkey.pem;
 add_header X-30NICE-Webmail ready always;
 location /api/ {{
  proxy_pass http://127.0.0.1:3013/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 60s;
 }}
 location / {{
  proxy_pass http://127.0.0.1:3012;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto https;
 }}
}}
'''
            if previous is not None:
                backup = folder / ('nginx-' + host + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.conf')
                backup.write_text(previous)
                os.chmod(backup, 0o600)
            site.write_text(http + ssl)
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
            page = run(['curl', '-fsS', '--max-time', '15', '--resolve', host + ':443:127.0.0.1', 'https://' + host + '/'])
            if '30NICE' not in page or 'Đăng nhập quản trị' in page:
                raise ValueError('Webmail page check failed')
            save('ready', 'Webmail riêng và HTTPS đã sẵn sàng. Có thể đăng nhập bằng tài khoản hộp thư.')
        except Exception as error:
            print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
            if changed:
                if previous is None:
                    if enabled.is_symlink(): enabled.unlink()
                    if site.exists(): site.unlink()
                else:
                    site.write_text(previous)
                    if not was_enabled and enabled.is_symlink(): enabled.unlink()
                run(['nginx', '-t'])
                run(['systemctl', 'reload', 'nginx'])
            save('failed', 'Chưa kích hoạt được. Kiểm tra DNS mail, AAAA, CAA và quyền sở hữu; sau đó thử lại hoặc liên hệ 30NICE.')
            raise

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) == 2 else '')
