import {Body,Controller,Get,Headers,Module,Param,Post,Put,Req} from '@nestjs/common';
import {MailCloudService} from './mail-cloud.service';
import {DatabaseService} from './database.service';
import {MailcowService} from './mailcow.service';

@Controller()
class ApiController {
  constructor(private readonly service: MailCloudService, private readonly mailcow: MailcowService) {}

  @Get('health') async health(){const mailcow=await this.mailcow.health();return {status:'ok',environment:mailcow.mode==='production'?'production-integrated':'production-safe',mailAdapter:mailcow.mode,productionReady:mailcow.mode==='production'&&mailcow.healthy,database:await this.service.databaseStatus(),mailcow};}
  @Get('api/v1/info') info(){return {project:'30NICE Mail Cloud',version:'0.3.0',features:['tenant-scoped-crud','postgres-persistence','domain-verification','mailbox-provisioning-jobs','audit-log','quota-validation','mailcow-adapter-planned']};}
  @Get('api/v1/tenants') tenants(@Headers('x-role') role?: string,@Headers('x-tenant-id') tenantId?: string){return this.service.listTenants(role,tenantId);}
  @Get('api/v1/audit') async audit(@Headers('x-role') role?: string){return this.service.listAudit(role);}
  @Post('api/v1/tenants') createTenant(@Body() body: {name?: string; slug?: string}, @Req() req: {headers: Record<string,string>}){return this.service.createTenant(body, req.headers['x-request-id']);}
  @Get('api/v1/tenants/:tenantId/domains') async domains(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope?: string){return this.service.listDomains(await this.service.assertTenant(tenantId, scope));}
  @Get('api/v1/tenants/:tenantId/domains/:domainId/dns-health') async dnsHealth(@Param('tenantId') tenantId: string,@Param('domainId') domainId: string,@Headers('x-tenant-id') scope?: string){return this.service.dnsHealth(await this.service.assertTenant(tenantId, scope),domainId);}
  @Post('api/v1/tenants/:tenantId/domains') async createDomain(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {domain?: string}){return this.service.createDomain(await this.service.assertTenant(tenantId, scope), body);}
  @Post('api/v1/tenants/:tenantId/domains/:domainId/verify') async verifyDomain(@Param('tenantId') tenantId: string, @Param('domainId') domainId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {token?: string}){return this.service.verifyDomain(await this.service.assertTenant(tenantId, scope), domainId, body.token??'');}
  @Get('api/v1/tenants/:tenantId/mailboxes') async mailboxes(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope?: string){return this.service.listMailboxes(await this.service.assertTenant(tenantId, scope));}
  @Get('api/v1/tenants/:tenantId/provisioning-jobs') async provisioningJobs(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope?: string){return this.service.listProvisioningJobs(await this.service.assertTenant(tenantId, scope));}
  @Post('api/v1/tenants/:tenantId/mailboxes') async createMailbox(@Param('tenantId') tenantId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {address?: string; quotaGb?: number}){return this.service.createMailbox(await this.service.assertTenant(tenantId, scope), body);}
  @Put('api/v1/tenants/:tenantId/mailboxes/:mailboxId') async updateMailbox(@Param('tenantId') tenantId: string, @Param('mailboxId') mailboxId: string, @Headers('x-tenant-id') scope: string|undefined, @Body() body: {quotaGb?: number; status?: 'active'|'disabled'}){return this.service.updateMailbox(await this.service.assertTenant(tenantId, scope), mailboxId, body);}
}

@Module({controllers:[ApiController],providers:[MailCloudService,DatabaseService,MailcowService]}) export class AppModule {}
