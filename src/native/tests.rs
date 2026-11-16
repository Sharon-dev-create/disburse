use super::*;
use near_sdk::{
    base64::{Engine, engine::general_purpose::STANDARD},
    mock::with_mocked_blockchain,
    test_utils::{VMContextBuilder, get_created_receipts, get_logs},
    testing_env,
};
use std::{
    collections::HashMap,
    panic::{AssertUnwindSafe, catch_unwind},
};

const OWNER: &str = "owner.testnet";
const OP: &str = "operator.testnet";
const APPROVER: &str = "approver.testnet";
const EXECUTOR: &str = "executor.testnet";
const RECIPIENT: &str = "recipient.testnet";
const NOW: u64 = 1_000_000_000_000;
fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(actor: &str, now: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id(CONTRACT))
        .predecessor_account_id(id(actor))
        .signer_account_id(id(actor))
        .block_timestamp(now)
        .block_height(10);
    testing_env!(b.build());
}
fn persist(c: &mut Disburse) {
    c.campaigns.flush();
    c.payouts.flush();
    c.payout_idempotency.flush();
    env::state_write(c);
}
fn storage() -> HashMap<Vec<u8>, Vec<u8>> {
    let map = with_mocked_blockchain(|b| b.take_storage());
    for (k, v) in &map {
        env::storage_write(k, v);
    }
    map
}
fn state_hash() -> String {
    Disburse::native_hash(&env::storage_read(b"STATE").unwrap())
}
fn initialize(c: &mut Disburse) {
    persist(c);
    c.initialize_native_execution(state_hash(), U128(MAX_AMOUNT), U64(1_000_000));
}
fn setup() -> Disburse {
    context(OWNER, NOW);
    let mut c = Disburse::new();
    c.add_accepted_token(id(TOKEN));
    c.grant_role(id(OP), UserRole::Operator);
    c.create_campaign("Native local fixture".into(), id(TOKEN), 1_000_000);
    c.approve_campaign(0);
    context(TOKEN, NOW);
    assert!(matches!(
        FungibleTokenReceiver::ft_on_transfer(
            &mut c,
            id(OP),
            U128(1_000_000),
            "{\"campaign_id\":0}".into()
        ),
        PromiseOrValue::Value(U128(0))
    ));
    context(OP, NOW);
    c.activate_campaign(0);
    context(OWNER, NOW);
    c.pause();
    initialize(&mut c);
    c.set_native_role(id(APPROVER), NativeRole::Approver, true);
    c.set_native_role(id(EXECUTOR), NativeRole::Executor, true);
    c.approve_native_recipient(id(RECIPIENT), "a".repeat(64));
    c.unpause();
    context(OP, NOW);
    c
}
fn reserve(c: &mut Disburse, key: &str) -> u64 {
    c.create_native_payout(0, key.into(), id(RECIPIENT), U128(100_000))
}
fn approve(c: &mut Disburse, payout_id: u64, auth: &str, attempt: u64) {
    context(APPROVER, NOW);
    c.approve_native_execution(payout_id, auth.into(), attempt, U64(NOW + 100));
}
fn reject<F: FnOnce(&mut Disburse)>(c: &mut Disburse, action: F) {
    reject_expected(c, action, None);
}
fn reject_legacy<F: FnOnce(&mut Disburse)>(c: &mut Disburse, action: F) {
    reject_expected(c, action, Some("Native payout cannot use legacy lifecycle"));
}
fn reject_expected<F: FnOnce(&mut Disburse)>(c: &mut Disburse, action: F, expected: Option<&str>) {
    persist(c);
    let before = storage();
    let logs = get_logs();
    let result = catch_unwind(AssertUnwindSafe(|| action(c)));
    let error = result.expect_err("Expected rejection");
    if let Some(expected) = expected {
        let message = error
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| error.downcast_ref::<&str>().copied())
            .unwrap_or("non-string panic");
        assert!(
            message.contains(expected),
            "Unexpected rejection: {message}"
        );
    }
    persist(c);
    assert_eq!(before, storage(), "Rejected call changed storage");
    assert_eq!(logs, get_logs(), "Rejected call emitted events");
    assert!(
        get_created_receipts().is_empty(),
        "M5-B scheduled a promise"
    );
}
#[test]
fn independent_approval_preflight_consumption_and_no_accounting_or_promises() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    let accounting = c.get_campaign_payout_accounting(0).unwrap();
    assert_eq!(
        (accounting.available, accounting.reserved, accounting.spent),
        (U128(900_000), U128(100_000), U128(0))
    );
    approve(&mut c, p, "auth-1", 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::Approved
    );
    assert_eq!(c.get_campaign_payout_accounting(0).unwrap(), accounting);
    context(EXECUTOR, NOW);
    c.begin_native_preflight(p, "auth-1".into(), 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::PreflightPending
    );
    assert_eq!(
        c.get_native_authorization("auth-1".into()).unwrap().status,
        NativeAuthorizationStatus::Consumed
    );
    assert_eq!(
        c.get_native_attempt(p, 1).unwrap().executor_id,
        Some(id(EXECUTOR))
    );
    assert_eq!(c.get_payout(p).unwrap().status, PayoutStatus::Reserved);
    assert_eq!(c.get_campaign_payout_accounting(0).unwrap(), accounting);
    assert!(get_created_receipts().is_empty());
    assert!(
        get_logs()
            .iter()
            .all(|x| !x.contains("settled") && !x.contains("transfer_dispatched"))
    );
}
#[test]
fn unauthorized_owner_admin_operator_and_self_approval_are_denied() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    context(OWNER, NOW);
    c.grant_role(id("admin.testnet"), UserRole::Administrator);
    for actor in [OWNER, OP, EXECUTOR, RECIPIENT, "admin.testnet"] {
        context(actor, NOW);
        reject(&mut c, |c| {
            c.approve_native_execution(p, "no".into(), 1, U64(NOW + 100))
        });
    }
    context(OWNER, NOW);
    c.pause();
    c.set_native_role(id(OP), NativeRole::Approver, true);
    c.unpause();
    context(OP, NOW);
    reject(&mut c, |c| {
        c.approve_native_execution(p, "self".into(), 1, U64(NOW + 100))
    });
}
#[test]
fn explicit_executor_can_be_reserver_with_independent_approval_only() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    context(OP, NOW);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    context(OWNER, NOW);
    c.pause();
    c.set_native_role(id(OP), NativeRole::Executor, true);
    c.unpause();
    context(OP, NOW);
    c.begin_native_preflight(p, "auth".into(), 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::PreflightPending
    );
}
#[test]
fn root_self_and_dual_native_role_grants_reject() {
    let mut c = setup();
    context(OWNER, NOW);
    c.pause();
    for who in [OWNER, CONTRACT] {
        reject(&mut c, |c| {
            c.set_native_role(id(who), NativeRole::Approver, true)
        });
    }
    reject(&mut c, |c| {
        c.set_native_role(id(APPROVER), NativeRole::Executor, true)
    });
    context(OP, NOW);
    reject(&mut c, |c| {
        c.set_native_role(id(OP), NativeRole::Approver, true)
    });
}
#[test]
fn expiry_and_invalid_ttl_reject_without_consumption() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    for expiry in [0, NOW, NOW + 1_000_001, u64::MAX] {
        context(APPROVER, NOW);
        reject(&mut c, |c| {
            c.approve_native_execution(p, "auth".into(), 1, U64(expiry))
        });
    }
    approve(&mut c, p, "auth", 1);
    context(EXECUTOR, NOW + 100);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
}
#[test]
fn revocation_is_safe_and_new_approval_has_fresh_identity() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    context(OP, NOW);
    reject(&mut c, |c| {
        c.revoke_native_authorization(p, "auth".into(), 1)
    });
    context(APPROVER, NOW);
    c.revoke_native_authorization(p, "auth".into(), 1);
    assert_eq!(
        c.get_native_authorization("auth".into()).unwrap().status,
        NativeAuthorizationStatus::Revoked
    );
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::Reserved
    );
    context(EXECUTOR, NOW);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    context(APPROVER, NOW);
    reject(&mut c, |c| {
        c.approve_native_execution(p, "auth".into(), 1, U64(NOW + 100))
    });
    reject(&mut c, |c| {
        c.approve_native_execution(p, "new".into(), 1, U64(NOW + 100))
    });
    c.approve_native_execution(p, "new".into(), 2, U64(NOW + 100));
    assert_eq!(c.get_native_payout(p).unwrap().current_attempt_id, Some(2));
    assert_eq!(
        c.get_campaign_payout_accounting(0).unwrap().reserved,
        U128(100_000)
    );
}
#[test]
fn role_revocation_blocks_approved_attempt_and_owner_can_revoke_while_paused() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    context(OWNER, NOW);
    c.pause();
    c.set_native_role(id(APPROVER), NativeRole::Approver, false);
    c.unpause();
    context(EXECUTOR, NOW);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    context(OWNER, NOW);
    c.pause();
    c.revoke_native_authorization(p, "auth".into(), 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::Reserved
    );
}
#[test]
fn identical_approval_is_idempotent_conflicting_approval_is_rejected() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    persist(&mut c);
    let before = storage();
    context(APPROVER, NOW);
    c.approve_native_execution(p, "auth".into(), 1, U64(NOW + 100));
    persist(&mut c);
    assert_eq!(storage(), before);
    assert!(get_logs().is_empty());
    for (auth, attempt, expiry) in [
        ("auth", 1, NOW + 101),
        ("auth", 2, NOW + 100),
        ("other", 1, NOW + 100),
    ] {
        context(APPROVER, NOW);
        reject(&mut c, |c| {
            c.approve_native_execution(p, auth.into(), attempt, U64(expiry))
        });
    }
}
#[test]
fn duplicate_pending_attempts_unknown_payout_and_cross_payout_auth_reject() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    let q = reserve(&mut c, "second");
    approve(&mut c, p, "auth", 1);
    context(APPROVER, NOW);
    reject(&mut c, |c| {
        c.approve_native_execution(q, "auth".into(), 1, U64(NOW + 100))
    });
    reject(&mut c, |c| {
        c.approve_native_execution(999, "missing".into(), 1, U64(NOW + 100))
    });
    context(EXECUTOR, NOW);
    for (pid, auth, attempt) in [(q, "auth", 1), (p, "other", 1), (p, "auth", 2)] {
        reject(&mut c, |c| {
            c.begin_native_preflight(pid, auth.into(), attempt)
        });
    }
    c.begin_native_preflight(p, "auth".into(), 1);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    context(APPROVER, NOW);
    reject(&mut c, |c| {
        c.approve_native_execution(p, "retry".into(), 2, U64(NOW + 100))
    });
    reject(&mut c, |c| {
        c.revoke_native_authorization(p, "auth".into(), 1)
    });
}
#[test]
fn immutable_recipient_amount_network_token_decimals_and_campaign_are_validated() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    let original = c.payouts.get(&p).unwrap().clone();
    for field in 0..8 {
        let mut tampered = original.clone();
        match field {
            0 => tampered.recipient_near_account_id = Some(id("attacker.testnet")),
            1 => tampered.input_amount = TokenAmount::new(TokenId::near(id(TOKEN)), 100_001, 6),
            2 => tampered.destination.chain_id = ChainId::new("near:mainnet".into()).unwrap(),
            3 => {
                tampered.destination.recipient_address =
                    RecipientAddress::new("attacker.testnet".into()).unwrap()
            }
            4 => {
                tampered.input_amount =
                    TokenAmount::new(TokenId::near(id("other.testnet")), 100_000, 6)
            }
            5 => tampered.input_amount = TokenAmount::new(TokenId::near(id(TOKEN)), 100_000, 18),
            6 => tampered.campaign_id = 999,
            _ => {
                tampered.expected_output_amount =
                    TokenAmount::new(TokenId::near(id(TOKEN)), 99_999, 6)
            }
        }
        c.payouts.insert(p, tampered);
        context(EXECUTOR, NOW);
        reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
        c.payouts.insert(p, original.clone());
    }
}
#[test]
fn altered_binding_and_detached_sidecar_fail_closed() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    let original = c.get_native_payout(p).unwrap();
    for field in 0..5 {
        let mut n = original.clone();
        match field {
            0 => n.binding.payout_id = 999,
            1 => n.binding.campaign_id = 999,
            2 => n.binding.network = "near:mainnet".into(),
            3 => n.binding.amount = U128(100_001),
            _ => n.binding.reservation_actor = id(APPROVER),
        }
        Disburse::native_payouts().insert(p, n);
        context(EXECUTOR, NOW);
        reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    }
    Disburse::native_payouts().insert(p, original);
    Disburse::native_payouts().remove(&p);
    context(OP, NOW);
    reject(&mut c, |c| c.start_payout_execution(p, "legacy".into()));
}
#[test]
fn native_and_legacy_idempotency_cannot_convert_modes() {
    let mut c = setup();
    let p = reserve(&mut c, "native");
    persist(&mut c);
    let before = storage();
    context(OP, NOW);
    assert_eq!(reserve(&mut c, "native"), p);
    persist(&mut c);
    assert_eq!(storage(), before);
    assert!(get_logs().is_empty());
    let orig = c.payouts.get(&p).unwrap().clone();
    reject(&mut c, |c| {
        c.create_payout(
            0,
            "native".into(),
            orig.recipient_near_account_id.clone(),
            orig.destination.clone(),
            orig.input_amount.clone(),
            orig.expected_output_amount.clone(),
        );
    });
    let legacy = c.create_payout(
        0,
        "legacy".into(),
        orig.recipient_near_account_id,
        orig.destination,
        orig.input_amount,
        orig.expected_output_amount,
    );
    assert!(c.get_native_mode(legacy).is_none());
    reject(&mut c, |c| {
        c.create_native_payout(0, "legacy".into(), id(RECIPIENT), U128(100_000));
    });
    for (recipient, amount) in [(RECIPIENT, 99_999), ("other.testnet", 100_000)] {
        reject(&mut c, |c| {
            c.create_native_payout(0, "native".into(), id(recipient), U128(amount));
        });
    }
}
#[test]
fn pending_manual_review_and_terminal_states_cannot_approve_revoke_or_restart() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    // Future-state fixtures only: no public M5-B transition can construct these states.
    for status in [
        NativeStatus::PreflightPending,
        NativeStatus::TransferPending,
        NativeStatus::ManualReview,
        NativeStatus::AttemptFailed,
        NativeStatus::Succeeded,
        NativeStatus::Released,
    ] {
        let mut n = c.get_native_payout(p).unwrap();
        n.status = status;
        Disburse::native_payouts().insert(p, n);
        let mut a = c.get_native_attempt(p, 1).unwrap();
        a.status = status;
        Disburse::native_attempts().insert((p, 1), a);
        context(APPROVER, NOW);
        reject(&mut c, |c| {
            c.approve_native_execution(p, "retry".into(), 2, U64(NOW + 100))
        });
        reject(&mut c, |c| {
            c.revoke_native_authorization(p, "auth".into(), 1)
        });
        context(EXECUTOR, NOW);
        reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    }
}
#[test]
fn accounting_boundary_overflow_counter_overflow_and_multiple_payouts() {
    let mut c = setup();
    for n in 0..10 {
        context(OP, NOW);
        reserve(&mut c, &format!("p{n}"));
    }
    let a = c.get_campaign_payout_accounting(0).unwrap();
    assert_eq!(
        (a.available, a.reserved, a.spent),
        (U128(0), U128(1_000_000), U128(0))
    );
    context(OP, NOW);
    reject(&mut c, |c| {
        reserve(c, "overflow");
    });
    for amount in [0, 100_001, u128::MAX] {
        reject(&mut c, |c| {
            c.create_native_payout(0, "invalid".into(), id(RECIPIENT), U128(amount));
        });
    }
    let mut n = c.get_native_payout(0).unwrap();
    n.next_attempt_id = u64::MAX;
    Disburse::native_payouts().insert(0, n);
    context(APPROVER, NOW);
    reject(&mut c, |c| {
        c.approve_native_execution(0, "overflow".into(), u64::MAX, U64(NOW + 100))
    });
    let original = c.campaigns.get(&0).unwrap().clone();
    for mode in 0..3 {
        let mut bad = original.clone();
        match mode {
            0 => bad.funded = 1_000_001,
            1 => {
                bad.reserved = u128::MAX;
                bad.spent = 1;
            }
            _ => bad.spent = 1_000_001,
        }
        c.campaigns.insert(0, bad);
        context(APPROVER, NOW);
        reject(&mut c, |c| {
            c.approve_native_execution(1, "invalid".into(), 1, U64(NOW + 100))
        });
    }
}
#[test]
fn pause_campaign_cancel_and_token_removal_cannot_free_native_reservation() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    context(OWNER, NOW);
    c.pause();
    context(EXECUTOR, NOW);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    context(OWNER, NOW);
    c.unpause();
    c.remove_accepted_token(id(TOKEN));
    context(EXECUTOR, NOW);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    context(OWNER, NOW);
    c.add_accepted_token(id(TOKEN));
    c.cancel_campaign(0);
    context(EXECUTOR, NOW);
    reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    let a = c.get_campaign_payout_accounting(0).unwrap();
    assert_eq!(
        (a.available, a.reserved, a.spent),
        (U128(900_000), U128(100_000), U128(0))
    );
}
#[test]
fn recipient_allowlist_exclusions_and_evidence_immutability() {
    let mut c = setup();
    for r in [OWNER, OP, CONTRACT, "unknown.testnet"] {
        context(OP, NOW);
        reject(&mut c, |c| {
            c.create_native_payout(0, "bad".into(), id(r), U128(1));
        });
    }
    context(OWNER, NOW);
    c.pause();
    for r in [OWNER, OP, CONTRACT] {
        reject(&mut c, |c| {
            c.approve_native_recipient(id(r), "a".repeat(64))
        });
    }
    reject(&mut c, |c| {
        c.approve_native_recipient(id(RECIPIENT), "b".repeat(64))
    });
    reject(&mut c, |c| {
        c.approve_native_recipient(id("unknown.testnet"), "not-a-proof".into())
    });
}
#[test]
fn uninitialized_and_unknown_schema_fail_closed() {
    let mut c = setup();
    context(OP, NOW);
    env::storage_remove(CONFIG_KEY);
    reject(&mut c, |c| {
        reserve(c, "missing");
    });
    env::storage_write(CONFIG_KEY, b"invalid");
    reject(&mut c, |c| {
        reserve(c, "invalid");
    });
}
#[test]
fn all_legacy_native_mutation_bypasses_are_rejected() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    context(EXECUTOR, NOW);
    c.begin_native_preflight(p, "auth".into(), 1);
    for mode in 0..2 {
        if mode == 1 {
            context(OWNER, NOW);
            c.pause();
        }
        context(OP, NOW);
        reject_legacy(&mut c, |c| c.start_payout_execution(p, "bypass".into()));
        reject_legacy(&mut c, |c| c.mark_payout_pending_verification(p));
        reject_legacy(&mut c, |c| {
            c.mark_payout_failed(p, definitive_failure("bypass"))
        });
        reject_legacy(&mut c, |c| {
            c.move_payout_to_manual_review(p, "bypass".into())
        });
        // Deliberately grant legacy Verifier to demonstrate mode guard rather than role denial.
        context(OWNER, NOW);
        c.grant_role(id("verifier.testnet"), UserRole::Verifier);
        context("verifier.testnet", NOW);
        reject_legacy(&mut c, |c| {
            c.settle_payout(p, settlement_evidence(p, id("verifier.testnet")))
        });
        reject_legacy(&mut c, |c| {
            c.release_failed_payout_reservation(
                p,
                resolution_evidence(
                    p,
                    id("verifier.testnet"),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "bypass",
                ),
            )
        });
        reject_legacy(&mut c, |c| {
            c.confirm_manual_review_execution(
                p,
                resolution_evidence(
                    p,
                    id("verifier.testnet"),
                    PayoutResolutionOutcome::ExecutionConfirmed,
                    "bypass",
                ),
            )
        });
        reject_legacy(&mut c, |c| {
            c.release_manual_review_reservation(
                p,
                resolution_evidence(
                    p,
                    id("verifier.testnet"),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "bypass",
                ),
            )
        });
    }
}

fn definitive_failure(reference: &str) -> ExecutionFailureEvidence {
    ExecutionFailureEvidence {
        kind: ExecutionFailureKind::TransactionReverted,
        evidence_reference: reference.to_string(),
        reason: "Source transaction has a terminal reverted status".to_string(),
    }
}

fn settlement_evidence(payout_id: u64, verifier_id: AccountId) -> SettlementEvidence {
    SettlementEvidence {
        payout_id,
        provider_id: "evm-rpc".to_string(),
        destination_chain_id: types::destination::ChainId::new("eip155:1".to_string()).unwrap(),
        destination_transaction_reference: format!("0xtx{payout_id}"),
        transaction_event_identifier: Some("7".to_string()),
        recipient_address: types::destination::RecipientAddress::new("0xrecipient".to_string())
            .unwrap(),
        output_amount: TokenAmount::new(TokenId::external("sol:usdc".to_string()).unwrap(), 95, 18),
        verifier_id,
        verification_method: "receipt-transfer-log".to_string(),
        verified_at_ns: 123,
        evidence_reference: Some(format!("evidence:{payout_id}")),
        content_hash: "a".repeat(64),
    }
}

fn resolution_evidence(
    payout_id: u64,
    verifier_id: AccountId,
    outcome: PayoutResolutionOutcome,
    reference: &str,
) -> PayoutResolutionEvidence {
    PayoutResolutionEvidence {
        payout_id,
        verifier_id,
        outcome,
        verification_method: "provider-finality-check".to_string(),
        verified_at_ns: 456,
        evidence_reference: reference.to_string(),
        content_hash: "b".repeat(64),
        reason: "Verifier confirmed final non-settlement state".to_string(),
        external_execution: Some(ExternalExecutionIdentity {
            provider_id: "evm-rpc".to_string(),
            destination_chain_id: types::destination::ChainId::new("eip155:1".to_string()).unwrap(),
            execution_reference: format!("0xtx{payout_id}"),
            transaction_event_identifier: Some("7".to_string()),
        }),
    }
}

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct HistoricalState {
    owner_id: AccountId,
    paused: bool,
    next_campaign_id: u64,
    campaigns: LookupMap<u64, Campaign>,
    roles: LookupSet<(AccountId, UserRole)>,
    accepted_tokens: LookupSet<AccountId>,
    next_payout_id: u64,
    payouts: LookupMap<u64, Payout>,
    payout_idempotency: LookupMap<(u64, String), u64>,
}
fn authentic_fixture() -> Disburse {
    context("disburse-topg.testnet", NOW);
    with_mocked_blockchain(|b| b.take_storage());
    let fixture: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!(
        "../../tests/fixtures/m5b-deployed-state.json"
    ))
    .unwrap();
    for entry in fixture["values"].as_array().unwrap() {
        env::storage_write(
            &STANDARD.decode(entry["key"].as_str().unwrap()).unwrap(),
            &STANDARD.decode(entry["value"].as_str().unwrap()).unwrap(),
        );
    }
    let raw = env::storage_read(b"STATE").unwrap();
    let historical: HistoricalState = borsh::from_slice(&raw).unwrap();
    assert_eq!(borsh::to_vec(&historical).unwrap(), raw);
    borsh::from_slice(&raw).unwrap()
}
#[test]
fn authentic_deployed_bytes_deserialize_and_bootstrap_preserves_every_legacy_entry() {
    let mut c = authentic_fixture();
    assert_eq!(c.get_owner(), id("disburse-topg.testnet"));
    assert!(c.has_role(id("disburse-op-b966e36d.testnet"), UserRole::Operator));
    assert!(c.is_accepted_token(id(TOKEN)));
    assert_eq!(c.next_payout_id, 0);
    let a = c.get_campaign_payout_accounting(0).unwrap();
    assert_eq!(
        (a.funded, a.available, a.reserved, a.spent),
        (U128(1_000_000), U128(1_000_000), U128(0), U128(0))
    );
    c.pause();
    persist(&mut c);
    let before = storage();
    c.initialize_native_execution(state_hash(), U128(MAX_AMOUNT), U64(1000));
    persist(&mut c);
    let after = storage();
    assert_eq!(after.len(), before.len() + 1);
    for (k, v) in before {
        assert_eq!(after.get(&k), Some(&v));
    }
    assert_eq!(c.get_native_config().unwrap().version, VERSION);
    assert!(c.get_native_mode(0).is_none());
    let restored: Disburse = env::state_read().unwrap();
    assert_eq!(restored.get_owner(), c.get_owner());
    assert_eq!(restored.get_campaign(0), c.get_campaign(0));
    assert!(get_created_receipts().is_empty());
}
#[test]
fn bootstrap_rejects_unauthorized_repeat_incompatible_hash_and_bounds() {
    let mut c = authentic_fixture();
    c.pause();
    persist(&mut c);
    context(OP, NOW);
    reject(&mut c, |c| {
        c.initialize_native_execution(state_hash(), U128(1), U64(1))
    });
    context("disburse-topg.testnet", NOW);
    reject(&mut c, |c| {
        c.initialize_native_execution("bad".into(), U128(1), U64(1))
    });
    reject(&mut c, |c| {
        c.initialize_native_execution("0".repeat(64), U128(1), U64(1))
    });
    for (amount, ttl) in [(0, 1), (MAX_AMOUNT + 1, 1), (1, 0), (1, MAX_TTL_NS + 1)] {
        reject(&mut c, |c| {
            c.initialize_native_execution(state_hash(), U128(amount), U64(ttl))
        });
    }
    c.initialize_native_execution(state_hash(), U128(1), U64(1));
    reject(&mut c, |c| {
        c.initialize_native_execution(state_hash(), U128(1), U64(1))
    });
}
#[test]
fn bootstrap_rejects_malformed_state_unpaused_and_wrong_deployment_identity() {
    let mut c = authentic_fixture();
    reject(&mut c, |c| {
        c.initialize_native_execution(state_hash(), U128(1), U64(1))
    });
    c.pause();
    persist(&mut c);
    let raw = env::storage_read(b"STATE").unwrap();
    for bytes in [vec![], vec![0, 1, 2], {
        let mut b = raw.clone();
        b.push(0);
        b
    }] {
        env::storage_write(b"STATE", &bytes);
        let before = storage();
        assert!(
            catch_unwind(AssertUnwindSafe(|| c.initialize_native_execution(
                Disburse::native_hash(&bytes),
                U128(1),
                U64(1)
            )))
            .is_err()
        );
        assert_eq!(storage(), before);
    }
    env::storage_write(b"STATE", &raw);
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("wrong.testnet"))
        .predecessor_account_id(id("disburse-topg.testnet"));
    testing_env!(b.build());
    reject(&mut c, |c| {
        c.initialize_native_execution(state_hash(), U128(1), U64(1))
    });
}
fn legacy_reserve(c: &mut Disburse, key: &str) -> u64 {
    c.create_payout(
        0,
        key.into(),
        None,
        PayoutDestination {
            chain_id: ChainId::new("eip155:1".into()).unwrap(),
            recipient_address: RecipientAddress::new("0xrecipient".into()).unwrap(),
        },
        TokenAmount::new(TokenId::near(id(TOKEN)), 10_000, 6),
        TokenAmount::new(TokenId::external("sol:usdc".into()).unwrap(), 95, 6),
    )
}
#[test]
fn nonempty_legacy_payout_indexes_failure_settlement_and_resolution_survive_bootstrap() {
    let mut c = setup();
    context(OP, NOW);
    let settled = legacy_reserve(&mut c, "settled");
    c.start_payout_execution(settled, "legacy-success".into());
    c.mark_payout_pending_verification(settled);
    context(OWNER, NOW);
    c.grant_role(id("verifier.testnet"), UserRole::Verifier);
    context("verifier.testnet", NOW);
    c.settle_payout(
        settled,
        settlement_evidence(settled, id("verifier.testnet")),
    );
    context(OP, NOW);
    let failed = legacy_reserve(&mut c, "failed");
    c.start_payout_execution(failed, "legacy-failed".into());
    c.mark_payout_failed(failed, definitive_failure("legacy-failure-proof"));
    context("verifier.testnet", NOW);
    c.release_failed_payout_reservation(
        failed,
        resolution_evidence(
            failed,
            id("verifier.testnet"),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "legacy-release-proof",
        ),
    );
    context(OWNER, NOW);
    c.pause();
    persist(&mut c);
    // Synthetic legacy fixture: strip only newly introduced native sidecars, retaining all old bytes.
    let all = storage();
    for k in all.keys().filter(|k| k.starts_with(b"native-")) {
        env::storage_remove(k);
    }
    let before = storage();
    let raw = env::storage_read(b"STATE").unwrap();
    let old: HistoricalState = borsh::from_slice(&raw).unwrap();
    assert_eq!(borsh::to_vec(&old).unwrap(), raw);
    let mut loaded: Disburse = borsh::from_slice(&raw).unwrap();
    initialize(&mut loaded);
    persist(&mut loaded);
    let after = storage();
    for (k, v) in &before {
        assert_eq!(after.get(k), Some(v));
    }
    assert_eq!(after.len(), before.len() + 1);
    assert_eq!(
        loaded.get_payout(settled).unwrap().status,
        PayoutStatus::Succeeded
    );
    assert!(
        loaded
            .get_payout(settled)
            .unwrap()
            .settlement_evidence
            .is_some()
    );
    let f = loaded.get_payout(failed).unwrap();
    assert_eq!(f.status, PayoutStatus::ReservationReleased);
    assert!(f.failure_evidence.is_some());
    assert_eq!(f.resolution_evidence.len(), 1);
    assert_eq!(
        loaded
            .get_payout_by_idempotency(0, "settled".into())
            .unwrap()
            .id,
        settled
    );
    assert_eq!(
        loaded.get_campaign_payout_accounting(0).unwrap().spent,
        U128(10_000)
    );
    assert!(loaded.has_role(id("verifier.testnet"), UserRole::Verifier));
    assert!(
        Disburse::settlement_reference_index()
            .get(&format!("evidence:{settled}"))
            .is_some()
    );
    assert!(
        Disburse::settlement_reference_index()
            .get(&"legacy-release-proof".to_string())
            .is_some()
    );
    assert_eq!(
        Disburse::execution_references().get(&"legacy-success".to_string()),
        Some(&settled)
    );
    assert_eq!(loaded.next_payout_id, 2);
}
#[test]
fn storage_prefixes_are_unique_and_legacy_borsh_layout_is_unchanged() {
    let prefixes: [&[u8]; 19] = [
        CONFIG_KEY,
        MODE_PREFIX,
        PAYOUT_PREFIX,
        AUTH_PREFIX,
        ATTEMPT_PREFIX,
        ROLE_PREFIX,
        RECIPIENT_PREFIX,
        b"campaigns",
        b"role-assignments",
        b"accepted-ft-tokens",
        b"payout-records",
        b"payout-idempotency",
        b"payout-execution-references",
        b"payout-lifecycle-reasons",
        b"payout-failure-evidence-v1",
        b"payout-settlement-records-v1",
        b"payout-resolution-records-v1",
        b"payout-settlement-executions-v1",
        b"payout-settlement-references-v1",
    ];
    for (i, a) in prefixes.iter().enumerate() {
        for b in &prefixes[i + 1..] {
            assert!(!a.starts_with(b) && !b.starts_with(a));
        }
    }
    let mut c = authentic_fixture();
    let raw = borsh::to_vec(&c).unwrap();
    assert_eq!(raw.len(), 137);
    c.pause();
    persist(&mut c);
    let paused_raw = borsh::to_vec(&c).unwrap();
    initialize(&mut c);
    assert_eq!(borsh::to_vec(&c).unwrap(), paused_raw);
}
#[test]
fn json_binding_schema_uses_decimal_strings_and_no_transfer_or_success_abi() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    let record = c.get_native_authorization("auth".into()).unwrap();
    let value = near_sdk::serde_json::to_value(&record).unwrap();
    assert_eq!(value["binding"]["amount"], "100000");
    assert_eq!(value["expires_at_ns"], (NOW + 100).to_string());
    assert_eq!(
        borsh::from_slice::<NativeAuthorization>(&borsh::to_vec(&record).unwrap()).unwrap(),
        record
    );
    let module = include_str!("../native.rs");
    assert!(
        !module.contains("Promise::")
            && !module.contains(".function_call(")
            && !module.contains("pub fn settle_native")
            && !module.contains("pub fn execute_native")
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn two_campaigns_share_token_but_not_reservation_or_authorization() {
    let mut c = setup();
    let p = reserve(&mut c, "same-key");
    context(OWNER, NOW);
    let second = c.create_campaign("Second".into(), id(TOKEN), 100_000);
    c.approve_campaign(second);
    context(TOKEN, NOW);
    assert!(matches!(
        FungibleTokenReceiver::ft_on_transfer(
            &mut c,
            id(OP),
            U128(100_000),
            format!("{{\"campaign_id\":{second}}}"),
        ),
        PromiseOrValue::Value(U128(0))
    ));
    context(OP, NOW);
    c.activate_campaign(second);
    let q = c.create_native_payout(second, "same-key".into(), id(RECIPIENT), U128(100_000));
    assert_ne!(p, q);
    assert_eq!(
        c.get_campaign_payout_accounting(0).unwrap().available,
        U128(900_000)
    );
    assert_eq!(
        c.get_campaign_payout_accounting(second).unwrap().available,
        U128(0)
    );
    approve(&mut c, p, "auth", 1);
    context(EXECUTOR, NOW);
    reject(&mut c, |c| c.begin_native_preflight(q, "auth".into(), 1));
}
#[test]
fn explicit_native_binding_and_attempt_records_reject_corruption() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    let original = c.get_native_authorization("auth".into()).unwrap();
    for field in 0..4 {
        let mut a = original.clone();
        match field {
            0 => a.binding.recipient_id = id("attacker.testnet"),
            1 => a.binding.amount = U128(1),
            2 => a.attempt_id = 2,
            _ => a.version = 99,
        }
        Disburse::native_authorizations().insert("auth".into(), a);
        context(EXECUTOR, NOW);
        reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    }
    Disburse::native_authorizations().insert("auth".into(), original);
    let original = c.get_native_attempt(p, 1).unwrap();
    for field in 0..4 {
        let mut a = original.clone();
        match field {
            0 => a.campaign_id = 99,
            1 => a.payout_id = 99,
            2 => a.attempt_id = 2,
            _ => a.authorization_id = "other".into(),
        }
        Disburse::native_attempts().insert((p, 1), a);
        context(EXECUTOR, NOW);
        reject(&mut c, |c| c.begin_native_preflight(p, "auth".into(), 1));
    }
}
#[test]
fn unknown_config_version_and_new_id_collisions_fail_before_reservation() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    let mut config = c.get_native_config().unwrap();
    config.version = 99;
    env::storage_write(CONFIG_KEY, &borsh::to_vec(&config).unwrap());
    context(OP, NOW);
    reject(&mut c, |c| {
        reserve(c, "unknown-version");
    });
    config.version = VERSION;
    env::storage_write(CONFIG_KEY, &borsh::to_vec(&config).unwrap());
    let before = c.get_campaign_payout_accounting(0).unwrap();
    Disburse::native_modes().insert(c.next_payout_id, NativeMode::NativeNearV1);
    reject(&mut c, |c| {
        reserve(c, "collision");
    });
    assert_eq!(c.get_campaign_payout_accounting(0).unwrap(), before);
    Disburse::native_modes().remove(&p);
    reject_legacy(&mut c, |c| {
        c.start_payout_execution(p, "missing-mode".into())
    });
}

#[test]
fn bootstrap_rejects_structurally_valid_but_changed_legacy_prefixes() {
    let mut c = authentic_fixture();
    c.pause();
    c.campaigns = LookupMap::new(b"unexpected-campaigns".to_vec());
    persist(&mut c);
    reject_expected(
        &mut c,
        |c| c.initialize_native_execution(state_hash(), U128(1), U64(1)),
        Some("Incompatible legacy storage prefixes"),
    );
}
