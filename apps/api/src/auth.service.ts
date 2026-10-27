import {Injectable,UnauthorizedException} from '@nestjs/common';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {DatabaseService} from './database.service';
type Session={sub:string;role:'super_admin'|'tenant_admin'|'mailbox_user';tenantId?:string;exp:number};
@Injectable()
export class AuthService {
 constructor(private readonly database:DatabaseService){}
 private readonly secret=process.env.CONTROL_PLANE_SESSION_SECRET||'';
 private readonly email=process.env.CONTROL_PLANE_ADMIN_EMAIL||'';
 private readonly password=process.env.CONTROL_PLANE_ADMIN_PASSWORD||'';
 private encode(value:string){return Buffer.from(value).toString('base64url');}
 private sign(body:string){return createHmac('sha256',this.secret).update(body).digest('base64url');}
 async login(email:string,password:string){if(this.secret&&this.email&&this.password&&email===this.email&&password===this.password)return this.issue({sub:email,role:'super_admin'});const rows=await this.database.query<{email:string;role:'tenant_admin'|'mailbox_user';tenant_id:string;password_hash:string}>('select email,role,tenant_id::text as tenant_id,password_hash from tenant_members where lower(email)=lower($1) and status=\'active\' limit 1',[email]);const member=rows?.[0];if(!member||!member.password_hash||!this.verifyPassword(password,member.password_hash))throw new UnauthorizedException('Thông tin đăng nhập không đúng');return this.issue({sub:member.email,role:member.role,tenantId:member.tenant_id});}
 private issue(input:Omit<Session,'exp'>){const session:Session={...input,exp:Date.now()+8*60*60*1000};const body=this.encode(JSON.stringify(session));return {accessToken:`${body}.${this.sign(body)}`,expiresAt:session.exp,user:{email:session.sub,role:session.role,tenantId:session.tenantId}};}
 private verifyPassword(password:string,encoded:string){const [prefix,salt,hash]=encoded.split('$');if(prefix!=='scrypt'||!salt||!hash)return false;const {scryptSync,timingSafeEqual}=require('node:crypto') as typeof import('node:crypto');const derived=scryptSync(password,salt,32);const expected=Buffer.from(hash,'hex');return derived.length===expected.length&&timingSafeEqual(derived,expected);}
 verify(header?:string){if(!header?.startsWith('Bearer ')) throw new UnauthorizedException('Cần đăng nhập');const token=header.slice(7);const [body,signature]=token.split('.');if(!body||!signature||!this.secret) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');const expected=this.sign(body);if(expected.length!==signature.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(signature))) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');const session=JSON.parse(Buffer.from(body,'base64url').toString()) as Session;if(session.exp<Date.now()) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');return session;}
}
