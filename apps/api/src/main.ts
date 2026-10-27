import 'reflect-metadata';
import {existsSync,readFileSync} from 'node:fs';
import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
function loadProductionEnv(){const path='/opt/30nice-mail-cloud/.env.prod';if(!existsSync(path)) return;for(const line of readFileSync(path,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]]) process.env[match[1]]=match[2];}}
loadProductionEnv();
async function bootstrap(){const app=await NestFactory.create(AppModule);app.enableCors({origin:true});app.use((req:any,res:any,next:any)=>{const id=req.headers['x-request-id']||`req-${Date.now()}`;res.setHeader('x-request-id',id);next();});await app.listen(Number(process.env.API_PORT||3001),'127.0.0.1');}
bootstrap();
