import {ForbiddenException,HttpException,HttpStatus,Injectable,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {createHash,createHmac,scryptSync,timingSafeEqual} from 'node:crypto';
import {DatabaseService} from './database.service';
type Session={sub:string;role:'super_admin'|'tenant_admin'|'mailbox_user';tenantId?:string;exp:number};
@Injectable()
export class AuthService {
 constructor(private readonly database:DatabaseService){}
 private readonly attempts=new Map<string,{count:number;resetAt:number}>();
 private readonly secret=process.env.CONTROL_PLANE_SESSION_SECRET||'';
 private readonly email=process.env.CONTROL_PLANE_ADMIN_EMAIL||'';
 private readonly password=process.env.CONTROL_PLANE_ADMIN_PASSWORD||'';
 private encode(value:string){return Buffer.from(value).toString('base64url');}
 private sign(body:string){return createHmac('sha256',this.secret).update(body).digest('base64url');}
 private digest(value:string){return createHash('sha256').update(value).digest();}
 private equal(left:string,right:string){return timingSafeEqual(this.digest(left),this.digest(right));}
 private checkLimit(keys:string[]){const now=Date.now();for(const [key,item] of this.attempts)if(item.resetAt<=now)this.attempts.delete(key);if(this.attempts.size>20000){for(const key of this.attempts.keys()){this.attempts.delete(key);if(this.attempts.size<=15000)break;}}for(const key of keys){const item=this.attempts.get(key);if(item&&item.count>=8&&item.resetAt>now)throw new HttpException('Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.',HttpStatus.TOO_MANY_REQUESTS);}}
 private recordFailure(keys:string[]){const now=Date.now();for(const key of keys){const item=this.attempts.get(key);this.attempts.set(key,{count:item&&item.resetAt>now?item.count+1:1,resetAt:item&&item.resetAt>now?item.resetAt:now+15*60*1000});}}
 private clearAttempts(keys:string[]){for(const key of keys)this.attempts.delete(key);}
 async login(emailInput:unknown,passwordInput:unknown,ip='unknown'){
  const email=typeof emailInput==='string'?emailInput.trim().toLowerCase():'';
  const password=typeof passwordInput==='string'?passwordInput:'';
  const keys=[`ip:${ip||'unknown'}`,`email:${email||'unknown'}`,`pair:${ip||'unknown'}:${email||'unknown'}`];
  this.checkLimit(keys);
  if(!email||email.length>320||!password||password.length>1024){this.recordFailure(keys);throw new UnauthorizedException('Thông tin đăng nhập không đúng');}
  await this.database.ensureSeed();
  if(this.secret&&this.email&&this.password&&this.equal(email,this.email.trim().toLowerCase())&&this.equal(password,this.password)){this.clearAttempts(keys);return this.issue({sub:this.email,role:'super_admin'});}
  const rows=await this.database.query<{email:string;role:'tenant_admin'|'mailbox_user';tenant_id:string;password_hash:string}>('select m.email,m.role,m.tenant_id::text as tenant_id,m.password_hash from tenant_members m join tenants t on t.id=m.tenant_id where lower(m.email)=lower($1) and m.status=\'active\' and t.status=\'active\' limit 1',[email]);
  const member=rows?.[0];
  if(!member||!member.password_hash||!this.verifyPassword(password,member.password_hash)){this.recordFailure(keys);throw new UnauthorizedException('Thông tin đăng nhập không đúng');}
  this.clearAttempts(keys);return this.issue({sub:member.email,role:member.role,tenantId:member.tenant_id});
 }
 private issue(input:Omit<Session,'exp'>){const session:Session={...input,exp:Date.now()+8*60*60*1000};const body=this.encode(JSON.stringify(session));return {accessToken:`${body}.${this.sign(body)}`,expiresAt:session.exp,user:{email:session.sub,role:session.role,tenantId:session.tenantId}};}
 private verifyPassword(password:string,encoded:string){try{const [prefix,salt,hash]=encoded.split('$');if(prefix!=='scrypt'||!salt||!hash||!/^[a-f0-9]{64}$/i.test(hash))return false;const derived=scryptSync(password,salt,32);const expected=Buffer.from(hash,'hex');return derived.length===expected.length&&timingSafeEqual(derived,expected);}catch{return false;}}
 requireSuperAdmin(header?:string){const session=this.verify(header);if(session.role!=='super_admin')throw new ForbiddenException('Chỉ Super Admin được thực hiện thao tác này');return session;}
 async verifyActive(header?:string){const session=this.verify(header);if(session.role==='super_admin')return session;let rows;try{rows=await this.database.query<{member_status:string;tenant_status:string}>('select m.status as member_status,t.status as tenant_status from tenant_members m join tenants t on t.id=m.tenant_id where lower(m.email)=lower($1) and m.tenant_id=$2::uuid limit 1',[session.sub,session.tenantId]);}catch{throw new ServiceUnavailableException('Không thể kiểm tra trạng thái tài khoản. Vui lòng thử lại sau.');}const row=rows?.[0];if(!row||row.member_status!=='active'||row.tenant_status!=='active')throw new UnauthorizedException('Tài khoản đã bị khóa hoặc tenant không còn hoạt động. Vui lòng đăng nhập lại sau khi được mở khóa.');return session;}
 verify(header?:string){if(!header?.startsWith('Bearer ')) throw new UnauthorizedException('Cần đăng nhập');const token=header.slice(7);if(token.length>4096||!this.secret)throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');const parts=token.split('.');if(parts.length!==2||!parts[0]||!parts[1])throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');const [body,signature]=parts;const expected=this.sign(body);if(!this.equal(expected,signature))throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');try{const session=JSON.parse(Buffer.from(body,'base64url').toString()) as Session;if(!session||typeof session.sub!=='string'||!session.sub||!['super_admin','tenant_admin','mailbox_user'].includes(session.role)||!Number.isFinite(session.exp)||session.exp<=Date.now()||(session.role!=='super_admin'&&(typeof session.tenantId!=='string'||!session.tenantId)))throw new Error('invalid');return session;}catch{throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');}}
}
