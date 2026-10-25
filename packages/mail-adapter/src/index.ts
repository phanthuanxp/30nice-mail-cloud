/** Contract only. No real Mailcow operations permitted in local mock mode. */
export interface MailboxRequest {tenantId:string;domainId:string;localPart:string;quotaMb:number}
export interface MailAdapter {health():Promise<{mode:'mock'|'mailcow';healthy:boolean}>;createMailbox(request:MailboxRequest):Promise<{id:string}>}
export class MockMailAdapter implements MailAdapter {
 async health(){return {mode:'mock' as const,healthy:true};}
 async createMailbox(_request:MailboxRequest):Promise<{id:string}>{throw new Error('Mock mode: mailbox creation intentionally disabled until tenant authorization and provisioning pipeline are implemented');}
}
