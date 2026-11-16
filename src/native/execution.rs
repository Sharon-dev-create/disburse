//! Receipt execution: no raw-send endpoint, retry, release or administrative success override.
use super::*;
use crate::state::native_execution::{NativeExecutionOutcome, NativeOutcomeKind};
use near_contract_standards::storage_management::StorageBalance;
use near_sdk::{Gas, NearToken, Promise, PromiseError, PromiseOrValue};

// Parent callback gas includes its descendants. Margins are validated with local receipts.
pub const ENTRY_GAS: Gas = Gas::from_tgas(220);
pub const STORAGE_GAS: Gas = Gas::from_tgas(10);
pub const STORAGE_CALLBACK_GAS: Gas = Gas::from_tgas(170);
pub const TRANSFER_GAS: Gas = Gas::from_tgas(30);
pub const SETTLEMENT_GAS: Gas = Gas::from_tgas(50);
const SCHEDULING_MARGIN: u64 = 10_000_000_000_000;
const STORAGE_HEADROOM_BYTES: u64 = 16_384;
pub(super) const OUTCOME_PREFIX: &[u8] = b"native-execution-outcomes-v1";

#[near]
impl Disburse {
    /// Consume approval and schedule storage preflight atomically. No second public send step.
    pub fn begin_native_preflight(
        &mut self,
        payout_id: u64,
        authorization_id: String,
        attempt_id: u64,
    ) -> Promise {
        self.native_config();
        self.assert_campaign_operations_enabled();
        require!(
            env::prepaid_gas() >= ENTRY_GAS,
            "Insufficient native execution prepaid gas"
        );
        Self::require_native_gas(STORAGE_GAS.as_gas() + STORAGE_CALLBACK_GAS.as_gas());
        Self::require_native_storage_headroom();
        let actor = env::predecessor_account_id();
        require!(
            self.has_native_role(actor.clone(), NativeRole::Executor),
            "Explicit native Executor required"
        );
        let mut record = self.validated_native_payout(payout_id);
        self.assert_native_active(&record);
        let (mut auth, mut attempt) =
            self.validated_native_attempt(&record, &authorization_id, attempt_id);
        require!(
            record.status == NativeStatus::Approved
                && auth.status == NativeAuthorizationStatus::Approved,
            "Native attempt is not approved"
        );
        require!(
            auth.expires_at_ns.0 > env::block_timestamp(),
            "Authorization expired"
        );
        require!(
            auth.approver_id != actor && auth.approver_id != record.binding.reservation_actor,
            "Independent approval required"
        );
        require!(
            self.has_native_role(auth.approver_id.clone(), NativeRole::Approver),
            "Approver role revoked"
        );
        require!(
            attempt.executor_id.is_none()
                && !Self::native_outcomes().contains_key(&(payout_id, attempt_id)),
            "Native execution already started"
        );
        let now = U64(env::block_timestamp());
        let memo = format!("disburse:native:v1:{payout_id}:{attempt_id}");
        let outcome = NativeExecutionOutcome {
            version: VERSION,
            campaign_id: record.binding.campaign_id,
            payout_id,
            attempt_id,
            authorization_id: authorization_id.clone(),
            binding_hash: record.binding_hash.clone(),
            memo: memo.clone(),
            kind: NativeOutcomeKind::AwaitingStorage,
            observed_at_ns: now,
            observed_at_block: U64(env::block_height()),
            promise_result_count: U64(0),
            returned_bytes: U64(0),
            result_hash: [0; 32],
        };
        let mut payout = self.payout_or_panic(payout_id);
        require!(
            payout.execution_reference.is_none() && payout.settlement_evidence_reference.is_none(),
            "Native payout has conflicting evidence"
        );
        payout.execution_reference = Some(memo);
        auth.status = NativeAuthorizationStatus::Consumed;
        attempt.status = NativeStatus::PreflightPending;
        attempt.executor_id = Some(actor);
        attempt.updated_at_ns = now;
        attempt.preflight_block_height = Some(U64(env::block_height()));
        record.status = NativeStatus::PreflightPending;
        record.updated_at_ns = now;
        self.payouts.insert(payout_id, payout);
        Self::native_authorizations().insert(authorization_id.clone(), auth);
        Self::native_attempts().insert((payout_id, attempt_id), attempt);
        Self::native_payouts().insert(payout_id, record.clone());
        Self::native_outcomes().insert((payout_id, attempt_id), outcome);
        self.emit_native_event("native_preflight_started", &record, None);
        Promise::new(record.binding.token_id)
            .function_call(
                "storage_balance_of",
                near_sdk::serde_json::to_vec(
                    &near_sdk::serde_json::json!({"account_id":record.binding.recipient_id}),
                )
                .unwrap(),
                NearToken::from_yoctonear(0),
                STORAGE_GAS,
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_native_storage_checked",
                Self::native_callback_args(payout_id, &authorization_id, attempt_id),
                NearToken::from_yoctonear(0),
                STORAGE_CALLBACK_GAS,
            ))
    }

    #[private]
    pub fn on_native_storage_checked(
        &mut self,
        payout_id: u64,
        authorization_id: String,
        attempt_id: u64,
    ) -> PromiseOrValue<()> {
        Self::assert_native_self();
        let record = self.validated_native_payout(payout_id);
        let (auth, attempt) = self.validated_native_attempt(&record, &authorization_id, attempt_id);
        let mut outcome = self.validated_native_outcome(&record, &auth, &attempt);
        require!(
            record.status == NativeStatus::PreflightPending
                && auth.status == NativeAuthorizationStatus::Consumed
                && outcome.kind == NativeOutcomeKind::AwaitingStorage,
            "Native storage callback is stale"
        );
        outcome.promise_result_count = U64(env::promise_results_count());
        if env::promise_results_count() != 1 {
            self.finish_native_unsettled(
                record,
                attempt,
                outcome,
                NativeStatus::ManualReview,
                NativeOutcomeKind::UnexpectedPromiseCount,
            );
            return PromiseOrValue::Value(());
        }
        let bytes = match env::promise_result_checked(0, 4096) {
            Ok(bytes) => bytes,
            Err(PromiseError::Failed) => {
                self.finish_native_unsettled(
                    record,
                    attempt,
                    outcome,
                    NativeStatus::AttemptFailed,
                    NativeOutcomeKind::StorageQueryFailed,
                );
                return PromiseOrValue::Value(());
            }
            Err(_) => {
                self.finish_native_unsettled(
                    record,
                    attempt,
                    outcome,
                    NativeStatus::ManualReview,
                    NativeOutcomeKind::InvalidStorageResult,
                );
                return PromiseOrValue::Value(());
            }
        };
        outcome.returned_bytes = U64(bytes.len() as u64);
        outcome.result_hash = env::sha256_array(&bytes);
        let storage = match near_sdk::serde_json::from_slice::<Option<StorageBalance>>(&bytes) {
            Ok(storage) => storage,
            Err(_) => {
                self.finish_native_unsettled(
                    record,
                    attempt,
                    outcome,
                    NativeStatus::ManualReview,
                    NativeOutcomeKind::InvalidStorageResult,
                );
                return PromiseOrValue::Value(());
            }
        };
        match storage {
            Some(balance)
                if balance.total.as_yoctonear() > 0 && balance.available <= balance.total => {}
            Some(balance) if balance.available > balance.total => {
                self.finish_native_unsettled(
                    record,
                    attempt,
                    outcome,
                    NativeStatus::ManualReview,
                    NativeOutcomeKind::InvalidStorageResult,
                );
                return PromiseOrValue::Value(());
            }
            _ => {
                self.finish_native_unsettled(
                    record,
                    attempt,
                    outcome,
                    NativeStatus::AttemptFailed,
                    NativeOutcomeKind::RecipientUnregistered,
                );
                return PromiseOrValue::Value(());
            }
        }
        // Roles/expiry/pause apply to new dispatch, never to a completion already dispatched.
        let executor = attempt
            .executor_id
            .as_ref()
            .unwrap_or_else(|| env::panic_str("Native executor missing"));
        let recipient = Self::native_recipients()
            .get(&record.binding.recipient_id)
            .cloned();
        let policy_valid = !self.paused
            && self.campaign_or_panic(record.binding.campaign_id).status == CampaignStatus::Active
            && self.accepted_tokens.contains(&record.binding.token_id)
            && auth.expires_at_ns.0 > env::block_timestamp()
            && self.has_native_role(executor.clone(), NativeRole::Executor)
            && self.has_native_role(auth.approver_id.clone(), NativeRole::Approver)
            && executor != &auth.approver_id
            && auth.approver_id != record.binding.reservation_actor
            && record.binding.recipient_id != self.owner_id
            && record.binding.recipient_id != env::current_account_id()
            && !self.has_direct_role(&record.binding.recipient_id, UserRole::Operator)
            && recipient.is_some_and(|r| {
                r.version == VERSION
                    && r.recipient_id == record.binding.recipient_id
                    && r.evidence_hash == record.binding.recipient_evidence_hash
            });
        if !policy_valid {
            self.finish_native_unsettled(
                record,
                attempt,
                outcome,
                NativeStatus::AttemptFailed,
                NativeOutcomeKind::PreflightPolicyRejected,
            );
            return PromiseOrValue::Value(());
        }
        Self::require_native_gas(TRANSFER_GAS.as_gas() + SETTLEMENT_GAS.as_gas());
        Self::require_native_storage_headroom();
        let token = record.binding.token_id.clone();
        let transfer_args = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":record.binding.recipient_id,"amount":record.binding.amount,"memo":outcome.memo})).unwrap();
        // Storage evidence is not a token-result hash. Reset the preallocated result slot on dispatch.
        outcome.returned_bytes = U64(0);
        outcome.promise_result_count = U64(0);
        outcome.result_hash = [0; 32];
        self.set_native_execution_phase(
            record,
            attempt,
            outcome,
            NativeStatus::TransferPending,
            NativeOutcomeKind::TransferScheduled,
        );
        // A panic while building/scheduling this graph rolls back this entire receipt, including lock writes.
        PromiseOrValue::Promise(
            Promise::new(token)
                .function_call(
                    "ft_transfer",
                    transfer_args,
                    NearToken::from_yoctonear(1),
                    TRANSFER_GAS,
                )
                .then(Promise::new(env::current_account_id()).function_call(
                    "on_native_transfer_result",
                    Self::native_callback_args(payout_id, &authorization_id, attempt_id),
                    NearToken::from_yoctonear(0),
                    SETTLEMENT_GAS,
                )),
        )
    }

    #[private]
    pub fn on_native_transfer_result(
        &mut self,
        payout_id: u64,
        authorization_id: String,
        attempt_id: u64,
    ) {
        Self::assert_native_self();
        let record = self.validated_native_payout(payout_id);
        let (auth, attempt) = self.validated_native_attempt(&record, &authorization_id, attempt_id);
        let mut outcome = self.validated_native_outcome(&record, &auth, &attempt);
        require!(
            record.status == NativeStatus::TransferPending
                && auth.status == NativeAuthorizationStatus::Consumed
                && outcome.kind == NativeOutcomeKind::TransferScheduled,
            "Native transfer callback is stale"
        );
        outcome.promise_result_count = U64(env::promise_results_count());
        if env::promise_results_count() != 1 {
            self.finish_native_unsettled(
                record,
                attempt,
                outcome,
                NativeStatus::ManualReview,
                NativeOutcomeKind::UnexpectedPromiseCount,
            );
            return;
        }
        match env::promise_result_checked(0, 64) {
            Ok(bytes) => {
                outcome.returned_bytes = U64(bytes.len() as u64);
                outcome.result_hash = env::sha256_array(&bytes);
                if bytes.is_empty() || bytes == b"null" {
                    self.settle_native_success(record, attempt, outcome);
                } else {
                    self.finish_native_unsettled(
                        record,
                        attempt,
                        outcome,
                        NativeStatus::ManualReview,
                        NativeOutcomeKind::UnexpectedTransferResult,
                    );
                }
            }
            Err(PromiseError::TooLong(length)) => {
                outcome.returned_bytes = U64(length as u64);
                self.finish_native_unsettled(
                    record,
                    attempt,
                    outcome,
                    NativeStatus::ManualReview,
                    NativeOutcomeKind::UnexpectedTransferResult,
                );
            }
            Err(PromiseError::Failed) => self.finish_native_unsettled(
                record,
                attempt,
                outcome,
                NativeStatus::AttemptFailed,
                NativeOutcomeKind::TransferReceiptFailed,
            ),
            _ => self.finish_native_unsettled(
                record,
                attempt,
                outcome,
                NativeStatus::ManualReview,
                NativeOutcomeKind::UnexpectedTransferResult,
            ),
        }
    }

    pub fn get_native_execution_outcome(
        &self,
        payout_id: u64,
        attempt_id: u64,
    ) -> Option<NativeExecutionOutcome> {
        Self::native_outcomes()
            .get(&(payout_id, attempt_id))
            .cloned()
    }
}

impl Disburse {
    fn assert_native_self() {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Private native callback required"
        );
    }
    fn require_native_gas(children: u64) {
        let needed = children.checked_add(SCHEDULING_MARGIN).unwrap();
        require!(
            env::prepaid_gas()
                .as_gas()
                .saturating_sub(env::used_gas().as_gas())
                >= needed,
            "Insufficient native scheduling gas"
        );
    }
    fn require_native_storage_headroom() {
        let required = u128::from(
            env::storage_usage()
                .checked_add(STORAGE_HEADROOM_BYTES)
                .unwrap(),
        )
        .checked_mul(env::storage_byte_cost().as_yoctonear())
        .and_then(|v| v.checked_add(1))
        .unwrap();
        require!(
            env::account_balance().as_yoctonear() >= required,
            "Insufficient native NEAR/storage headroom"
        );
    }
    pub(super) fn native_projected_status(status: NativeStatus) -> PayoutStatus {
        match status {
            NativeStatus::Reserved | NativeStatus::Approved | NativeStatus::PreflightPending => {
                PayoutStatus::Reserved
            }
            NativeStatus::TransferPending => PayoutStatus::Executing,
            NativeStatus::Succeeded => PayoutStatus::Succeeded,
            NativeStatus::AttemptFailed => PayoutStatus::Failed,
            NativeStatus::ManualReview => PayoutStatus::ManualReview,
            NativeStatus::Released => PayoutStatus::ReservationReleased,
        }
    }
    fn native_callback_args(payout_id: u64, authorization_id: &str, attempt_id: u64) -> Vec<u8> {
        near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"payout_id":payout_id,"authorization_id":authorization_id,"attempt_id":attempt_id})).unwrap()
    }
    pub(super) fn native_outcomes() -> LookupMap<(u64, u64), NativeExecutionOutcome> {
        LookupMap::new(OUTCOME_PREFIX.to_vec())
    }
    fn validated_native_outcome(
        &self,
        record: &NativePayout,
        auth: &NativeAuthorization,
        attempt: &NativeAttempt,
    ) -> NativeExecutionOutcome {
        let outcome = Self::native_outcomes()
            .get(&(record.binding.payout_id, attempt.attempt_id))
            .cloned()
            .unwrap_or_else(|| env::panic_str("Native outcome missing"));
        require!(
            outcome.version == VERSION
                && outcome.campaign_id == record.binding.campaign_id
                && outcome.payout_id == record.binding.payout_id
                && outcome.attempt_id == attempt.attempt_id
                && outcome.authorization_id == auth.authorization_id
                && outcome.binding_hash == record.binding_hash
                && outcome.memo
                    == format!(
                        "disburse:native:v1:{}:{}",
                        record.binding.payout_id, attempt.attempt_id
                    )
                && self
                    .payout_or_panic(record.binding.payout_id)
                    .execution_reference
                    .as_ref()
                    == Some(&outcome.memo),
            "Native outcome identity mismatch"
        );
        outcome
    }
    fn set_native_execution_phase(
        &mut self,
        mut record: NativePayout,
        mut attempt: NativeAttempt,
        mut outcome: NativeExecutionOutcome,
        status: NativeStatus,
        kind: NativeOutcomeKind,
    ) {
        let now = U64(env::block_timestamp());
        let mut payout = self.payout_or_panic(record.binding.payout_id);
        payout.status = Self::native_projected_status(status);
        record.status = status;
        record.updated_at_ns = now;
        attempt.status = status;
        attempt.updated_at_ns = now;
        outcome.kind = kind;
        outcome.observed_at_ns = now;
        outcome.observed_at_block = U64(env::block_height());
        self.payouts.insert(payout.id, payout);
        Self::native_attempts().insert((record.binding.payout_id, attempt.attempt_id), attempt);
        Self::native_outcomes().insert(
            (record.binding.payout_id, outcome.attempt_id),
            outcome.clone(),
        );
        Self::native_payouts().insert(record.binding.payout_id, record.clone());
        self.emit_native_event(
            match status {
                NativeStatus::TransferPending => "native_transfer_dispatched",
                NativeStatus::Succeeded => "native_payout_settled",
                NativeStatus::AttemptFailed => "native_execution_failed",
                _ => "native_payout_manual_review",
            },
            &record,
            None,
        );
        self.emit_event(
            "native_execution_outcome",
            near_sdk::serde_json::json!({"outcome":outcome}),
        );
    }
    fn finish_native_unsettled(
        &mut self,
        record: NativePayout,
        attempt: NativeAttempt,
        outcome: NativeExecutionOutcome,
        status: NativeStatus,
        kind: NativeOutcomeKind,
    ) {
        // This records an outcome only. ManualReview does NOT assert non-delivery or release a reservation.
        require!(
            matches!(
                status,
                NativeStatus::AttemptFailed | NativeStatus::ManualReview
            ),
            "Invalid native failure phase"
        );
        self.set_native_execution_phase(record, attempt, outcome, status, kind);
    }
    fn settle_native_success(
        &mut self,
        record: NativePayout,
        attempt: NativeAttempt,
        outcome: NativeExecutionOutcome,
    ) {
        let mut campaign = self.campaign_or_panic(record.binding.campaign_id);
        Self::available_campaign_funds(&campaign);
        let reserved = campaign
            .reserved
            .checked_sub(record.binding.amount.0)
            .unwrap_or_else(|| env::panic_str("Native reserved underflow"));
        let spent = campaign
            .spent
            .checked_add(record.binding.amount.0)
            .unwrap_or_else(|| env::panic_str("Native spent overflow"));
        require!(
            reserved
                .checked_add(spent)
                .is_some_and(|n| n <= campaign.funded)
                && campaign.funded <= campaign.budget,
            "Native accounting invariant violated"
        );
        campaign.reserved = reserved;
        campaign.spent = spent;
        // All checks precede writes. Receipt-level panic/OOG rolls back callback writes, not the prior token receipt.
        self.campaigns.insert(campaign.id, campaign);
        self.set_native_execution_phase(
            record,
            attempt,
            outcome,
            NativeStatus::Succeeded,
            NativeOutcomeKind::TransferSucceeded,
        );
    }
}
