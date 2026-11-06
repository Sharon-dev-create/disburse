export type ExposureEntryType = 'DEPOSIT_OBSERVED' | 'SETTLEMENT_CONFIRMED' | 'REFUND_CONFIRMED';
export interface ExposureReservation { attemptId:string|null; payoutId:string|null; remainingAmount:bigint }
export interface ExposureEntry { attemptId:string|null; payoutId:string|null; type:ExposureEntryType; amount:bigint }

/** Exposure is tracked per provider attempt; a deposit overlaps later settlement/refund records. */
export function calculateAuthorizedExposure(reservations:ExposureReservation[], entries:ExposureEntry[]):bigint {
  const groups=new Map<string,{reserved:bigint;deposit:bigint;settlement:bigint;refund:bigint;hasDeposit:boolean}>();
  const key=(attemptId:string|null,payoutId:string|null)=>attemptId??payoutId??'__campaign__';
  const group=(id:string)=>{let g=groups.get(id);if(!g){g={reserved:0n,deposit:0n,settlement:0n,refund:0n,hasDeposit:false};groups.set(id,g);}return g;};
  for(const r of reservations){if(r.remainingAmount<0n)throw new Error('Reservation remaining amount cannot be negative');group(key(r.attemptId,r.payoutId)).reserved+=r.remainingAmount;}
  for(const e of entries){if(e.amount<0n)throw new Error('Financial ledger amount cannot be negative');const g=group(key(e.attemptId,e.payoutId));if(e.type==='DEPOSIT_OBSERVED'){g.deposit+=e.amount;g.hasDeposit=true;}else if(e.type==='SETTLEMENT_CONFIRMED')g.settlement+=e.amount;else g.refund+=e.amount;}
  let total=0n;
  for(const g of groups.values()){
    const gross=g.hasDeposit?g.deposit:(g.settlement>g.refund?g.settlement:g.refund);
    if(g.refund>gross)throw new Error('Confirmed refunds exceed recorded deposits or source outflow');
    const net=gross-g.refund;
    const observed=g.reserved>net?g.reserved:net;
    total+=observed;
  }
  return total;
}
