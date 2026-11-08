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
  ArrowUpRight,
  AlertTriangle,
  ChevronDown,
  WandSparkles,
} from "lucide-react";
import DomainWizard from "./DomainWizard";
import AuthGate from "./AuthGate";
import {CustomerProvider,useCustomer} from './CustomerContext';
import {CustomerWorkspace,ServicePlans,OperationsPanel,SecurityPanel} from './ProductPanels';
import DnsHealthPanel from "./DnsHealthPanel";
import MemberPanel from "./MemberPanel";
import MailboxPanel from "./MailboxPanel";
import AliasPanel from "./AliasPanel";
import OnboardingPanel from "./OnboardingPanel";
import OverviewPanel, {type OverviewTenant} from "./OverviewPanel";
import CustomersPanel from "./CustomersPanel";
type Tenant = OverviewTenant & {
  id: string;
  name: string;
  slug: string;
  domains: string[];
  created_at?: string;
};
type HealthSnapshot = { productionReady?: boolean; environment?: string; database?: { configured?: boolean; connected?: boolean }; mailcow?: { mode?: string; configured?: boolean; healthy?: boolean; httpStatus?: number } };
type ApiInfo = { version?: string };
const tenants: Tenant[] = [];
const menus = [
  { label: "Tổng quan", icon: LayoutDashboard },
  { label: "Khách hàng", icon: Building2 },
  { label: "Thiết lập khách hàng", icon: WandSparkles },
  { label: "Tên miền", icon: Globe2 },
  { label: "Hộp thư", icon: Mail },
  { label: "Bí danh", icon: Mail },
  { label: "Thành viên", icon: Building2 },
  { label: "Gói dịch vụ", icon: ReceiptText },
  { label: "Máy chủ", icon: Server },
  { label: "Bảo mật", icon: ShieldCheck },
  { label: "Cài đặt", icon: Settings },
];
function Dashboard() {
  const customer=useCustomer();
  const [viewer,setViewer]=useState<{email:string;role:string}|null>(null);
  useEffect(()=>{let live=true;fetch('/api/api/v1/auth/me').then(r=>r.ok?r.json():null).then(d=>{if(live)setViewer(d);}).catch(()=>{if(live)setViewer(null);});return()=>{live=false;};},[]);
  const [active, setActive] = useState("Tổng quan");
  const [data, setData] = useState<Tenant[]>(tenants);
  const [tenantRefresh, setTenantRefresh] = useState(0);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState(false);
  const [healthCheckedAt, setHealthCheckedAt] = useState<Date | null>(null);
  const [healthRefresh, setHealthRefresh] = useState(0);
  const [tenantLoadError, setTenantLoadError] = useState(false);
  const [tenantLoading, setTenantLoading] = useState(true);
  useEffect(() => {
    if (active !== "Tổng quan" && active !== "Khách hàng") return;
    const controller = new AbortController();
    setTenantLoading(true);
    fetch("/api/api/v1/tenants", { signal: controller.signal })
      .then((r) => r.json())
      .then(async (items) => {
        if (!Array.isArray(items)) throw new Error("Invalid tenant response");
        const enriched = await Promise.all(
          items.map(async (t: Tenant) => {
            const [domainResponse, mailboxResponse] = await Promise.all([
              fetch(`/api/api/v1/tenants/${t.id}/domains`, { signal: controller.signal }),
              fetch(`/api/api/v1/tenants/${t.id}/mailboxes`, { signal: controller.signal }),
            ]);
            if (!domainResponse.ok || !mailboxResponse.ok) throw new Error("Tenant details unavailable");
            const [domains, mailboxes] = await Promise.all([domainResponse.json(), mailboxResponse.json()]);
            if (!Array.isArray(domains) || !Array.isArray(mailboxes)) throw new Error("Invalid tenant details");
            return {
              ...t,
              domain: domains[0]?.domain ?? "Chưa có tên miền",
              mailboxes: mailboxes.length,
              domainCount: domains.length,
              domains: domains.map(item => item.domain as string),
              verifiedDomains: domains.filter(domain => domain.status === "verified").length,
              disconnectedDomains: domains.filter(domain => domain.status === "verified" && domain.provisioningStatus !== "ready").length,
              mailboxIssues: mailboxes.filter(box => ["failed", "reconcile"].includes(box.provisioningState)).length,
              pendingMailboxes: mailboxes.filter(box => box.provisioningState === "pending").length,
              status: domains[0]?.status === "verified" ? "Đã xác minh" : "Chờ xác minh",
            };
          }),
        );
        if (controller.signal.aborted) return;
        setData(enriched);
        setTenantLoadError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setTenantLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setTenantLoading(false); });
    return () => controller.abort();
  }, [active, tenantRefresh]);
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
            <small>{viewer?.role==='super_admin'?'Quản trị hệ thống':'Quản trị doanh nghiệp'}</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="menucap">WORKSPACE</div>
        <nav>
          {menus.filter(item=>!['Gói dịch vụ','Máy chủ'].includes(item.label)||viewer?.role==='super_admin').map(({ label, icon: Icon }) => (
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
            <span className="statusdot" style={{ background: healthLoading ? "#98a2b3" : controlPlaneReady ? "#12b76a" : "#d92d20" }} /> {healthLoading ? "ĐANG KIỂM TRA HẠ TẦNG" : controlPlaneReady ? "HẠ TẦNG ĐANG HOẠT ĐỘNG" : "CẦN KIỂM TRA HẠ TẦNG"}
          </div>
          <p>Database: PostgreSQL</p>
          <p>Mail Adapter: Mailcow</p>
        </div>
        <div className="sidebarfoot">
          <span className="avatar user">PT</span>
          <div>
            <b>Administrator</b>
            <small>Điều hành dịch vụ</small>
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
          {active !== "Tổng quan" && active !== "Khách hàng" && (
          <div className="pagetop">
            <div>
              <div className="eyebrow">
                MAIL HOSTING PLATFORM <span>·</span> VERSION {apiInfo?.version || "—"}
              </div>
              <h1>{active}</h1>
              <p>
                Dữ liệu đang đọc trực tiếp từ API và PostgreSQL.
              </p>
            </div>
            <button className="primary" onClick={() => setActive("Khách hàng")}>
              <Plus size={16} /> Quản lý khách hàng
            </button>
          </div>
          )}
          {active === "Tổng quan" ? (
            <>
            <OverviewPanel
              tenants={data}
              tenantLoading={tenantLoading}
              tenantError={tenantLoadError}
              healthLoading={healthLoading}
              apiOnline={healthError ? false : health ? true : undefined}
              databaseOnline={databaseOnline}
              mailOnline={mailBackendOnline}
              ready={controlPlaneReady}
              checkedAt={healthCheckedAt}
              version={apiInfo?.version}
              isSystemAdmin={viewer?.role === "super_admin"}
              onNavigate={setActive}
              onRefresh={() => {
                setHealthLoading(true);
                setHealthRefresh(value => value + 1);
                setTenantRefresh(value => value + 1);
              }}
            />
            {!tenantLoading && !tenantLoadError && data.length > 0 && <section className="panel overviewRecent">
              <div className="sectionTitle">
                <div><h2>Khách hàng gần đây</h2><p>Tối đa 5 khách hàng được thêm gần nhất</p></div>
                <button className="ghost" onClick={() => setActive("Khách hàng")}>Xem danh sách <ArrowUpRight size={15}/></button>
              </div>
              <CustomerTable data={data.slice(-5).reverse()} />
            </section>}
            </>
          ) : active === "Khách hàng" ? (
            <CustomersPanel
              customers={data}
              loading={tenantLoading}
              failed={tenantLoadError}
              canCreate={viewer?.role === "super_admin"}
              onContactSaved={(id,name) => setData(current => current.map(item => item.id === id ? {...item,name} : item))}
              onRefresh={() => setTenantRefresh(value => value + 1)}
              onNavigate={setActive}
            />
          ) : (
            <section className="panel">
              <div className="sectionTitle">
                <div>
                  <h2>{active}</h2>
                  <p>Quản lý dịch vụ email doanh nghiệp</p>
                </div>
                <span className="label ok">Dịch vụ email</span>
              </div>
              {active === "Thiết lập khách hàng" ? (
                <OnboardingPanel />
              ) : active === "Tên miền" ? (
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
              ) : active === "Gói dịch vụ" ? (<ServicePlans />) : active === "Máy chủ" ? (<OperationsPanel />) : active === "Bảo mật" ? (<SecurityPanel />) : active === "Cài đặt" ? (<CustomerWorkspace />) : (
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
          {`30NICE MAIL CLOUD · ${healthError ? "API KHÔNG KẾT NỐI" : controlPlaneReady ? "HẠ TẦNG ĐANG HOẠT ĐỘNG" : "CẦN KIỂM TRA"} · MAILCOW ${serviceText(mailBackendOnline).toUpperCase()}`}
          </footer>
        </div>
      </main>
    </div>
  );
}
export default function Home() {
  return (
    <AuthGate>
      <CustomerProvider><Dashboard /></CustomerProvider>
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
            <th>HỘP THƯ</th>
            <th>TRẠNG THÁI</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, i) => (
            <tr key={t.id}>
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
