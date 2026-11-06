import type { Asset } from '../domain/money.js';
export interface QuoteRequest { dry: boolean; swapType:'EXACT_OUTPUT'; originAsset:string; destinationAsset:string; amount:string; recipient:string; refundTo:string; deadline?:string }
export interface ValidatedQuote { correlationId:string; amountIn:bigint; minAmountIn:bigint; maxAmountIn:bigint; amountOut:bigint; deadline:Date; depositAddress?:string; depositMemo?:string|null; rawSanitized:unknown }
export type ProviderStatus='PENDING_DEPOSIT'|'KNOWN_DEPOSIT_TX'|'PROCESSING'|'SUCCESS'|'INCOMPLETE_DEPOSIT'|'REFUNDED'|'FAILED';
export interface StatusResult { status:ProviderStatus; updatedAt:Date; amountIn?:bigint; amountOut?:bigint; depositedAmount?:bigint; refundedAmount?:bigint; refundAssetId?:string; outputAssetId?:string; recipient?:string; originTxHashes:string[]; destinationTxHashes:string[]; rawSanitized:unknown }
export interface IntentsProvider { quote(request:QuoteRequest):Promise<ValidatedQuote>; status(depositAddress:string):Promise<StatusResult> }
export interface QuoteIntent { request:QuoteRequest; input:Asset; output:Asset }
