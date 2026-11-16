//! Execution evidence in a new namespace. Existing V1 authorization/attempt bytes stay unchanged.
use near_sdk::{json_types::U64, near};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeOutcomeKind {
    AwaitingStorage,
    TransferScheduled,
    TransferSucceeded,
    RecipientUnregistered,
    StorageQueryFailed,
    InvalidStorageResult,
    PreflightPolicyRejected,
    TransferReceiptFailed,
    UnexpectedPromiseCount,
    UnexpectedTransferResult,
}

/// Bounded preallocated evidence; no fabricated transaction/receipt identifiers.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeExecutionOutcome {
    pub version: u8,
    pub campaign_id: u64,
    pub payout_id: u64,
    pub attempt_id: u64,
    pub authorization_id: String,
    pub binding_hash: String,
    pub memo: String,
    pub kind: NativeOutcomeKind,
    pub observed_at_ns: U64,
    pub observed_at_block: U64,
    pub promise_result_count: U64,
    pub returned_bytes: U64,
    pub result_hash: [u8; 32],
}
