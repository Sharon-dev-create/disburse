export interface LedgerLine { type:'APPROVED'|'RESERVED'|'RELEASED'|'DEPOSITED'|'SETTLED'|'REFUND_PENDING'|'REFUNDED'|'FAILED'|'ADJUSTMENT'; amount:bigint; reference:string; confirmed:boolean }
export interface Balances { approved:bigint; reserved:bigint; deposited:bigint; settled:bigint; refunded:bigint; unresolved:bigint; available:bigint }
export function balances(lines:LedgerLine[]):Balances {
  const sum=(...types:LedgerLine['type'][])=>(lines.filter(l=>types.includes(l.type)&&l.confirmed).reduce((s,l)=>s+l.amount,0n));
  const approved=sum('APPROVED')+sum('ADJUSTMENT');
  const reserved=sum('RESERVED')-sum('RELEASED');
  const deposited=sum('DEPOSITED'); const settled=sum('SETTLED'); const refunded=sum('REFUNDED');
  const observedResidual=deposited-settled-refunded;
  // During execution the active reservation and observed deposit describe overlapping exposure; retain the larger.
  const unresolved=reserved>observedResidual?reserved:observedResidual;
  const available=approved-reserved-settled+refunded;
  if(available<0n||unresolved<0n)throw new Error('Ledger does not reconcile');
  return {approved,reserved,deposited,settled,refunded,unresolved,available};
}
