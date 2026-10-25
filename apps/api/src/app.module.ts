import {Body,Controller,Get,Headers,Module,Param,Post,Put,Req} from '@nestjs/common';
import {MailCloudService} from './mail-cloud.service';
import {DatabaseService} from './database.service';

@Controller()
class ApiController {
  constructor(private readonly service: MailCloudService) {}

  @Get('health') async health(){return {status:'ok',environment:'production-safe-mock',mailAdapter:'mock',productionReady:false,database:await this.service.databaseStatus()};}
  @Get('api/v1/info') info(){return {project:'30NICE Mail Cloud',version:'0.2.0',features:['tenant-scoped-crud','audit-log','quota-validation','mailcow-adapter-planned']};}
  @Get('api/v1/tenants') tenants(@Headers('x-role') role?: string,@Headers('x-tenant-id') tenantId?: string){return this.service.listTenants(role,tenantId);}
  @Get('api/v1/audit') audit(@Headers('x-role') role?: string){return this.service.listAudit(role);}
  @Post('api/v1/tenants') createTenant(@Body() body: {name?: string; slug?: string}, @Req() req: {headers: Record<string,string>}){return this.service.createTenant(body, req.headers['x-request-id']);}
  @Get('api/v1/tenants/:tenantId/domains') domains(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope?: string){return this.service.listDomains(this.service.assertTenant(tenantId, scope));}
  @Post('api/v1/tenants/:tenantId/domains') createDomain(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {domain?: string}){return this.service.createDomain(this.service.assertTenant(tenantId, scope), body);}
  @Get('api/v1/tenants/:tenantId/mailboxes') mailboxes(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope?: string){return this.service.listMailboxes(this.service.assertTenant(tenantId, scope));}
  @Post('api/v1/tenants/:tenantId/mailboxes') createMailbox(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {address?: string; quotaGb?: number}){return this.service.createMailbox(this.service.assertTenant(tenantId, scope), body);}
  @Put('api/v1/tenants/:tenantId/mailboxes/:mailboxId') updateMailbox(@Param('tenantId') tenantId: string, @Param('mailboxId') mailboxId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {quotaGb?: number; status?: 'active'|'disabled'}){return this.service.updateMailbox(this.service.assertTenant(tenantId, scope), mailboxId, body);}
}

@Module({controllers:[ApiController],providers:[MailCloudService,DatabaseService]}) export class AppModule {}
