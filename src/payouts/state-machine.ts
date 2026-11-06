import { assertTransition, type PayoutStatus } from '../domain/payout.js';
export interface Event { from:PayoutStatus; to:PayoutStatus; at:Date; note:string }
export class PayoutLifecycle {
  status:PayoutStatus='CREATED'; readonly history:Event[]=[];
  transition(to:PayoutStatus,note:string,at=new Date()):void{assertTransition(this.status,to);const from=this.status;this.status=to;this.history.push({from,to,at,note});}
}
