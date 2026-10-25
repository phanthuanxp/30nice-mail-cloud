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
  async onModuleDestroy(){await this.pool?.end();}
}
