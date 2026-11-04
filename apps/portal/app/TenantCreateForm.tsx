'use client';
import { FormEvent, useState } from 'react';

export default function TenantCreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedName = name.trim();
    const normalizedSlug = slug.trim().toLowerCase();
    if (!normalizedName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
      setError('Nhập tên khách hàng và mã chỉ gồm chữ thường, số, dấu gạch ngang.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/api/v1/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: normalizedName, slug: normalizedSlug }) });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 403 ? 'Chỉ quản trị viên hệ thống được tạo khách hàng.' : response.status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' : result.message || 'Không tạo được khách hàng. Hãy kiểm tra mã khách hàng đã tồn tại chưa.');
      setName(''); setSlug(''); setNotice('Đã tạo khách hàng. Tiếp theo, thêm tên miền và thành viên quản trị cho khách hàng.');
      onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không tạo được khách hàng.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginBottom: 24, padding: 18, border: '1px solid #e4eaf2', borderRadius: 12 }}>
    <div><h3 style={{ margin: '0 0 6px' }}>Tạo khách hàng</h3><p style={{ margin: 0, color: '#667085', fontSize: 13 }}>Tạo không gian riêng để quản lý tên miền, hộp thư và thành viên.</p></div>
    <label>Tên khách hàng<input required maxLength={120} disabled={busy} value={name} onChange={event => setName(event.target.value)} placeholder="Ví dụ: Công ty ABC" style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }} /></label>
    <label>Mã khách hàng<input required maxLength={64} disabled={busy} value={slug} onChange={event => setSlug(event.target.value.toLowerCase())} placeholder="cong-ty-abc" pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="tenant-slug-help" style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }} /></label>
    <small id="tenant-slug-help">Mã duy nhất, dùng chữ thường không dấu, số và dấu gạch ngang.</small>
    {error && <p role="alert" style={{ color: '#b42318', margin: 0 }}>{error}</p>}
    {notice && <p role="status" style={{ color: '#147d4a', margin: 0 }}>{notice}</p>}
    <button className="primary" disabled={busy} type="submit" style={{ justifySelf: 'start' }}>{busy ? 'Đang tạo…' : 'Tạo khách hàng'}</button>
  </form>;
}
