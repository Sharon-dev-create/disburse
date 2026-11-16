//! V1 sidecars only. Do not append fields to legacy Disburse/Campaign/Payout.
use near_sdk::{
    AccountId,
    json_types::{U64, U128},
    near,
};

pub const VERSION: u8 = 1;
pub const DOMAIN: &str = "disburse/native-nep141/v1";
pub const NETWORK: &str = "near:testnet";
pub const CONTRACT: &str = "disburse-test-contract.testnet";
pub const TOKEN: &str = "usdc.tidepool-sandbox.testnet";
pub const MAX_AMOUNT: u128 = 100_000;
pub const MAX_TTL_NS: u64 = 3_600_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeConfig {
    pub version: u8,
    pub contract_id: AccountId,
    pub network: String,
    pub token_id: AccountId,
    pub decimals: u8,
    pub max_amount: U128,
    pub max_authorization_ttl_ns: U64,
    pub legacy_state_hash: String,
    pub initialized_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeRole {
    Approver,
    Executor,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeMode {
    NativeNearV1,
}

/// Append-only ordering. M5-C executes preflight/transfer/outcome phases; no retry or release.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeStatus {
    Reserved,
    Approved,
    PreflightPending,
    TransferPending,
    Succeeded,
    AttemptFailed,
    ManualReview,
    Released,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeAuthorizationStatus {
    Approved,
    Revoked,
    Consumed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeRecipientApproval {
    pub version: u8,
    pub recipient_id: AccountId,
    /// Reference to independently reviewed evidence, not an on-chain proof verifier.
    pub evidence_hash: String,
    pub approved_by: AccountId,
    pub approved_at_ns: U64,
}

/// Immutable snapshot, cross-checked against the authoritative legacy payout on each mutation.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeBinding {
    pub version: u8,
    pub domain: String,
    pub contract_id: AccountId,
    pub network: String,
    pub campaign_id: u64,
    pub payout_id: u64,
    pub token_id: AccountId,
    pub recipient_id: AccountId,
    pub amount: U128,
    pub decimals: u8,
    pub reservation_actor: AccountId,
    pub reserved_at_ns: U64,
    pub recipient_evidence_hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativePayout {
    pub binding: NativeBinding,
    pub binding_hash: String,
    pub status: NativeStatus,
    pub next_attempt_id: u64,
    pub current_authorization_id: Option<String>,
    pub current_attempt_id: Option<u64>,
    pub updated_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeAuthorization {
    pub version: u8,
    pub binding: NativeBinding,
    pub binding_hash: String,
    pub authorization_id: String,
    pub attempt_id: u64,
    pub approver_id: AccountId,
    pub approved_at_ns: U64,
    pub expires_at_ns: U64,
    pub status: NativeAuthorizationStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeAttempt {
    pub version: u8,
    pub campaign_id: u64,
    pub payout_id: u64,
    pub binding_hash: String,
    pub authorization_id: String,
    pub attempt_id: u64,
    pub status: NativeStatus,
    pub executor_id: Option<AccountId>,
    pub created_at_ns: U64,
    pub updated_at_ns: U64,
    pub preflight_block_height: Option<U64>,
}
