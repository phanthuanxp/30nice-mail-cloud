import {Injectable,OnModuleDestroy} from '@nestjs/common';
import {Pool} from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool?: Pool;
  constructor(){
    if(process.env.DATABASE_URL){
      this.pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:2000,max:5});
    }
  }
  async status(){
    if(!this.pool) return {configured:false,connected:false};
    try { await this.pool.query('select 1'); return {configured:true,connected:true}; }
    catch { return {configured:true,connected:false}; }
  }
  async query<T extends Record<string, unknown> = Record<string, unknown>>(text:string,values:unknown[]=[]){
    if(!this.pool) return null;
    return (await this.pool.query<T>(text,values)).rows;
  }
  async ensureSeed(){
    if(!this.pool) return;
    await this.pool.query("insert into tenants(name,slug) values ('30 NICE','30nice'),('GoForVietnam','goforvietnam') on conflict (slug) do nothing");
    await this.pool.query("insert into domains(tenant_id,domain) select t.id,v.domain from tenants t join (values ('30nice','30nice.vn'),('goforvietnam','goforvietnam.com')) v(slug,domain) on t.slug=v.slug on conflict (domain) do nothing");
  }
  async onModuleDestroy(){await this.pool?.end();}
}
