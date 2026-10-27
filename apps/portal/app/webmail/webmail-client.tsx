'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, File, Inbox, LogOut, Mail, MailOpen, Menu, Paperclip, PenLine, RefreshCw, Reply, Search, Send, Settings, ShieldCheck, Square, Star, Trash2, X } from 'lucide-react';

type Folder = { path: string; name: string; specialUse: string | null; messages: number; unread: number };
type Address = { address: string; name: string };
type MailItem = { uid: number; subject: string; from: Address[]; to: Address[]; date: string | null; seen: boolean; flagged: boolean; size: number };
type Message = MailItem & { folder: string; cc: string; ccAddresses: Address[]; text: string; html: string; attachments: { index: number; filename: string; contentType: string; size: number }[] };
type Compose = { to: string; cc: string; subject: string; text: string; files: File[] };

const API = '/api/api/v1/webmail';
const FOLDER_ICONS: Record<string, typeof Inbox> = { '\\Inbox': Inbox, '\\Sent': Send, '\\Drafts': File, '\\Trash': Trash2, '\\Junk': ShieldCheck, '\\Archive': Archive, '\\Flagged': Star };

function folderLabel(folder: Folder) {
  const labels: Record<string, string> = { '\\Inbox': 'Hộp thư đến', '\\Sent': 'Đã gửi', '\\Drafts': 'Thư nháp', '\\Trash': 'Thùng rác', '\\Junk': 'Thư rác', '\\Archive': 'Lưu trữ', '\\Flagged': 'Có gắn sao' };
  return labels[folder.specialUse || ''] || (folder.path.toUpperCase() === 'INBOX' ? 'Hộp thư đến' : folder.name);
}
function person(address?: Address) { return address?.name || address?.address || 'Không rõ người gửi'; }
function initials(name: string) { return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(bit => bit[0]).join('').toUpperCase() || 'M'; }
function shortDate(value: string | null) { if (!value) return ''; const date = new Date(value); return date.toLocaleDateString('vi-VN') === new Date().toLocaleDateString('vi-VN') ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); }
function formatBytes(value: number) { if (!value) return ''; return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(0)} KB`; }

export default function WebmailClient() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState('INBOX');
  const [items, setItems] = useState<MailItem[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [listFilter, setListFilter] = useState<'all' | 'unread' | 'starred'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const [compose, setCompose] = useState<Compose | null>(null);
  const [showCc, setShowCc] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const multipart = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    const response = await fetch(`${API}${path}`, { ...init, credentials: 'same-origin', headers: { ...(init?.body && !multipart ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
    if (!response.ok) {
      let message = 'Đã có lỗi xảy ra. Vui lòng thử lại.';
      try { const data = await response.json(); message = data.message || message; } catch { /* Keep the friendly fallback. */ }
      throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }
    return response.status === 204 ? null : response.json();
  }, []);

  const loadFolders = useCallback(async () => {
    const data = await request('/folders') as Folder[];
    setFolders(data);
    if (data.length) setFolder(current => data.some(item => item.path === current) ? current : data.find(item => item.specialUse === '\\Inbox')?.path || data[0].path);
  }, [request]);

  const loadMessages = useCallback(async (activeFolder = folder, search = query, activePage = page, activeFilter = listFilter) => {
    setBusy(true);
    try {
      const data = await request(`/messages?folder=${encodeURIComponent(activeFolder)}&q=${encodeURIComponent(search)}&page=${activePage}&filter=${activeFilter}`) as { messages: MailItem[]; total: number };
      setItems(data.messages);
      setTotal(data.total);
      setSelectedUids(new Set());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không tải được danh sách thư.'); }
    finally { setBusy(false); }
  }, [folder, listFilter, page, query, request]);

  const enterMailbox = useCallback(async (address?: string) => {
    try { const session = await request('/session') as { email: string }; setAccount(session.email); setAuthenticated(true); setError(''); await loadFolders(); }
    catch { if (address) setAuthenticated(false); }
  }, [loadFolders, request]);

  useEffect(() => { void enterMailbox(); }, [enterMailbox]);
  useEffect(() => { if (authenticated) void loadMessages(folder, query); }, [authenticated, folder, query, loadMessages]);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setQuery(searchInput); }, 350); return () => window.clearTimeout(timer); }, [searchInput]);

  const unreadCount = useMemo(() => folders.reduce((sum, item) => sum + item.unread, 0), [folders]);
  const visibleItems = items;
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(item => selectedUids.has(item.uid));

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }) as { email: string };
      setAccount(result.email); setAuthenticated(true); setPassword(''); await loadFolders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không đăng nhập được.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try { await request('/logout', { method: 'POST' }); } finally { setAuthenticated(false); setAccount(''); setItems([]); setSelected(null); setFolders([]); setNotice(''); }
  }

  async function openMessage(item: MailItem) {
    setBusy(true); setError('');
    try {
      const data = await request(`/messages/${item.uid}?folder=${encodeURIComponent(folder)}`) as Message;
      setSelected(data); setItems(current => current.map(message => message.uid === item.uid ? { ...message, seen: true } : message));
      void loadFolders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không mở được thư.'); }
    finally { setBusy(false); }
  }

  async function updateFlag(item: MailItem, flag: string) {
    try {
      await request(`/messages/${item.uid}/flags`, { method: 'POST', body: JSON.stringify({ folder, flag }) });
      setItems(current => current.map(message => message.uid === item.uid ? { ...message, flagged: flag === 'flagged', seen: flag === 'seen' ? true : flag === 'unseen' ? false : message.seen } : message));
      if (selected?.uid === item.uid) setSelected(current => current ? { ...current, flagged: flag === 'flagged', seen: flag === 'seen' ? true : flag === 'unseen' ? false : current.seen } : null);
      void loadFolders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không cập nhật được thư.'); }
  }

  async function deleteMessage(item: MailItem) {
    try { await request(`/messages/${item.uid}/trash`, { method: 'POST', body: JSON.stringify({ folder }) }); setSelected(null); await loadMessages(); await loadFolders(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không chuyển được thư vào thùng rác.'); }
  }

  async function bulkUpdate(flag: 'seen' | 'unseen') {
    const targets = items.filter(item => selectedUids.has(item.uid));
    if (!targets.length) return;
    try {
      await Promise.all(targets.map(item => request(`/messages/${item.uid}/flags`, { method: 'POST', body: JSON.stringify({ folder, flag }) })));
      setItems(current => current.map(item => selectedUids.has(item.uid) ? { ...item, seen: flag === 'seen' } : item));
      setSelectedUids(new Set());
      void loadFolders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không cập nhật được các thư đã chọn.'); }
  }

  async function bulkDelete() {
    const targets = items.filter(item => selectedUids.has(item.uid));
    if (!targets.length) return;
    try {
      await Promise.all(targets.map(item => request(`/messages/${item.uid}/trash`, { method: 'POST', body: JSON.stringify({ folder }) })));
      setSelectedUids(new Set()); setSelected(null); await loadMessages(); await loadFolders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không chuyển được các thư đã chọn vào thùng rác.'); }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault(); if (!compose) return; setBusy(true); setError('');
    try {
      const body = new FormData();
      body.set('to', compose.to); body.set('cc', compose.cc); body.set('subject', compose.subject); body.set('text', compose.text);
      compose.files.forEach(file => body.append('attachments', file, file.name));
      const result = await request('/send', { method: 'POST', body }) as { savedToSent: boolean };
      setCompose(null); setShowCc(false);
      setNotice(result.savedToSent ? 'Đã gửi thư và lưu bản sao trong Đã gửi.' : 'Thư đã được máy chủ gửi đi, nhưng chưa lưu được bản sao vào Đã gửi. Không cần gửi lại.');
      const sent = folders.find(item => item.specialUse === '\\Sent'); if (sent) { setPage(1); setFolder(sent.path); setQuery(''); setSearchInput(''); setListFilter('all'); setSelected(null); await loadMessages(sent.path, '', 1, 'all'); try { await loadFolders(); } catch { setNotice('Đã gửi thư. Không tải lại được danh sách thư mục; hãy bấm Làm mới.'); } }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không gửi được thư.'); }
    finally { setBusy(false); }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []);
    event.target.value = '';
    if (!compose || !incoming.length) return;
    const next = [...compose.files, ...incoming];
    const bytes = next.reduce((total, file) => total + file.size, 0);
    if (next.length > 5) { setError('Mỗi email đính kèm tối đa 5 tệp.'); return; }
    if (bytes > 20 * 1024 * 1024) { setError('Tổng dung lượng tệp đính kèm tối đa là 20 MB.'); return; }
    setError(''); setCompose({ ...compose, files: next });
  }

  function replyTo(message: Message, replyAll = false) {
    const sender = message.from[0];
    const own = account.toLowerCase();
    const toAddresses = [...new Set([sender?.address || '', ...(replyAll ? message.to.map(value => value.address) : [])].filter(value => value && value.toLowerCase() !== own))];
    const ccAddresses = replyAll ? [...new Set(message.ccAddresses.map(value => value.address).filter((value): value is string => Boolean(value) && value.toLowerCase() !== own && !toAddresses.includes(value)))] : [];
    setShowCc(ccAddresses.length > 0);
    setCompose({ to: toAddresses.join(', '), cc: ccAddresses.join(', '), subject: /^(re|aw):/i.test(message.subject) ? message.subject : `Re: ${message.subject}`, text: `\n\n────────── Thư gốc ──────────\nTừ: ${person(sender)}\n${message.text.slice(0, 2000)}`, files: [] });
    setSelected(null);
  }

  if (!authenticated) return <div className="wm-login-page"><div className="wm-login-card"><div className="wm-brand-mark"><Mail size={25} /></div><div className="wm-login-brand">30NICE <span>Mail</span></div><h1>Chào mừng bạn trở lại</h1><p>Đăng nhập bằng địa chỉ email doanh nghiệp của bạn.</p>{error && <div className="wm-alert">{error}</div>}<form onSubmit={signIn}><label>Địa chỉ email<input type="email" autoComplete="username" required placeholder="ban@congty.vn" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="wm-button-primary wm-login-submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button></form><div className="wm-login-help"><ShieldCheck size={15} /> Phiên đăng nhập được bảo vệ</div><small>30NICE Mail · Email doanh nghiệp</small></div></div>;

  return <div className="wm-app">
    <header className="wm-topbar">
      <button className="wm-icon-btn wm-mobile-menu" aria-label="Mở điều hướng" onClick={() => setMobileNav(!mobileNav)}><Menu size={21} /></button>
      <div className="wm-logo"><div className="wm-brand-mark"><Mail size={22} /></div><span>30NICE <b>Mail</b></span></div>
      <form className="wm-search" onSubmit={event => { event.preventDefault(); setQuery(searchInput); void loadMessages(folder, searchInput); }}><Search size={20} /><input aria-label="Tìm kiếm thư" placeholder="Tìm trong thư" value={searchInput} onChange={event => setSearchInput(event.target.value)} /><button aria-label="Tìm kiếm"><Search size={17} /></button></form>
      <div className="wm-top-actions"><button className="wm-icon-btn wm-help" aria-label="Trợ giúp"><CircleHelp size={19} /></button><div className="wm-user-chip"><span className="wm-avatar wm-avatar-small">{initials(account)}</span><span className="wm-user-email">{account}</span><ChevronDown size={15} /></div><button className="wm-icon-btn wm-logout" aria-label="Đăng xuất" title="Đăng xuất" onClick={() => void signOut()}><LogOut size={18} /></button></div>
    </header>
    <div className="wm-layout">
      <aside className={`wm-sidebar ${mobileNav ? 'wm-sidebar-open' : ''}`}>
        <button className="wm-compose-btn" onClick={() => { setCompose({ to: '', cc: '', subject: '', text: '', files: [] }); setMobileNav(false); }}><PenLine size={19} /> Soạn thư</button>
        <nav className="wm-folder-nav" aria-label="Thư mục">
          {folders.map(item => { const Icon = FOLDER_ICONS[item.specialUse || ''] || (item.path.toUpperCase() === 'INBOX' ? Inbox : Mail); return <button key={item.path} className={`wm-folder-link ${folder === item.path && !selected ? 'active' : ''}`} onClick={() => { setPage(1); setFolder(item.path); setSelected(null); setMobileNav(false); }}><Icon size={18} /><span>{folderLabel(item)}</span>{item.unread > 0 && <b>{item.unread}</b>}</button>; })}
        </nav>
        <div className="wm-sidebar-bottom"><div className="wm-storage"><div className="wm-storage-title"><span>Dung lượng hộp thư</span><span><ShieldCheck size={15} /></span></div><div className="wm-storage-bar"><i /></div><small>Được quản lý bởi quản trị viên</small></div><button className="wm-folder-link"><Settings size={18} /><span>Cài đặt</span></button><button className="wm-folder-link"><CircleHelp size={18} /><span>Trợ giúp & phản hồi</span></button></div>
      </aside>
      <main className="wm-main">
        {error && <div className="wm-inline-alert"><span>{error}</span><button aria-label="Đóng" onClick={() => setError('')}><X size={16} /></button></div>}{notice && <div className="wm-inline-notice" role="status"><span>{notice}</span><button aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={16} /></button></div>}
        <section className={`wm-mail-panel ${selected ? 'wm-reading' : ''}`}>
          <div className="wm-toolbar">
            <div className="wm-toolbar-left">{selected ? <button className="wm-icon-btn" aria-label="Quay lại danh sách" onClick={() => setSelected(null)}><ArrowLeft size={19} /></button> : <><button className="wm-icon-btn" aria-label={allVisibleSelected ? 'Bỏ chọn thư' : 'Chọn tất cả thư'} onClick={() => setSelectedUids(allVisibleSelected ? new Set() : new Set(visibleItems.map(item => item.uid)))}>{allVisibleSelected ? <CheckSquare size={17} /> : <Square size={17} />}</button><button className="wm-icon-btn" aria-label="Làm mới" onClick={() => void loadMessages()}><RefreshCw size={17} /></button>{selectedUids.size > 0 && <><span className="wm-selected-count">Đã chọn {selectedUids.size}</span><button className="wm-icon-btn" aria-label="Đánh dấu đã đọc" title="Đánh dấu đã đọc" onClick={() => void bulkUpdate('seen')}><MailOpen size={17} /></button><button className="wm-icon-btn" aria-label="Chuyển vào thùng rác" title="Chuyển vào thùng rác" onClick={() => void bulkDelete()}><Trash2 size={17} /></button></>}</>}</div>
            <div className="wm-toolbar-right">{selected ? <><button className="wm-icon-btn" title="Đánh dấu sao" aria-label="Đánh dấu sao" onClick={() => void updateFlag(selected, selected.flagged ? 'unflagged' : 'flagged')}><Star size={18} fill={selected.flagged ? 'currentColor' : 'none'} /></button><button className="wm-icon-btn" title="Xóa thư" aria-label="Xóa thư" onClick={() => void deleteMessage(selected)}><Trash2 size={18} /></button><button className="wm-icon-btn" title="Danh sách thư" aria-label="Danh sách thư" onClick={() => setSelected(null)}><ChevronLeft size={19} /></button></> : <><span>{total ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} / ${total}` : '0 thư'}{unreadCount ? ` · ${unreadCount} chưa đọc` : ''}</span><button className="wm-icon-btn" aria-label="Trang trước" title="Thư mới hơn" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}><ChevronLeft size={19} /></button><button className="wm-icon-btn" aria-label="Trang sau" title="Thư cũ hơn" disabled={page * 50 >= total || busy} onClick={() => setPage(value => value + 1)}><ChevronRight size={19} /></button></>}</div>
          </div>
          {selected ? <article className="wm-reader"><div className="wm-reader-title"><h1>{selected.subject}</h1><span className="wm-inbox-tag">{folderLabel(folders.find(item => item.path === selected.folder) || { path: selected.folder, name: selected.folder, specialUse: null, messages: 0, unread: 0 })}</span></div><div className="wm-message-head"><div className="wm-avatar">{initials(person(selected.from[0]))}</div><div className="wm-sender"><b>{person(selected.from[0])}</b><small>{selected.from[0]?.address}{selected.to.length ? ` · đến ${selected.to.map(person).join(', ')}` : ''}</small></div><time>{selected.date ? new Date(selected.date).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</time><button className="wm-icon-btn" aria-label="Trả lời" onClick={() => replyTo(selected)}><Reply size={18} /></button></div>{selected.cc && <div className="wm-cc-line">CC: {selected.cc}</div>}<div className="wm-message-body">{selected.html ? <iframe title="Nội dung email" sandbox="" referrerPolicy="no-referrer" srcDoc={selected.html} /> : <pre>{selected.text || '(Thư không có nội dung văn bản)'}</pre>}</div>{selected.attachments.length > 0 && <div className="wm-attachments"><b>{selected.attachments.length} tệp đính kèm</b><div>{selected.attachments.map(file => <a key={`${file.filename}-${file.index}`} href={`${API}/messages/${selected.uid}/attachments/${file.index}?folder=${encodeURIComponent(selected.folder)}`}><Paperclip size={15} />{file.filename}<small>{formatBytes(file.size)}</small></a>)}</div></div>}<div className="wm-reply-actions"><button className="wm-reply-button" onClick={() => replyTo(selected)}><Reply size={17} /> Trả lời</button>{(selected.to.length > 1 || selected.ccAddresses.length > 0) && <button className="wm-reply-button" onClick={() => replyTo(selected, true)}><Reply size={17} /> Trả lời tất cả</button>}</div></article> : <><div className="wm-list-heading"><div><h1>{folderLabel(folders.find(item => item.path === folder) || { path: folder, name: folder, specialUse: null, messages: 0, unread: 0 })}</h1><p>{query ? `Kết quả tìm kiếm: “${query}”` : 'Thư của bạn, được đồng bộ tức thì'}</p></div><span className="wm-filter-context">{listFilter === 'unread' ? 'Chưa đọc' : listFilter === 'starred' ? 'Có gắn sao' : 'Tất cả thư'}</span></div><div className="wm-tabs"><button className={listFilter === 'all' ? 'active' : ''} onClick={() => {setPage(1);setListFilter('all');}}><Inbox size={17} /> Tất cả thư</button><button className={listFilter === 'unread' ? 'active' : ''} onClick={() => {setPage(1);setListFilter('unread');}}><MailOpen size={17} /> Chưa đọc</button><button className={listFilter === 'starred' ? 'active' : ''} onClick={() => {setPage(1);setListFilter('starred');}}><Star size={17} /> Có gắn sao</button></div><div className="wm-message-list">{busy && items.length === 0 ? <div className="wm-list-empty">Đang tải thư…</div> : visibleItems.length === 0 ? <div className="wm-empty"><div><Inbox size={31} /></div><h2>{query ? 'Không tìm thấy thư phù hợp' : listFilter !== 'all' ? 'Không có thư phù hợp' : 'Hộp thư đang trống'}</h2><p>{query ? 'Thử tìm bằng tên người gửi hoặc tiêu đề khác.' : listFilter !== 'all' ? 'Chọn bộ lọc khác để xem thư.' : 'Khi có thư mới, thư sẽ xuất hiện tại đây.'}</p></div> : visibleItems.map(item => <div className={`wm-message-row ${item.seen ? '' : 'unread'} ${selectedUids.has(item.uid) ? 'wm-row-selected' : ''}`} key={`${folder}-${item.uid}`} onClick={() => void openMessage(item)} onKeyDown={event => { if (event.key === 'Enter') void openMessage(item); }} role="button" tabIndex={0}><button className="wm-select-btn" aria-label={selectedUids.has(item.uid) ? 'Bỏ chọn thư' : 'Chọn thư'} onClick={event => { event.stopPropagation(); setSelectedUids(current => { const next = new Set(current); if (next.has(item.uid)) next.delete(item.uid); else next.add(item.uid); return next; }); }}>{selectedUids.has(item.uid) ? <CheckSquare size={17} /> : <Square size={17} />}</button><button className="wm-star-btn" aria-label={item.flagged ? 'Bỏ đánh dấu sao' : 'Đánh dấu sao'} onClick={event => { event.stopPropagation(); void updateFlag(item, item.flagged ? 'unflagged' : 'flagged'); }}><Star size={17} fill={item.flagged ? 'currentColor' : 'none'} /></button><span className="wm-sender-name">{person(item.from[0])}</span><span className="wm-subject-line"><b>{item.subject}</b><span className="wm-preview"> — {item.to.length ? `Đến ${item.to.map(person).join(', ')}` : 'Thư điện tử'}{item.size ? ` · ${formatBytes(item.size)}` : ''}</span></span><time>{shortDate(item.date)}</time></div>)}</div></>}
        </section>
      </main>
    </div>
    {compose && <div className="wm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCompose(null); }}><form className="wm-compose-window" onSubmit={sendMessage}><div className="wm-compose-title"><b>Thư mới</b><button type="button" aria-label="Đóng" onClick={() => setCompose(null)}><X size={18} /></button></div><label className="wm-compose-field"><span>Đến</span><input required value={compose.to} onChange={event => setCompose({ ...compose, to: event.target.value })} placeholder="Địa chỉ email, cách nhau bằng dấu phẩy" /><button type="button" onClick={() => setShowCc(!showCc)}>CC</button></label>{showCc && <label className="wm-compose-field"><span>CC</span><input value={compose.cc} onChange={event => setCompose({ ...compose, cc: event.target.value })} placeholder="Thêm người nhận CC" /></label>}<label className="wm-compose-field"><span>Chủ đề</span><input value={compose.subject} onChange={event => setCompose({ ...compose, subject: event.target.value })} placeholder="Thêm chủ đề" /></label><textarea className="wm-compose-body" autoFocus value={compose.text} onChange={event => setCompose({ ...compose, text: event.target.value })} placeholder="Soạn nội dung thư…" />{compose.files.length > 0 && <div className="wm-compose-files">{compose.files.map((file,index) => <span key={`${file.name}-${index}`}><Paperclip size={14} />{file.name}<small>{formatBytes(file.size)}</small><button type="button" aria-label={`Bỏ tệp ${file.name}`} onClick={() => setCompose(current => current ? { ...current, files: current.files.filter((_,position) => position !== index) } : null)}><X size={14} /></button></span>)}</div>}<div className="wm-compose-footer"><button className="wm-send-btn" disabled={busy}><Send size={16} />{busy ? 'Đang gửi…' : 'Gửi'}</button><input ref={fileInput} className="wm-file-input" type="file" multiple onChange={addFiles} /><button type="button" className="wm-icon-btn" aria-label="Đính kèm tệp" title="Đính kèm tệp (tối đa 5 tệp, 20 MB)" onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button><span>{account}</span></div></form></div>}
    <div className="wm-mobile-compose"><button onClick={() => setCompose({ to: '', cc: '', subject: '', text: '', files: [] })}><PenLine size={19} /></button></div>
  </div>;
}

