import {Injectable,UnauthorizedException} from '@nestjs/common';
import {createHmac,timingSafeEqual} from 'node:crypto';
type Session={sub:string;role:'super_admin'|'tenant_admin'|'mailbox_user';tenantId?:string;exp:number};
@Injectable()
export class AuthService {
 private readonly secret=process.env.CONTROL_PLANE_SESSION_SECRET||'';
 private readonly email=process.env.CONTROL_PLANE_ADMIN_EMAIL||'';
 private readonly password=process.env.CONTROL_PLANE_ADMIN_PASSWORD||'';
 private encode(value:string){return Buffer.from(value).toString('base64url');}
 private sign(body:string){return createHmac('sha256',this.secret).update(body).digest('base64url');}
 login(email:string,password:string){if(!this.secret||!this.email||!this.password||email!==this.email||password!==this.password) throw new UnauthorizedException('Thông tin đăng nhập không đúng');const session:Session={sub:email,role:'super_admin',exp:Date.now()+8*60*60*1000};const body=this.encode(JSON.stringify(session));return {accessToken:`${body}.${this.sign(body)}`,expiresAt:session.exp,user:{email,role:session.role}};}
 verify(header?:string){if(!header?.startsWith('Bearer ')) throw new UnauthorizedException('Cần đăng nhập');const token=header.slice(7);const [body,signature]=token.split('.');if(!body||!signature||!this.secret) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');const expected=this.sign(body);if(expected.length!==signature.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(signature))) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');const session=JSON.parse(Buffer.from(body,'base64url').toString()) as Session;if(session.exp<Date.now()) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');return session;}
}
