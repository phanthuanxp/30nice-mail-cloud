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
  async transaction<T extends Record<string, unknown>>(work:(query:<R extends Record<string,unknown> = Record<string,unknown>>(text:string,values?:unknown[])=>Promise<R[]>)=>Promise<T[]>){
    if(!this.pool)return null;
    const client=await this.pool.connect();
    let begun=false;
    try{await client.query('begin');begun=true;const result=await work(async <R extends Record<string,unknown> = Record<string,unknown>>(text:string,values:unknown[]=[])=>(await client.query<R>(text,values)).rows);await client.query('commit');begun=false;return result;}
    catch(error){if(begun)await client.query('rollback');throw error;}
    finally{client.release();}
  }
  async ensureSeed(){
    if(!this.pool) return;
    await this.pool.query('alter table tenant_members add column if not exists password_hash text');
    await this.pool.query('alter table provisioning_jobs add column if not exists payload jsonb not null default \'{}\'::jsonb');
    await this.pool.query("insert into tenants(name,slug) values ('30 NICE','30nice'),('GoForVietnam','goforvietnam') on conflict (slug) do nothing");
    await this.pool.query("insert into domains(tenant_id,domain) select t.id,v.domain from tenants t join (values ('30nice','30nice.vn'),('goforvietnam','goforvietnam.com')) v(slug,domain) on t.slug=v.slug on conflict (domain) do nothing");
  }
  async onModuleDestroy(){await this.pool?.end();}
}
