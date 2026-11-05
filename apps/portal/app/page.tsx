"use client";
import { useEffect, useState } from "react";
import {
  Mail,
  LayoutDashboard,
  Building2,
  Globe2,
  ReceiptText,
  Settings,
  ShieldCheck,
  Server,
  Plus,
  Search,
  ArrowUpRight,
  RefreshCw,
  Clock3,
  AlertTriangle,
  ChevronDown,
  Copy,
  ExternalLink,
  WandSparkles,
} from "lucide-react";
import DomainWizard from "./DomainWizard";
import AuthGate from "./AuthGate";
import TenantCreateForm from "./TenantCreateForm";
import DnsHealthPanel from "./DnsHealthPanel";
import MemberPanel from "./MemberPanel";
import MailboxPanel from "./MailboxPanel";
import AliasPanel from "./AliasPanel";
type Tenant = {
  id: string;
  name: string;
  slug: string;
  created_at?: string;
  domain?: string;
  mailboxes: number;
  status: string;
};
type HealthSnapshot = { productionReady?: boolean; environment?: string; database?: { configured?: boolean; connected?: boolean }; mailcow?: { mode?: string; configured?: boolean; healthy?: boolean; httpStatus?: number } };
type ApiInfo = { version?: string };
const tenants: Tenant[] = [];
const menus = [
  { label: "Tổng quan", icon: LayoutDashboard },
  { label: "Khách hàng", icon: Building2 },
  { label: "Tên miền", icon: Globe2 },
  { label: "Hộp thư", icon: Mail },
  { label: "Bí danh", icon: Mail },
  { label: "Thành viên", icon: Building2 },
  { label: "Gói dịch vụ", icon: ReceiptText },
  { label: "Máy chủ", icon: Server },
  { label: "Bảo mật", icon: ShieldCheck },
  { label: "Cài đặt", icon: Settings },
];
const dnsRecords = [
  {
    type: "MX",
    host: "@",
    value: "mx.30nice.vn",
    help: "Nhận thư đến cho tên miền",
  },
  {
    type: "TXT",
    host: "@",
    value: "v=spf1 mx a -all",
    help: "Xác thực máy chủ được phép gửi thư",
  },
  {
    type: "TXT",
    host: "dkim._domainkey",
    value: "Lấy mã DKIM riêng trong Mailcow",
    help: "Ký số cho email gửi đi",
  },
  {
    type: "TXT",
    host: "_dmarc",
    value: "v=DMARC1; p=quarantine; rua=mailto:admin@30nice.vn",
    help: "Bảo vệ tên miền khỏi giả mạo",
  },
];
function Dashboard() {
  const [active, setActive] = useState("Tổng quan");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Tất cả");
  const [data, setData] = useState<Tenant[]>(tenants);
  const [tenantRefresh, setTenantRefresh] = useState(0);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState(false);
  const [healthCheckedAt, setHealthCheckedAt] = useState<Date | null>(null);
  const [healthRefresh, setHealthRefresh] = useState(0);
  const [tenantLoadError, setTenantLoadError] = useState(false);
  useEffect(() => {
    fetch("/api/api/v1/tenants", { headers: { "x-role": "super_admin" } })
      .then((r) => r.json())
      .then(async (items) => {
        if (!Array.isArray(items)) throw new Error("Invalid tenant response");
        const enriched = await Promise.all(
          items.map(async (t: Tenant) => {
            const [domainResponse, mailboxResponse] = await Promise.all([
              fetch(`/api/api/v1/tenants/${t.id}/domains`, { headers: { "x-role": "super_admin" } }),
              fetch(`/api/api/v1/tenants/${t.id}/mailboxes`, { headers: { "x-role": "super_admin" } }),
            ]);
            if (!domainResponse.ok || !mailboxResponse.ok) throw new Error("Tenant details unavailable");
            const [domains, mailboxes] = await Promise.all([domainResponse.json(), mailboxResponse.json()]);
            if (!Array.isArray(domains) || !Array.isArray(mailboxes)) throw new Error("Invalid tenant details");
            return {
              ...t,
              domain: domains[0]?.domain ?? "Chưa có domain",
              mailboxes: mailboxes.length,
              status: domains[0]?.status === "verified" ? "Đã xác minh" : "Chờ xác minh",
            };
          }),
        );
        setData(enriched);
        setTenantLoadError(false);
      })
      .catch(() => { setData([]); setTenantLoadError(true); });
  }, [tenantRefresh]);
  useEffect(() => {
    let active = true;
    const refreshHealth = async () => {
      try {
        const [healthResponse, infoResponse] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/api/v1/info", { cache: "no-store" }),
        ]);
        if (!healthResponse.ok) throw new Error("Health endpoint unavailable");
        const snapshot = await healthResponse.json() as HealthSnapshot;
        const info = infoResponse.ok ? await infoResponse.json() as ApiInfo : null;
        if (!active) return;
        setHealth(snapshot);
        setHealthCheckedAt(new Date());
        setApiInfo(info);
        setHealthError(false);
      } catch {
        if (active) { setHealth(null); setApiInfo(null); setHealthError(true); }
      } finally {
        if (active) setHealthLoading(false);
      }
    };
    void refreshHealth();
    const timer = window.setInterval(() => { void refreshHealth(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [healthRefresh]);
  const databaseOnline = health?.database?.connected;
  const mailBackendOnline = health?.mailcow?.healthy;
  const controlPlaneReady = health?.productionReady === true && databaseOnline === true && mailBackendOnline === true;
  const serviceText = (online: boolean | undefined) => online === undefined ? (healthLoading ? "Đang kiểm tra" : "Chưa xác minh") : online ? "Đang hoạt động" : "Không kết nối";
  const serviceStyle = (online: boolean | undefined) => ({ color: online === true ? "#147d4a" : online === false ? "#b42318" : "#667085" });
  const shown = data.filter(
    (t) =>
      (filter === "Tất cả" || t.status === filter) &&
      `${t.name} ${t.domain}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <Mail size={22} />
          </div>
          <div>
            <b>
              30NICE <span>MAIL</span>
            </b>
            <small>CLOUD CONTROL</small>
          </div>
        </div>
        <div className="workspace">
          <span className="avatar">30</span>
          <div>
            <b>30 NICE</b>
            <small>Super Administrator</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="menucap">WORKSPACE</div>
        <nav>
          {menus.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              className={active === label ? "selected" : ""}
            >
              <Icon size={18} />
              {label}
              {label === "Hộp thư" && (
                <em>{data.reduce((n, t) => n + t.mailboxes, 0)}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidestatus">
          <div className="statusline">
            <span className="statusdot" style={{ background: healthLoading ? "#98a2b3" : controlPlaneReady ? "#12b76a" : "#d92d20" }} /> {healthLoading ? "ĐANG KIỂM TRA HẠ TẦNG" : controlPlaneReady ? "PRODUCTION · SẴN SÀNG" : "CẦN KIỂM TRA HẠ TẦNG"}
          </div>
          <p>Database: PostgreSQL</p>
          <p>Mail Adapter: Mailcow</p>
        </div>
        <div className="sidebarfoot">
          <span className="avatar user">PT</span>
          <div>
            <b>Administrator</b>
            <small>Production control</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            30NICE Mail Cloud <span>/</span> {active}
          </div>
          <div className="headerRight">
            <span className="localpill" title={health?.environment || (healthError ? "Không đọc được trạng thái API" : "Đang xác minh")}>
              <span className="statusdot" style={{ background: healthLoading ? "#98a2b3" : controlPlaneReady ? "#12b76a" : "#d92d20" }} /> {healthLoading ? "ĐANG KIỂM TRA" : healthError ? "API KHÔNG KẾT NỐI" : controlPlaneReady ? "LIVE · SẴN SÀNG" : "CÓ CẢNH BÁO"}
            </span>
            <span className="avatar user">PT</span>
          </div>
        </header>
        <div className="content">
          <div className="pagetop">
            <div>
              <div className="eyebrow">
                MAIL HOSTING PLATFORM <span>·</span> VERSION {apiInfo?.version || "—"}
              </div>
              <h1>{active}</h1>
              <p>
                {active === "Tổng quan"
                  ? "Quản lý hạ tầng email hosting đa khách hàng tại một nơi."
                  : "Dữ liệu đang đọc trực tiếp từ API và PostgreSQL."}
              </p>
            </div>
            <button className="primary" onClick={() => setActive("Khách hàng")}>
              <Plus size={16} /> Quản lý khách hàng
            </button>
          </div>
          {active === "Tổng quan" ? (
            <>
              <section className="stats">
                <div className="metric">
                  <div className="metricTitle">
                    Khách hàng <Building2 size={19} />
                  </div>
                  <strong>{data.length}</strong>
                  <small>Dữ liệu PostgreSQL</small>
                </div>
                <div className="metric">
                  <div className="metricTitle">
                    Tên miền <Globe2 size={19} />
                  </div>
                  <strong>
                    {
                      data.filter(
                        (t) => t.domain && t.domain !== "Chưa có domain",
                      ).length
                    }
                  </strong>
                  <small>Đã đăng ký trong hệ thống</small>
                </div>
                <div className="metric">
                  <div className="metricTitle">
                    Hộp thư <Mail size={19} />
                  </div>
                  <strong>{data.reduce((n, t) => n + t.mailboxes, 0)}</strong>
                  <small>Provisioning database</small>
                </div>
                <div className="metric">
                  <div className="metricTitle">
                    Database <ReceiptText size={19} />
                  </div>
                  <strong className="label" style={serviceStyle(databaseOnline)}>{serviceText(databaseOnline).toUpperCase()}</strong>
                  <small>{healthError ? "Không đọc được API health" : healthLoading ? "Đang kiểm tra kết nối" : health?.database?.configured ? "PostgreSQL đã cấu hình" : "PostgreSQL chưa được cấu hình"}</small>
                </div>
              </section>
              <section className="twocol">
                <div className="panel stretch">
                  <div className="sectionTitle">
                    <div><h2>Tổng quan hạ tầng</h2><p>Kiểm tra trực tiếp từ API, tự làm mới mỗi 30 giây</p></div>
                    <span className="mutedpill">{healthLoading ? "ĐANG KIỂM TRA" : controlPlaneReady ? "SẴN SÀNG" : "CẦN KIỂM TRA"}</span>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><LayoutDashboard size={18} /></div>
                    <div><b>SaaS Control Plane</b><small>Portal + API</small></div>
                    <span className="label" style={serviceStyle(healthError ? false : health ? true : undefined)}>{healthError ? "Không kết nối" : serviceText(health ? true : undefined)}</span>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><ReceiptText size={18} /></div>
                    <div><b>Cơ sở dữ liệu</b><small>PostgreSQL</small></div>
                    <span className="label" style={serviceStyle(databaseOnline)}>{serviceText(databaseOnline)}</span>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><Server size={18} /></div>
                    <div><b>Mail Backend</b><small>{health?.mailcow?.mode === "production" ? "Mailcow production adapter" : "Mailcow adapter"}</small></div>
                    <span className="label" style={serviceStyle(mailBackendOnline)}>{serviceText(mailBackendOnline)}</span>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><ShieldCheck size={18} /></div>
                    <div><b>Kết nối portal</b><small>{typeof window !== "undefined" && window.location.protocol === "https:" ? "HTTPS" : "Chưa xác minh HTTPS"}</small></div>
                    <span className="label" style={serviceStyle(typeof window !== "undefined" && window.location.protocol === "https:")}>{typeof window !== "undefined" && window.location.protocol === "https:" ? "An toàn" : "Chưa an toàn"}</span>
                  </div>
                </div>
                <div className="panel stretch">
                  <div className="sectionTitle">
                    <div><h2>Thông tin phát hành</h2><p>Phiên bản và trạng thái hiện tại</p></div>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><Mail size={18} /></div>
                    <div><b>Phiên bản API</b><small>{apiInfo?.version ? `Release ${apiInfo.version}` : "Chưa đọc được thông tin phiên bản"}</small></div>
                    <span className="label">{apiInfo?.version || "—"}</span>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><ShieldCheck size={18} /></div>
                    <div><b>Sẵn sàng production</b><small>{health?.productionReady === true ? "API xác nhận adapter production" : healthError ? "Không đọc được trạng thái" : "API chưa xác nhận sẵn sàng"}</small></div>
                    <span className="label" style={serviceStyle(controlPlaneReady)}>{serviceText(controlPlaneReady)}</span>
                  </div>
                  <div className="systemRow">
                    <div className="systemIcon"><RefreshCw size={18} /></div>
                    <div><b>Lần kiểm tra gần nhất</b><small>{healthLoading ? "Đang kiểm tra" : healthError ? "Kiểm tra thất bại" : healthCheckedAt?.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) || "Chưa kiểm tra"}</small></div>
                    <button className="ghost" disabled={healthLoading} onClick={() => { setHealthLoading(true); setHealthRefresh(value => value + 1); }}>Kiểm tra lại</button>
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="sectionTitle">
                  <div>
                    <h2>Khách hàng</h2>
                    <p>Đọc trực tiếp từ tenant API</p>
                  </div>
                  <button
                    className="ghost"
                    onClick={() => setActive("Khách hàng")}
                  >
                    Xem chi tiết <ArrowUpRight size={15} />
                  </button>
                </div>
                {tenantLoadError && <div role="alert" className="empty"><AlertTriangle size={22} /><h3>Không tải được danh sách khách hàng</h3><p>Kiểm tra phiên đăng nhập hoặc kết nối API rồi tải lại trang.</p></div>}
                {!tenantLoadError && <CustomerTable data={shown} />}
              </section>
            </>
          ) : (
            <section className="panel">
              <div className="sectionTitle">
                <div>
                  <h2>{active}</h2>
                  <p>Dữ liệu backend production-safe</p>
                </div>
                <span className="label ok">API connected</span>
              </div>
              {active === "Tên miền" ? (
                <>
                  <DomainWizard />
                  <DnsHealthPanel />
                </>
              ) : active === "Bí danh" ? (
                <AliasPanel />
              ) : active === "Thành viên" ? (
                <MemberPanel />
              ) : active === "Hộp thư" ? (
                <MailboxPanel />
              ) : active === "Khách hàng" ? (
                <>
                  <TenantCreateForm onCreated={() => setTenantRefresh(value => value + 1)} />
                  <div className="tools">
                    <div className="search">
                      <Search size={16} />
                      <input
                        placeholder="Tìm khách hàng hoặc tên miền..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option>Tất cả</option>
                      <option>Đã xác minh</option>
                      <option>Chờ xác minh</option>
                    </select>
                  </div>
                  {tenantLoadError && <div role="alert" className="empty"><AlertTriangle size={22} /><h3>Không tải được danh sách khách hàng</h3><p>Kiểm tra phiên đăng nhập hoặc kết nối API rồi tải lại trang.</p></div>}
                  {!tenantLoadError && <CustomerTable data={shown} />}
                </>
              ) : (
                <div className="empty">
                  <AlertTriangle size={26} />
                  <h3>Module đang được nối dần vào backend</h3>
                  <p>
                    Tenant data đã live. Domain và mailbox actions sẽ được mở ở
                    sprint tiếp theo.
                  </p>
                </div>
              )}
            </section>
          )}
          <footer>
          {`30NICE MAIL CLOUD · ${healthError ? "API KHÔNG KẾT NỐI" : controlPlaneReady ? "PRODUCTION · SẴN SÀNG" : "CẦN KIỂM TRA"} · MAILCOW ${serviceText(mailBackendOnline).toUpperCase()}`}
          </footer>
        </div>
      </main>
    </div>
  );
}
export default function Home() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}
function CustomerTable({ data }: { data: typeof tenants }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>KHÁCH HÀNG</th>
            <th>TÊN MIỀN</th>
            <th>MAILBOX DEMO</th>
            <th>TRẠNG THÁI</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, i) => (
            <tr key={t.domain}>
              <td>
                <div className="customer">
                  <span className="customerIcon">
                    {i === 0 ? "30" : t.name.charAt(0)}
                  </span>
                  <b>{t.name}</b>
                </div>
              </td>
              <td>{t.domain}</td>
              <td>{t.mailboxes}</td>
              <td>
                <span
                  className={
                    "label " + (t.status === "Nội bộ" ? "ok" : "neutral")
                  }
                >
                  {t.status}
                </span>
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={4}>Không có kết quả</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
