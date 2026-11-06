export const statuses = ['CREATED','QUOTED','RESERVED','COMMITTED','AWAITING_DEPOSIT','PROCESSING','SUCCESS','FAILED','EXPIRED','REFUND_PENDING','REFUNDED','UNKNOWN'] as const;
export type PayoutStatus = typeof statuses[number];
const transitions: Record<PayoutStatus, readonly PayoutStatus[]> = {
  CREATED:['QUOTED','FAILED'], QUOTED:['RESERVED','EXPIRED','FAILED'], RESERVED:['COMMITTED','EXPIRED','UNKNOWN','FAILED'], COMMITTED:['AWAITING_DEPOSIT','PROCESSING','UNKNOWN','EXPIRED'], AWAITING_DEPOSIT:['PROCESSING','EXPIRED','UNKNOWN','FAILED'], PROCESSING:['SUCCESS','FAILED','REFUND_PENDING','REFUNDED','UNKNOWN'], UNKNOWN:['PROCESSING','SUCCESS','FAILED','REFUND_PENDING','REFUNDED','EXPIRED'], REFUND_PENDING:['REFUNDED','UNKNOWN'], FAILED:['QUOTED'], EXPIRED:['QUOTED'], REFUNDED:['QUOTED'], SUCCESS:[]
};
export function canTransition(from: PayoutStatus, to: PayoutStatus): boolean { return transitions[from].includes(to); }
export function assertTransition(from: PayoutStatus, to: PayoutStatus): void { if (!canTransition(from,to)) throw new Error(`Invalid payout transition ${from} -> ${to}`); }
