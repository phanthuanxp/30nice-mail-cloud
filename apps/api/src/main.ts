import 'reflect-metadata';
import {existsSync,readFileSync} from 'node:fs';
import {NestFactory} from '@nestjs/core';
import type {CorsOptions} from '@nestjs/common/interfaces/external/cors-options.interface';
import {AppModule} from './app.module';
import {DatabaseService} from './database.service';
import {validDomain} from './dns-setup';
const express=require('express') as {json:(options:{limit:string})=>any;urlencoded:(options:{limit:string;extended:boolean})=>any};
function loadProductionEnv(){const path='/opt/30nice-mail-cloud/.env.prod';if(!existsSync(path)) return;for(const line of readFileSync(path,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]]) process.env[match[1]]=match[2];}}
loadProductionEnv();
async function bootstrap(){const app=await NestFactory.create(AppModule);const allowed=(process.env.CONTROL_PLANE_ALLOWED_ORIGINS||'https://admin.30nice.vn,https://mail.30nice.vn,http://localhost:3002').split(',').map(value=>value.trim()).filter(Boolean);const origin:NonNullable<CorsOptions['origin']>=(requestOrigin,callback)=>{if(!requestOrigin||allowed.includes(requestOrigin)) return callback(null,true);
  void (async()=>{try{const parsed=new URL(requestOrigin);const domain=parsed.hostname.slice(5);if(parsed.origin!==requestOrigin||parsed.protocol!=='https:'||parsed.port||!parsed.hostname.startsWith('mail.')||!validDomain(domain))throw Error();
    const rows=await app.get(DatabaseService).query("select d.id from domains d join tenants t on t.id=d.tenant_id where d.domain=$1 and d.status='verified' and t.status='active'",[domain]);
    if(!rows?.length)throw Error();callback(null,true);
  }catch{callback(new Error('Origin is not allowed'));}})();};app.enableCors({origin,credentials:true});app.use(express.json({limit:'64kb'}));app.use(express.urlencoded({limit:'64kb',extended:false}));app.use((req:any,res:any,next:any)=>{const id=req.headers['x-request-id']||`req-${Date.now()}`;res.setHeader('x-request-id',id);next();});await app.listen(Number(process.env.API_PORT||3001),'127.0.0.1');}
bootstrap();

