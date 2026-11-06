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
  async ensureSeed(){ /* Schema changes and seeds are applied by the migration runner, never by read requests. */ }
  async onModuleDestroy(){await this.pool?.end();}
}
