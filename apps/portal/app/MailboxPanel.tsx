'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, LockKeyhole, RefreshCw, UnlockKeyhole, UserPlus, X } from 'lucide-react';
import './mailbox-panel.css';

type Tenant = { id: string; name: string };
type Mailbox = { id: string; address: string; quotaGb: number; status: 'active' | 'disabled' };
type ProvisioningJob = { id: string; tenantId: string; idempotencyKey: string; jobType: string; status: string; attempts: number; lastError: string | null; createdAt: string; updatedAt: string };

export default function MailboxPanel() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenant, setTenant] = useState('');
  const [items, setItems] = useState<Mailbox[]>([]);
  const [jobs, setJobs] = useState<ProvisioningJob[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [address, setAddress] = useState('');
  const [quotaGb, setQuotaGb] = useState('5');
  const [password, setPassword] = useState('');
  const [passwordReveal, setPasswordReveal] = useState('');
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [retryingJobId, setRetryingJobId] = useState('');

  const load = useCallback(async () => {
    if (!tenant) { setItems([]); return; }
    try {
      const response = await fetch(`/api/api/v1/tenants/${tenant}/mailboxes`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không tải được danh sách hộp thư.');
      setItems(result);
      setQuotaDrafts(Object.fromEntries(result.map((item: Mailbox) => [item.id, String(item.quotaGb)])));
    } catch (reason) {
      setItems([]);
      setMessage(reason instanceof Error ? reason.message : 'Không tải được danh sách hộp thư.');
      setMessageIsError(true);
    }
  }, [tenant]);

  const hasPendingJobs = jobs.some(job => job.status === 'queued' || job.status === 'running');
  const loadJobs = useCallback(async () => {
    if (!tenant) { setJobs([]); setJobsError(''); return; }
    try {
      const response = await fetch(`/api/api/v1/tenants/${tenant}/provisioning-jobs`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không tải được lịch sử cấp phát.');
      setJobs(Array.isArray(result) ? result : []); setJobsError('');
    } catch (reason) {
      setJobsError(reason instanceof Error ? reason.message : 'Không tải được lịch sử cấp phát.');
    }
  }, [tenant]);

  useEffect(() => {
    void loadJobs();
    if (!hasPendingJobs) return;
    const timer = window.setInterval(() => { void loadJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, [loadJobs, hasPendingJobs]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/api/v1/tenants').then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không tải được danh sách khách hàng.');
      if (!cancelled) { setTenants(result); if (result[0]) setTenant(result[0].id); }
    }).catch(reason => {
      if (!cancelled) { setMessage(reason instanceof Error ? reason.message : 'Không tải được danh sách khách hàng.'); setMessageIsError(true); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    setLoading(true); setMessage(''); setMessageIsError(false);
    try {
      const response = await fetch(`/api/api/v1/tenants/${tenant}/mailboxes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim(), quotaGb: Number(quotaGb), password: password || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể tạo hộp thư.');
      setPasswordReveal(result.temporaryPassword || '');
      setMessage(result.temporaryPassword ? 'Đã tạo hộp thư. Sao chép mật khẩu tạm thời và gửi cho người dùng qua kênh an toàn.' : 'Đã tạo hộp thư thành công.');
      setAddress(''); setPassword(''); await Promise.all([load(), loadJobs()]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Không thể tạo hộp thư.'); setMessageIsError(true); await loadJobs();
    } finally { setLoading(false); }
  }

  async function retryProvisioning(job: ProvisioningJob) {
    setRetryingJobId(job.id); setPasswordReveal(''); setMessage(''); setMessageIsError(false);
    try {
      const response = await fetch(`/api/api/v1/tenants/${tenant}/provisioning-jobs/${job.id}/retry`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể thử lại cấp phát.');
      setPasswordReveal(result.temporaryPassword || '');
      setMessage(result.temporaryPassword ? 'Đã đồng bộ hộp thư với Mailcow. Sao chép mật khẩu mới và gửi qua kênh an toàn.' : 'Đã thử lại cấp phát hộp thư.');
      await Promise.all([load(), loadJobs()]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Không thể thử lại cấp phát.');
      setMessageIsError(true);
      await loadJobs();
    } finally { setRetryingJobId(''); }
  }

  async function update(item: Mailbox, changes: Partial<Pick<Mailbox, 'quotaGb' | 'status'>>) {
    setSavingId(item.id); setMessage(''); setMessageIsError(false);
    try {
      const response = await fetch(`/api/api/v1/tenants/${tenant}/mailboxes/${item.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể cập nhật hộp thư.');
      setMessage(changes.status ? (changes.status === 'active' ? 'Đã mở lại hộp thư.' : 'Đã tạm khóa hộp thư.') : 'Đã cập nhật dung lượng.');
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Không thể cập nhật hộp thư.'); setMessageIsError(true);
    } finally { setSavingId(''); }
  }

  async function resetPassword(item: Mailbox) {
    if (!window.confirm(`Đặt lại mật khẩu cho ${item.address}? Mật khẩu hiện tại sẽ ngừng hoạt động.`)) return;
    setSavingId(item.id); setMessage(''); setMessageIsError(false); setPasswordReveal('');
    try {
      const response = await fetch(`/api/api/v1/tenants/${tenant}/mailboxes/${item.id}/reset-password`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể đặt lại mật khẩu.');
      setPasswordReveal(result.temporaryPassword);
      setMessage('Đã đặt lại mật khẩu. Sao chép và gửi cho người dùng qua kênh an toàn.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Không thể đặt lại mật khẩu.'); setMessageIsError(true);
    } finally { setSavingId(''); }
  }

  return <div className="mailboxPanel">
    <div className="mailboxToolbar">
      <select aria-label="Chọn khách hàng" value={tenant} onChange={event => setTenant(event.target.value)}>
        <option value="">Chọn khách hàng</option>{tenants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button className="ghost" onClick={() => void Promise.all([load(), loadJobs()])} disabled={loading || Boolean(savingId)}><RefreshCw size={14} /> Làm mới</button>
    </div>
    <div className="mailboxCreate">
      <label>Địa chỉ hộp thư<input type="email" value={address} onChange={event => setAddress(event.target.value)} placeholder="user@congty.vn" /></label>
      <label>Dung lượng (GB)<input type="number" min="1" max="1000" step="1" value={quotaGb} onChange={event => setQuotaGb(event.target.value)} /></label>
      <label>Mật khẩu<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Để trống để tự tạo" /></label>
      <button className="primary" disabled={loading || !tenant || !address.trim() || !Number.isInteger(Number(quotaGb)) || Number(quotaGb) < 1 || Number(quotaGb) > 1000} onClick={() => void create()}>{loading ? <RefreshCw className="spin" size={16} /> : <UserPlus size={16} />} Tạo hộp thư</button>
    </div>
    {message && <p className={`mailboxMessage ${messageIsError ? 'error' : ''}`} role={messageIsError ? 'alert' : 'status'}>{message}</p>}{passwordReveal && <div className="mailboxPasswordReveal" role="status"><div><b>Mật khẩu tạm thời · chỉ hiển thị lần này</b><code>{passwordReveal}</code></div><button className="mailboxAction" onClick={() => void navigator.clipboard?.writeText(passwordReveal)}><Copy size={14} /> Sao chép</button><button className="mailboxPasswordDismiss" aria-label="Ẩn mật khẩu" onClick={() => setPasswordReveal('')}><X size={16} /></button></div>}
    <section className="provisioningHistory" aria-labelledby="provisioning-history-title">
      <div className="provisioningHistoryHeader"><div><h3 id="provisioning-history-title">Lịch sử cấp phát</h3><p>Theo dõi kết quả tạo hộp thư trong khách hàng này.</p></div><button className="mailboxAction" onClick={() => void loadJobs()}><RefreshCw size={13} /> Làm mới</button></div>
      {jobsError && <p className="provisioningHistoryError" role="alert">{jobsError}</p>}
      {!jobsError && jobs.length === 0 && <p className="provisioningHistoryEmpty">Chưa có hoạt động cấp phát.</p>}
      {jobs.slice(0, 10).map(job => <div className="provisioningJobRow" key={job.id}>
        <span className={`provisioningJobStatus ${job.status}`}>{({ queued: 'Đang chờ', running: 'Đang xử lý', succeeded: 'Thành công', failed: 'Thất bại', dead_letter: 'Cần xử lý' } as Record<string, string>)[job.status] || job.status}</span>
        <div className="provisioningJobInfo"><b>{job.jobType === 'mailbox.provision' ? 'Tạo hộp thư' : job.jobType}</b><small>{job.idempotencyKey.replace(/^mailbox:/, '')}</small>{job.lastError && <small className="provisioningJobError">{job.lastError}</small>}</div>
        <div className="provisioningJobMeta"><span>{job.attempts} lần thử</span><time dateTime={job.updatedAt}>{job.updatedAt ? new Date(job.updatedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : ''}</time>{job.jobType === 'mailbox.provision' && ['failed', 'dead_letter'].includes(job.status) && <button className="mailboxAction" disabled={Boolean(retryingJobId) || !tenant} onClick={() => void retryProvisioning(job)}>{retryingJobId === job.id ? <RefreshCw className="spin" size={13} /> : <RefreshCw size={13} />} Thử lại</button>}</div>
      </div>)}
    </section>
    <div className="mailboxList">
      {items.map(item => {
        const quota = Number(quotaDrafts[item.id] ?? item.quotaGb);
        const validQuota = Number.isInteger(quota) && quota >= 1 && quota <= 1000;
        const quotaChanged = validQuota && quota !== item.quotaGb;
        return <div className="mailboxRow" key={item.id}>
          <b>{item.address}</b>
          <label className="mailboxQuota">Dung lượng<input aria-label={`Dung lượng của ${item.address} (GB)`} type="number" min="1" max="1000" step="1" value={quotaDrafts[item.id] ?? item.quotaGb} onChange={event => setQuotaDrafts(current => ({ ...current, [item.id]: event.target.value }))} /> GB</label>
          {quotaChanged && <button className="mailboxAction save" disabled={savingId === item.id} onClick={() => void update(item, { quotaGb: quota })}><Check size={14} /> Lưu</button>}
          <em className={item.status === 'active' ? 'active' : 'disabled'}>{item.status === 'active' ? 'Đang hoạt động' : 'Đã khóa'}</em>
          <button className="mailboxAction" disabled={savingId === item.id} onClick={() => void update(item, { status: item.status === 'active' ? 'disabled' : 'active' })}>
            {item.status === 'active' ? <><LockKeyhole size={14} /> Tạm khóa</> : <><UnlockKeyhole size={14} /> Mở lại</>}
          </button>
          <button className="mailboxAction" disabled={savingId === item.id} onClick={() => void resetPassword(item)}><KeyRound size={14} /> Đặt mật khẩu mới</button>
        </div>;
      })}
      {!items.length && <p className="emptyText">{tenant ? 'Chưa có hộp thư trong khách hàng này.' : 'Chọn khách hàng để xem hộp thư.'}</p>}
    </div>
  </div>;
}
