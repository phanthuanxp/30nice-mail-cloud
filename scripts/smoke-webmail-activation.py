import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('activate',Path(__file__).resolve().parents[1]/'infra/webmail-activate.py')
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class ActivationChecks(unittest.TestCase):
 def test_rejects_untrusted_input(self):
  for name in ['example.com;id','../example.com','https://example.com','-example.com','EXAMPLE.COM']:
   self.assertFalse(helper.valid_domain(name))
 def exercise(self, failure=None, previous=None):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   for folder in ['etc/nginx/sites-available','etc/nginx/sites-enabled']:(root/folder).mkdir(parents=True)
   site=root/'etc/nginx/sites-available/30nice-webmail-mail.example.com'
   enabled=root/'etc/nginx/sites-enabled/30nice-webmail-mail.example.com'
   if previous is not None:site.write_text(previous);enabled.symlink_to(site)
   calls=[]
   def run(args,timeout=30):
    calls.append(args)
    if args[0]=='docker':return 'pending' if failure=='ownership' else 'verified'
    if args[0]=='dig':return '' if 'AAAA' in args else ('203.0.113.1' if failure=='dns' else helper.IP)
    if args[0]=='certbot' and failure=='certificate':raise RuntimeError('fixture issuance failure')
    if args[0]=='curl':return '30NICE webmail'
    return ''
   with patch.object(helper,'Path',lambda value:root/str(value).lstrip('/')),patch.object(helper,'run',run):
    if failure or previous=='unmanaged':
     with self.assertRaises(Exception):helper.main('example.com')
     if previous is None:self.assertFalse(enabled.exists());self.assertFalse(site.exists())
     else:self.assertEqual(site.read_text(),previous)
    else:
     helper.main('example.com');self.assertIn('ssl_certificate',site.read_text());self.assertTrue(enabled.is_symlink())
   return calls
 def test_verified_dns_and_https_success(self):
  calls=self.exercise();self.assertTrue(any(c[0]=='certbot' and '--deploy-hook' in c for c in calls))
 def test_unverified_domain_never_changes_nginx(self):
  calls=self.exercise('ownership');self.assertFalse(any(c[0]=='nginx' for c in calls))
 def test_wrong_dns_never_changes_nginx(self):
  calls=self.exercise('dns');self.assertFalse(any(c[0]=='nginx' for c in calls))
 def test_certificate_failure_removes_new_site(self):self.exercise('certificate')
 def test_certificate_failure_restores_existing_site(self):self.exercise('certificate',helper.MARKER+'\nserver { fixture; }')
 def test_unmanaged_site_is_preserved(self):self.exercise(previous='unmanaged')

if __name__=='__main__':unittest.main()
