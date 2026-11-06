import type { IntentsProvider, QuoteRequest, ValidatedQuote, StatusResult } from './provider.interface.js';
export class MockProvider implements IntentsProvider {
  private quotes=0; private readonly results=new Map<string,StatusResult>();
  constructor(private readonly now:()=>Date=()=>new Date(),private readonly inputAmount=(amount:string)=>BigInt(amount)+100n){}
  async quote(request:QuoteRequest):Promise<ValidatedQuote>{const amount=BigInt(request.amount); const id=`sim-quote-${++this.quotes}`;return {correlationId:id,amountIn:this.inputAmount(request.amount),minAmountIn:this.inputAmount(request.amount),maxAmountIn:this.inputAmount(request.amount),amountOut:amount,deadline:new Date(this.now().getTime()+600_000),...(request.dry?{}:{depositAddress:`sim-deposit-${id}`,depositMemo:null}),rawSanitized:{simulated:true,id,request}};}
  async status(address:string):Promise<StatusResult>{const result=this.results.get(address);if(!result)throw new Error('Simulated status not configured');return result;}
  setStatus(address:string,result:StatusResult):void{this.results.set(address,result);}
}
