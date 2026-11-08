import { Activity, ArrowUpRight, Building2, CheckCircle2, CircleAlert, Clock3, Database, Globe2, Mail, RefreshCw, Server, WandSparkles } from "lucide-react";
import "./overview-panel.css";

export type OverviewTenant = {
  id: string;
  name: string;
  domain?: string;
  mailboxes: number;
  status: string;
  domainCount: number;
  verifiedDomains: number;
  disconnectedDomains: number;
  mailboxIssues: number;
  pendingMailboxes: number;
};

type Props = {
  tenants: OverviewTenant[];
  tenantLoading: boolean;
  tenantError: boolean;
  healthLoading: boolean;
  apiOnline?: boolean;
  databaseOnline?: boolean;
  mailOnline?: boolean;
  ready: boolean;
  checkedAt: Date | null;
  version?: string;
  isSystemAdmin: boolean;
  onNavigate: (page: string) => void;
  onRefresh: () => void;
};

export default function OverviewPanel(props: Props) {
  const { tenants, tenantLoading, tenantError, healthLoading, ready, onNavigate } = props;
  const hasInventory = !tenantLoading && !tenantError;
  const counts = tenants.reduce((total, tenant) => ({
    domains: total.domains + tenant.domainCount,
    verified: total.verified + tenant.verifiedDomains,
    disconnected: total.disconnected + tenant.disconnectedDomains,
    mailboxes: total.mailboxes + tenant.mailboxes,
    issues: total.issues + tenant.mailboxIssues,
    pending: total.pending + tenant.pendingMailboxes,
  }), { domains: 0, verified: 0, disconnected: 0, mailboxes: 0, issues: 0, pending: 0 });
  const awaitingVerification = counts.domains - counts.verified;
  const metrics = [
    { label: "Khách hàng", value: tenants.length, hint: "Trong phạm vi quản lý", icon: Building2 },
    { label: "Tên miền", value: counts.domains, hint: counts.verified + " đã xác minh", icon: Globe2 },
    { label: "Hộp thư", value: counts.mailboxes, hint: counts.pending + " đang cấp phát", icon: Mail },
  ];
  const actions = [
    { label: "Tên miền chờ xác minh", hint: "Kiểm tra bản ghi xác minh quyền sở hữu.", value: awaitingVerification, page: "Tên miền" },
    { label: "Tên miền chờ kết nối", hint: "Kiểm tra trạng thái kết nối dịch vụ email.", value: counts.disconnected, page: "Tên miền" },
    { label: "Hộp thư cần kiểm tra", hint: "Xem lỗi cấp phát hoặc chênh lệch cần đối soát.", value: counts.issues, page: "Hộp thư" },
  ].filter(action => action.value > 0);
  const services = [
    { label: "API quản trị", online: props.apiOnline, icon: Activity },
    { label: "Cơ sở dữ liệu", online: props.databaseOnline, icon: Database },
    { label: "Dịch vụ email", online: props.mailOnline, icon: Server },
  ];
  return (
    <div className="mailOverview">
      <section className="overviewHero" aria-labelledby="overview-title">
        <div>
          <span className="overviewEyebrow">30NICE MAIL CLOUD</span>
          <h1 id="overview-title">Tổng quan vận hành</h1>
          <p>Theo dõi khách hàng, tên miền và hộp thư từ một nơi.</p>
        </div>
        <div className="overviewHeroActions">
          <button type="button" className="overviewRefresh" onClick={props.onRefresh} disabled={healthLoading || tenantLoading}>
            <RefreshCw size={16}/> Làm mới
          </button>
          <button type="button" className="primary" onClick={() => onNavigate("Thiết lập khách hàng")}>
            <WandSparkles size={16}/> Thiết lập khách hàng
          </button>
        </div>
      </section>

      <section className="overviewMetrics" aria-label="Số liệu dịch vụ" aria-busy={tenantLoading}>
        {metrics.map(({label, value, hint, icon: Icon}) => (
          <button key={label} type="button" className="overviewMetric" onClick={() => onNavigate(label)}>
            <span className="overviewIcon"><Icon size={20}/></span>
            <span>{label}</span>
            <strong>{hasInventory ? value.toLocaleString("vi-VN") : "—"}</strong>
            <small>{hasInventory ? hint : tenantLoading ? "Đang tải dữ liệu" : "Chưa tải được dữ liệu"}</small>
            <ArrowUpRight size={16} className="overviewMetricArrow"/>
          </button>
        ))}
      </section>

      <div className="overviewColumns">
        <section className="overviewCard">
          <div className="overviewCardTitle"><h2>Việc cần xử lý</h2><CircleAlert size={18}/></div>
          {tenantLoading ? <p role="status">Đang tổng hợp dữ liệu…</p> : tenantError ?
            <p role="alert">Chưa tải được danh sách. Bấm Làm mới để thử lại.</p> :
            actions.length ? actions.map(action => (
              <button type="button" className="overviewTask" key={action.label} onClick={() => onNavigate(action.page)}>
                <span className="overviewTaskCount">{action.value}</span>
                <span><b>{action.label}</b><small>{action.hint}</small></span>
                <ArrowUpRight size={16}/>
              </button>
            )) : <p className="overviewClear"><CheckCircle2 size={18}/> Chưa có tên miền hoặc hộp thư cần xử lý.</p>}
          {hasInventory && counts.domains > 0 && <div className="overviewProgress">
            <div><span>Tiến độ xác minh tên miền</span><b>{counts.verified}/{counts.domains}</b></div>
            <progress aria-label="Tên miền đã xác minh" value={counts.verified} max={counts.domains}/>
          </div>}
        </section>

        <section className="overviewCard">
          <div className="overviewCardTitle">
            <h2>Tình trạng hệ thống</h2>
            <span className="overviewBadge" data-tone={healthLoading ? "neutral" : ready ? "good" : "warning"}>
              {healthLoading ? "Đang kiểm tra" : ready ? "Sẵn sàng" : "Cần kiểm tra"}
            </span>
          </div>
          {services.map(({label, online, icon: Icon}) => (
            <div className="overviewService" key={label}>
              <Icon size={17}/><b>{label}</b>
              <span className="overviewBadge" data-tone={online === true ? "good" : online === false ? "warning" : "neutral"}>
                {online === true ? "Đang hoạt động" : online === false ? "Mất kết nối" : "Chưa xác nhận"}
              </span>
            </div>
          ))}
          <div className="overviewMeta">
            <Clock3 size={15}/>
            <span>{props.checkedAt ? `Kiểm tra thành công lúc ${props.checkedAt.toLocaleTimeString("vi-VN")}` : "Đang chờ kết quả kiểm tra"}</span>
            {props.version && <span>v{props.version}</span>}
          </div>
          {props.isSystemAdmin && <button type="button" className="ghost overviewLink" onClick={() => onNavigate("Máy chủ")}>Chi tiết vận hành <ArrowUpRight size={15}/></button>}
        </section>
      </div>
    </div>
  );
}
