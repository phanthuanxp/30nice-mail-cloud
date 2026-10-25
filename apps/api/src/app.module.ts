import {Module,Controller,Get} from '@nestjs/common';
@Controller() class ApiController {
@Get('health') health(){return {status:'ok',environment:'local',mailAdapter:'mock',productionReady:false};}
@Get('api/v1/info') info(){return {project:'30NICE Mail Cloud',version:'0.1.0',features:['tenant-management-planned','mailcow-adapter-planned'],note:'No tenant admin endpoints exposed until authentication, authorization and database isolation are implemented'};}
}
@Module({controllers:[ApiController]}) export class AppModule {}
