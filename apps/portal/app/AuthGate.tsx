'use client';

import { FormEvent, useEffect, useState } from 'react';
import './auth-gate.css';

type Step = 'password' | 'setup' | 'challenge' | 'recovery';
type LoginResponse = { mfaRequired?: boolean; challengeToken?: string; mfaSetupRequired?: boolean; setupToken?: string };
type SetupResponse = { secret: string; issuer: string; account: string; otpauthUrl: string };

const API = '/api/api/v1/auth';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => typeof window === 'undefined' ? null : localStorage.getItem('30nice_session'));
  const [sessionChecking, setSessionChecking] = useState(() => typeof window !== 'undefined' && Boolean(localStorage.getItem('30nice_session')));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('password');
  const [setupToken, setSetupToken] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    const original = window.fetch;
    window.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return original(input, { ...init, headers });
    };
    return () => { window.fetch = original; };
  }, [token]);

  useEffect(() => {
    if (!token) { setSessionChecking(false); return; }
    let active = true;
    void fetch(`${API}/mfa/status`, { headers: { Authorization: `Bearer ${token}` } }).then(response => {
      if (!active) return;
      if (response.status === 401) {
        localStorage.removeItem('30nice_session'); setToken(null); setStep('password'); setPassword('');
      }
    }).catch(() => undefined).finally(() => { if (active) setSessionChecking(false); });
    return () => { active = false; };
  }, [token]);

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message || 'Không thể hoàn tất xác thực.');
    return result as T;
  }

  function acceptToken(value: string) {
    localStorage.setItem('30nice_session', value);
    setToken(value);
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await post<LoginResponse>('/login', { email, password });
      if (result.mfaRequired && result.challengeToken) { setChallengeToken(result.challengeToken); setCode(''); setStep('challenge'); return; }
      if (result.mfaSetupRequired && result.setupToken) {
        setSetupToken(result.setupToken);
        const setupData = await post<SetupResponse>('/mfa/setup', { setupToken: result.setupToken });
        setSetup(setupData); setCode(''); setStep('setup'); return;
      }
      throw new Error('Máy chủ không trả về bước MFA bắt buộc. Hãy thử đăng nhập lại.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Đăng nhập không thành công'); }
    finally { setLoading(false); }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await post<{ accessToken: string }>('/mfa/verify', { challengeToken, code });
      acceptToken(result.accessToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mã xác thực không hợp lệ'); }
    finally { setLoading(false); }
  }

  async function enableMfa(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await post<{ accessToken: string; recoveryCodes: string[] }>('/mfa/enable', { setupToken, code });
      setRecoveryCodes(result.recoveryCodes); setRecoverySaved(false); setStep('recovery');
      sessionStorage.setItem('30nice_mfa_pending_session', result.accessToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể bật xác thực hai bước'); }
    finally { setLoading(false); }
  }

  function finishRecoveryStep() {
    if (!recoverySaved) return;
    const pendingToken = sessionStorage.getItem('30nice_mfa_pending_session');
    sessionStorage.removeItem('30nice_mfa_pending_session');
    if (pendingToken) acceptToken(pendingToken);
  }

  if (token && sessionChecking) return <main className="authShell"><section className="authCard"><div className="authLogo">30</div><p className="authEyebrow">30NICE MAIL CLOUD</p><h1>Đang kiểm tra phiên</h1><p className="authSub">Đang xác minh trạng thái đăng nhập an toàn…</p></section></main>;
  if (token) return <>{children}</>;

  return <main className="authShell"><section className="authCard">
    <div className="authLogo">30</div>
    <p className="authEyebrow">30NICE MAIL CLOUD</p>
    {step === 'password' && <>
      <h1>Đăng nhập quản trị</h1><p className="authSub">Quản lý email doanh nghiệp an toàn và tập trung.</p>
      <form onSubmit={submitPassword}>
        <label>Email quản trị<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="admin@30nice.vn" required /></label>
        <label>Mật khẩu<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        {error && <div className="authError" role="alert">{error}</div>}
        <button className="authButton" disabled={loading}>{loading ? 'Đang kiểm tra…' : 'Tiếp tục'}</button>
      </form>
      <small>Đăng nhập gồm mật khẩu và mã xác thực hai bước.</small>
    </>}

    {step === 'setup' && setup && <>
      <h1>Bật xác thực hai bước</h1>
      <p className="authSub">Thêm tài khoản này vào Google Authenticator, Microsoft Authenticator hoặc ứng dụng TOTP khác.</p>
      <div className="authMfaInfo"><b>{setup.issuer}</b><span>{setup.account}</span><small>Chọn thêm tài khoản bằng khóa thiết lập</small><code>{setup.secret}</code><button className="authCopy" type="button" onClick={() => void navigator.clipboard?.writeText(setup.secret)}>Sao chép khóa</button></div>
      <form onSubmit={enableMfa}>
        <label>Mã 6 chữ số<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
        {error && <div className="authError" role="alert">{error}</div>}
        <button className="authButton" disabled={loading || code.length !== 6}>{loading ? 'Đang xác nhận…' : 'Xác nhận và bật MFA'}</button>
      </form>
      <small>Nhập mã đang hiển thị trong ứng dụng để xác nhận khóa đã được lưu đúng.</small>
    </>}

    {step === 'challenge' && <>
      <h1>Xác minh đăng nhập</h1><p className="authSub">Nhập mã từ ứng dụng xác thực hoặc dùng một mã khôi phục.</p>
      <form onSubmit={submitMfa}>
        <label>Mã xác thực hoặc mã khôi phục<input autoComplete="one-time-code" autoFocus value={code} onChange={event => setCode(event.target.value.slice(0, 40))} placeholder="Mã 6 chữ số" required /></label>
        {error && <div className="authError" role="alert">{error}</div>}
        <button className="authButton" disabled={loading || code.trim().length < 6}>{loading ? 'Đang xác minh…' : 'Xác minh'}</button>
      </form>
      <button className="authTextButton" type="button" onClick={() => { setCode(''); setError(''); setStep('password'); setPassword(''); }}>Quay lại đăng nhập</button>
      <small>Mỗi mã khôi phục chỉ dùng được một lần.</small>
    </>}

    {step === 'recovery' && <>
      <h1>Lưu mã khôi phục</h1><p className="authSub">Mỗi mã dùng được một lần khi bạn không truy cập được ứng dụng xác thực. Các mã này chỉ hiển thị lần này.</p>
      <div className="authRecoveryCodes">{recoveryCodes.map(item => <code key={item}>{item}</code>)}</div>
      <button className="authCopy" type="button" onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>Sao chép toàn bộ mã</button>
      <label className="authCheck"><input type="checkbox" checked={recoverySaved} onChange={event => setRecoverySaved(event.target.checked)} /> Tôi đã lưu các mã ở nơi an toàn.</label>
      <button className="authButton" disabled={!recoverySaved} onClick={finishRecoveryStep}>Hoàn tất và vào trang quản trị</button>
      <small>Không lưu mã khôi phục trong cùng thiết bị với ứng dụng xác thực.</small>
    </>}
  </section></main>;
}
