use near_sdk::{AccountId, near};

use super::{
    amount::TokenAmount,
    destination::{ChainId, RecipientAddress},
};

/// Evidence is a claim supplied by an authorized verifier. The contract cannot itself
/// prove arbitrary destination-chain execution from this representation alone.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementEvidence {
    pub payout_id: u64,
    /// Stable source or settlement provider namespace, such as `near-intents` or `evm`.
    pub provider_id: String,
    pub destination_chain_id: ChainId,
    /// Transaction or execution identifier assigned by the destination chain/provider.
    pub destination_transaction_reference: String,
    /// Optional event/log identifier; for EVM this can be the transfer log index.
    pub transaction_event_identifier: Option<String>,
    pub recipient_address: RecipientAddress,
    pub output_amount: TokenAmount,
    pub verifier_id: AccountId,
    pub verification_method: String,
    pub verified_at_ns: u64,
    pub evidence_reference: Option<String>,
    /// SHA-256 digest of the off-chain evidence payload, encoded as 64 lowercase hex characters.
    pub content_hash: String,
}

/// Provider-scoped external execution identity used by settlement and recovery replay checks.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalExecutionIdentity {
    pub provider_id: String,
    pub destination_chain_id: ChainId,
    pub execution_reference: String,
    pub transaction_event_identifier: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutResolutionOutcome {
    ExecutionConfirmed,
    NonSettlementConfirmed,
}

/// A verifier's bounded attestation resolving a failed or manually reviewed payout.
/// This is an audit record, not a trustless proof of external-chain state.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayoutResolutionEvidence {
    pub payout_id: u64,
    pub verifier_id: AccountId,
    pub outcome: PayoutResolutionOutcome,
    pub verification_method: String,
    pub verified_at_ns: u64,
    pub evidence_reference: String,
    /// SHA-256 digest of the off-chain evidence payload as 64 lowercase hex characters.
    pub content_hash: String,
    pub reason: String,
    pub external_execution: Option<ExternalExecutionIdentity>,
}
