import {useEffect, useRef, useState} from "react";
import {ArrowUpRight, Building2, Globe2, Mail, Plus, RefreshCw, Search, X} from "lucide-react";
import {useCustomer} from "./CustomerContext";
import {CustomerWorkspace} from "./ProductPanels";
import TenantCreateForm from "./TenantCreateForm";
import type {OverviewTenant} from "./OverviewPanel";
import "./customers-panel.css";

type Customer = OverviewTenant & {slug:string; domains:string[]};
type Props = {
  customers:Customer[];
  loading:boolean;
  failed:boolean;
  canCreate:boolean;
  onRefresh:()=>void;
  onContactSaved:(id:string,name:string)=>void;
  onNavigate:(page:string)=>void;
};

function searchText(value:string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g,"d");
}

function customerStatus(customer:Customer) {
  if (!customer.domainCount) return {text:"Chưa có tên miền", tone:"neutral"};
  if (customer.disconnectedDomains || customer.mailboxIssues) return {text:"Cần kiểm tra", tone:"warning"};
  if (customer.verifiedDomains < customer.domainCount) return {text:"Chờ xác minh", tone:"warning"};
  if (customer.pendingMailboxes) return {text:"Đang cấp phát", tone:"neutral"};
  if (!customer.mailboxes) return {text:"Chưa có hộp thư", tone:"neutral"};
  return {text:"Đã kết nối email", tone:"good"};
}

export default function CustomersPanel({customers,loading,failed,canCreate,onRefresh,onContactSaved,onNavigate}:Props) {
  const context = useCustomer();
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("all");
  const [profileId,setProfileId] = useState("");
  const [creating,setCreating] = useState(false);
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const list = [...customers].reverse().map(customer => ({
    ...customer,
    state:customerStatus(customer),
  }));
  const profile = list.find(customer=>customer.id===profileId);
  const openProfileId = !loading&&!failed ? profile?.id : undefined;
  useEffect(()=>{ if(openProfileId) profileHeading.current?.focus(); },[openProfileId]);
  const keyword = searchText(query.trim());
  const shown = list.filter(customer =>
    (filter==="all" || customer.state.text===filter) &&
    searchText([customer.name,customer.slug,...customer.domains].join(" ")).includes(keyword),
  );

  function openCustomer(id:string, page?:string) {
    context.selectTenant(id);
    if (page) onNavigate(page);
    else { setCreating(false);setProfileId(id); }
  }

  return <div className="customerDirectory">
    <section className="customerHero" aria-labelledby="customer-directory-title">
      <div>
        <span className="overviewEyebrow">30NICE MAIL CLOUD</span>
        <h1 id="customer-directory-title">Khách hàng</h1>
        <p>Tra cứu doanh nghiệp, cập nhật hồ sơ và quản lý dịch vụ email.</p>
      </div>
      <div className="customerActions">
        <button type="button" className="overviewRefresh" onClick={onRefresh} disabled={loading}><RefreshCw size={16}/> Làm mới</button>
        {canCreate&&<button type="button" className="primary" onClick={()=>{setProfileId("");setCreating(!creating);}} aria-expanded={creating}><Plus size={17}/> Thêm khách hàng</button>}
      </div>
    </section>

    {creating&&canCreate&&<section className="customerSurface" aria-label="Thêm khách hàng">
      <div className="customerSectionHead"><h2>Thêm khách hàng</h2><button type="button" className="ghost" onClick={()=>setCreating(false)} aria-label="Đóng biểu mẫu"><X size={16}/></button></div>
      <TenantCreateForm onCreated={customer=>{
        openCustomer(customer.id);
        setQuery("");
        setFilter("all");
        onRefresh();
      }}/>
    </section>}

    {!loading&&!failed&&profile&&<section className="customerSurface" aria-label="Hồ sơ khách hàng">
      <div className="customerSectionHead">
        <h2 ref={profileHeading} tabIndex={-1}>{profile.name}</h2>
        <button type="button" className="ghost" onClick={()=>setProfileId("")} aria-label="Đóng hồ sơ"><X size={16}/></button>
      </div>
      <CustomerWorkspace key={profile.id} fixedTenantId={profile.id} onContactSaved={name=>onContactSaved(profile.id,name)}/>
    </section>}

    <section className="customerSurface" aria-label="Danh sách khách hàng" aria-busy={loading}>
      <div className="customerSectionHead">
        <h2>Danh sách doanh nghiệp</h2>
        {!loading&&!failed&&<span className="overviewBadge">{shown.length}/{list.length} khách hàng</span>}
      </div>
      <div className="customerSearchBar">
        <label><span>Tìm kiếm</span><span className="customerSearchField"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Tên doanh nghiệp, mã hoặc tên miền"/></span></label>
        <label>Trạng thái email
          <select aria-label="Trạng thái email" value={filter} onChange={event=>setFilter(event.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            {["Đã kết nối email","Chờ xác minh","Cần kiểm tra","Đang cấp phát","Chưa có tên miền","Chưa có hộp thư"].map(state=><option key={state}>{state}</option>)}
          </select>
        </label>
      </div>
      {loading?<p role="status">Đang tải danh sách khách hàng…</p>:failed?<p role="alert">Chưa tải được danh sách. Bấm Làm mới để thử lại.</p>:shown.length===0?<p>{list.length?"Không tìm thấy khách hàng phù hợp.":"Chưa có khách hàng trong phạm vi quản lý."}</p>:<div className="customerGrid">
        {shown.map(customer=><article className="customerCard" key={customer.id} data-selected={profileId===customer.id}>
          <div className="customerCardHeading">
            <span className="overviewIcon"><Building2 size={18}/></span>
            <h3>{customer.name}</h3>
            <span className="overviewBadge" data-tone={customer.state.tone}>{customer.state.text}</span>
          </div>
          <ul className="customerDomains" aria-label="Tên miền">
            {customer.domains.slice(0,2).map(domain=><li key={domain}>{domain}</li>)}
            {!customer.domainCount&&<li>Chưa có tên miền</li>}
            {customer.domainCount>2&&<li>+{customer.domainCount-2} tên miền</li>}
          </ul>
          <div className="customerActions">
            <button type="button" className="ghost" onClick={()=>openCustomer(customer.id,"Tên miền")}><Globe2 size={15}/> {customer.domainCount} tên miền</button>
            <button type="button" className="ghost" onClick={()=>openCustomer(customer.id,"Hộp thư")}><Mail size={15}/> {customer.mailboxes} hộp thư</button>
            <button type="button" className="primary" onClick={()=>openCustomer(customer.id)} aria-expanded={profileId===customer.id}>Hồ sơ <ArrowUpRight size={15}/></button>
          </div>
        </article>)}
      </div>}
    </section>

  </div>;
}
