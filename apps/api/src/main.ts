import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
async function bootstrap(){const app=await NestFactory.create(AppModule);app.enableCors({origin:true});app.use((req:any,res:any,next:any)=>{const id=req.headers['x-request-id']||`req-${Date.now()}`;res.setHeader('x-request-id',id);next();});await app.listen(Number(process.env.API_PORT||3001),'127.0.0.1');}
bootstrap();
