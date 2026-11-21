#!/usr/bin/env python3
import datetime
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path

checks = {}
def check(name, operation):
    try:
        detail = operation()
        checks[name] = {'ok': True, 'detail': detail}
    except Exception as error:
        checks[name] = {'ok': False, 'detail': str(error)[:240]}

def api():
    with urllib.request.urlopen('http://127.0.0.1:3013/health', timeout=10) as response:
        data = json.load(response)
    if not (data.get('productionReady') is True and data.get('database', {}).get('connected') is True and data.get('mailcow', {}).get('healthy') is True):
        raise RuntimeError('API, PostgreSQL or Mailcow is not ready')
    return 'API, PostgreSQL and Mailcow ready'

def webmail():
    with urllib.request.urlopen('https://mail.30nice.vn/', timeout=15) as response:
        if response.status != 200:
            raise RuntimeError('Webmail HTTP status ' + str(response.status))
    return 'HTTPS 200'

def disk():
    usage = shutil.disk_usage('/opt')
    percent = round(100 * usage.used / usage.total, 1)
    if percent >= 85:
        raise RuntimeError('Disk usage ' + str(percent) + '% exceeds 85%')
    return str(percent) + '% used'

def backup():
    stamp = Path('/opt/30nice-mail-cloud-backups/scheduled/last-success').read_text().strip()
    when = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
    hours = (datetime.datetime.now(datetime.timezone.utc) - when).total_seconds() / 3600
    if hours < 0 or hours > 36:
        raise RuntimeError('Verified backup age ' + str(round(hours, 1)) + ' hours; limit 36')
    return 'Verified backup age ' + str(round(hours, 1)) + ' hours'

def tls():
    with socket.create_connection(('mx.30nice.vn', 993), timeout=10) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname='mx.30nice.vn') as secure:
            expiry = ssl.cert_time_to_seconds(secure.getpeercert()['notAfter'])
    days = (expiry - datetime.datetime.now(datetime.timezone.utc).timestamp()) / 86400
    if days < 14:
        raise RuntimeError('IMAP TLS expires in ' + str(int(days)) + ' days')
    return 'Verified IMAP TLS; ' + str(int(days)) + ' days remaining'

check('api_database_mailcow', api)
check('webmail_https', webmail)
check('disk', disk)
check('verified_backup', backup)
check('imap_tls', tls)
healthy = all(item['ok'] for item in checks.values())
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'healthy': healthy, 'checks': checks}
directory = Path('/var/lib/30nice-mailcloud-monitor')
directory.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(directory, 0o700)
temporary = directory / 'status.json.tmp'
temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2))
os.chmod(temporary, 0o600)
temporary.replace(directory / 'status.json')
for name, result in checks.items():
    print(('OK ' if result['ok'] else 'FAILED ') + name + ': ' + result['detail'])
    if not result['ok']:
        subprocess.run(['logger', '-p', 'daemon.err', '-t', '30nice-mailcloud', name + ': ' + result['detail']], check=False)
sys.exit(0 if healthy else 1)
