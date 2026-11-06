import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {DatabaseService} from './database.service';
type Query=Parameters<Parameters<DatabaseService['transaction']>[0]>[0];
function emailValue(input:unknown){const email=typeof input==='string'?input.trim().toLowerCase():'';if(!email||email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BadRequestException('Nhập địa chỉ email hợp lệ.');return email;}
function passwordHash(input:unknown){if(typeof input!=='string'||input.length<12||input.length>256)throw new BadRequestException('Mật khẩu phải từ 12 đến 256 ký tự.');const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${scryptSync(input,salt,32).toString('hex')}`;}
function tokenHash(input:unknown){if(typeof input!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input))throw new BadRequestException('Liên kết mời không hợp lệ hoặc đã hết hạn.');return createHash('sha256').update(input).digest('hex');}
export class MemberInvitations{
 constructor(private db:DatabaseService){}
 private async tx<T extends Record<string,unknown>>(fn:(q:Query)=>Promise<T[]>){const result=await this.db.transaction(fn);if(!result)throw new ServiceUnavailableException('Chưa kết nối được cơ sở dữ liệu.');return result;}
 private async available(q:Query,email:string){await q('select pg_advisory_xact_lock(hashtextextended($1,0))',[`identity:${email}`]);
  const system=[process.env.CONTROL_PLANE_ADMIN_EMAIL?.trim().toLowerCase()];try{for(const a of JSON.parse(process.env.CONTROL_PLANE_ADDITIONAL_ADMINS_JSON||'[]'))system.push(a.email?.trim().toLowerCase());}catch{throw new ServiceUnavailableException('Chưa kiểm tra được thông tin định danh.');}
  if(system.includes(email)||(await q('select id from tenant_members where lower(email)=lower($1)',[email])).length)throw new BadRequestException('Email này đã có tài khoản. Hãy dùng email quản trị khác hoặc liên hệ hỗ trợ.');
 }
 async createMember(tenant:string,body:{email?:unknown;password?:unknown;role?:unknown}={},actor='system'){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Thông tin thành viên không hợp lệ.');
  if(body.role!==undefined&&!['tenant_admin','mailbox_user'].includes(String(body.role)))throw new BadRequestException('Vai trò thành viên không hợp lệ.');const email=emailValue(body.email),hash=passwordHash(body.password);
  return (await this.tx(async q=>{await this.available(q,email);const member=await q("insert into tenant_members(tenant_id,email,password_hash,role) values($1::uuid,$2,$3,$4) returning id::text,email,role,status",[tenant,email,hash,body.role??'tenant_admin']);await q("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,'member.create','member',$3)",[tenant,actor,member[0].id]);return member;}))[0];
 }
 async invite(tenant:string,input:unknown,actor:string){const email=emailValue(input),token=randomBytes(32).toString('base64url');
  const row=(await this.tx(async q=>{await this.available(q,email);await q('update member_invitations set revoked_at=now() where tenant_id=$1::uuid and email=$2 and used_at is null and revoked_at is null',[tenant,email]);const result=await q('insert into member_invitations(tenant_id,email,token_hash,invited_by,expires_at) values($1::uuid,$2,$3,$4,now()+interval \'48 hours\') returning id::text,email,expires_at as "expiresAt"',[tenant,email,tokenHash(token),actor]);await q("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,'member.invite','invitation',$3)",[tenant,actor,result[0].id]);return result;}))[0];
  return {...row,activationUrl:`https://admin.30nice.vn/activate#${token}`};
 }
 async list(tenant:string){return await this.db.query("select id::text,email,expires_at as \"expiresAt\",case when used_at is not null then 'accepted' when revoked_at is not null then 'revoked' when expires_at<=now() then 'expired' else 'pending' end as status from member_invitations where tenant_id=$1::uuid order by created_at desc limit 50",[tenant])??[];}
 async revoke(tenant:string,id:string,actor:string){await this.db.query('update member_invitations set revoked_at=now() where id=$1::uuid and tenant_id=$2::uuid and used_at is null',[id,tenant]);await this.db.query("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,'member.invite_revoke','invitation',$3)",[tenant,actor,id]);return {ok:true};}
 async info(input:unknown){const rows=await this.db.query("select i.email,t.name as company,i.expires_at as \"expiresAt\" from member_invitations i join tenants t on t.id=i.tenant_id where i.token_hash=$1 and i.used_at is null and i.revoked_at is null and i.expires_at>now() and t.status='active'",[tokenHash(input)]);if(!rows?.[0])throw new BadRequestException('Liên kết mời không hợp lệ hoặc đã hết hạn.');return rows[0];}
 async accept(input:unknown,password:unknown){const hash=tokenHash(input);
  await this.tx(async q=>{const preview=(await q<{email:string}>('select email from member_invitations where token_hash=$1',[hash]))[0];if(!preview)throw new BadRequestException('Liên kết mời không hợp lệ hoặc đã hết hạn.');await this.available(q,preview.email);
   const invitation=(await q<{id:string;tenant_id:string;email:string;invited_by:string}>("select i.* from member_invitations i join tenants t on t.id=i.tenant_id where i.token_hash=$1 and i.used_at is null and i.revoked_at is null and i.expires_at>now() and t.status='active' for update of i",[hash]))[0];if(!invitation)throw new BadRequestException('Liên kết mời không hợp lệ hoặc đã hết hạn.');
   await q("insert into tenant_members(tenant_id,email,password_hash,role) values($1::uuid,$2,$3,'tenant_admin')",[invitation.tenant_id,invitation.email,passwordHash(password)]);await q('update member_invitations set used_at=now() where token_hash=$1',[hash]);await q("insert into audit_logs(tenant_id,actor_email,action,resource_type,resource_id) values($1::uuid,$2,'member.invite_accept','invitation',$3)",[invitation.tenant_id,invitation.email,invitation.id]);return [];
  });return {ok:true};
 }
}
