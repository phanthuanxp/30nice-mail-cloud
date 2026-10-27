import 'reflect-metadata';
import {existsSync,readFileSync} from 'node:fs';
import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
const express=require('express') as {json:(options:{limit:string})=>any;urlencoded:(options:{limit:string;extended:boolean})=>any};
function loadProductionEnv(){const path='/opt/30nice-mail-cloud/.env.prod';if(!existsSync(path)) return;for(const line of readFileSync(path,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]]) process.env[match[1]]=match[2];}}
loadProductionEnv();
async function bootstrap(){const app=await NestFactory.create(AppModule);const allowed=(process.env.CONTROL_PLANE_ALLOWED_ORIGINS||'https://admin.30nice.vn,https://mail.30nice.vn,http://localhost:3002').split(',').map(value=>value.trim()).filter(Boolean);app.enableCors({origin:(origin,callback)=>{if(!origin||allowed.includes(origin)) return callback(null,true);return callback(new Error('Origin is not allowed'));},credentials:true});app.use(express.json({limit:'64kb'}));app.use(express.urlencoded({limit:'64kb',extended:false}));app.use((req:any,res:any,next:any)=>{const id=req.headers['x-request-id']||`req-${Date.now()}`;res.setHeader('x-request-id',id);next();});await app.listen(Number(process.env.API_PORT||3001),'127.0.0.1');}
bootstrap();
