use super::*;
use crate::native::execution::{
    ENTRY_GAS, SETTLEMENT_GAS, STORAGE_CALLBACK_GAS, STORAGE_GAS, TRANSFER_GAS,
};
use crate::state::native_execution::NativeOutcomeKind;
use near_sdk::{Gas, NearToken, PromiseResult, mock::MockAction};

fn callback_context(results: Vec<PromiseResult>, gas: Gas) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id(CONTRACT))
        .predecessor_account_id(id(CONTRACT))
        .signer_account_id(id(EXECUTOR))
        .block_timestamp(NOW + 1)
        .prepaid_gas(gas);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        HashMap::new(),
        results
    );
}
fn started() -> (Disburse, u64) {
    let mut c = setup();
    let p = reserve(&mut c, "native-c");
    approve(&mut c, p, "auth", 1);
    context(EXECUTOR, NOW);
    c.begin_native_preflight(p, "auth".into(), 1).detach();
    (c, p)
}
fn registered() -> Vec<u8> {
    br#"{"total":"1250000000000000000000","available":"0"}"#.to_vec()
}
fn dispatched() -> (Disburse, u64) {
    let (mut c, p) = started();
    callback_context(
        vec![PromiseResult::Successful(registered())],
        STORAGE_CALLBACK_GAS,
    );
    c.on_native_storage_checked(p, "auth".into(), 1).detach();
    (c, p)
}
#[test]
fn exact_storage_and_token_promises_bind_deposit_gas_recipient_amount() {
    let (mut c, p) = started();
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, id(TOKEN));
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"storage_balance_of");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(0));
            assert_eq!(*prepaid_gas, STORAGE_GAS);
            assert_eq!(
                near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(args).unwrap()["account_id"],
                RECIPIENT
            );
        }
        _ => panic!("wrong storage action"),
    }
    callback_context(
        vec![PromiseResult::Successful(registered())],
        STORAGE_CALLBACK_GAS,
    );
    c.on_native_storage_checked(p, "auth".into(), 1).detach();
    let r = get_created_receipts();
    assert_eq!(r.len(), 2);
    assert_eq!(r[0].receiver_id, id(TOKEN));
    match &r[0].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"ft_transfer");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
            assert_eq!(*prepaid_gas, TRANSFER_GAS);
            let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
            assert_eq!(a["receiver_id"], RECIPIENT);
            assert_eq!(a["amount"], "100000");
            assert_eq!(a["memo"], "disburse:native:v1:0:1");
        }
        _ => panic!("wrong transfer action"),
    }
    assert_eq!(r[1].receiver_id, id(CONTRACT));
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::TransferPending
    );
    assert_eq!(c.get_payout(p).unwrap().status, PayoutStatus::Executing);
    assert_eq!(c.get_campaign_payout_accounting(0).unwrap().spent, U128(0));
}
#[test]
fn private_storage_and_transfer_callbacks_reject_all_foreign_predecessors() {
    let (mut c, p) = started();
    for who in [OWNER, OP, APPROVER, EXECUTOR, TOKEN, RECIPIENT] {
        context(who, NOW);
        reject(&mut c, |c| {
            c.on_native_storage_checked(p, "auth".into(), 1).detach()
        });
        reject(&mut c, |c| c.on_native_transfer_result(p, "auth".into(), 1));
    }
}
#[test]
fn successful_callback_settles_once_and_keeps_actual_runtime_evidence() {
    let (mut c, p) = dispatched();
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    let a = c.get_campaign_payout_accounting(0).unwrap();
    assert_eq!(
        (a.available, a.reserved, a.spent),
        (U128(900_000), U128(0), U128(100_000))
    );
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::Succeeded
    );
    assert_eq!(c.get_payout(p).unwrap().status, PayoutStatus::Succeeded);
    assert_eq!(
        c.get_native_execution_outcome(p, 1).unwrap().kind,
        NativeOutcomeKind::TransferSucceeded
    );
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    reject(&mut c, |c| c.on_native_transfer_result(p, "auth".into(), 1));
    context(EXECUTOR, NOW);
    reject(&mut c, |c| {
        c.begin_native_preflight(p, "auth".into(), 1).detach()
    });
}
#[test]
fn definite_transfer_failure_retains_reservation_and_cannot_retry_or_release() {
    let (mut c, p) = dispatched();
    callback_context(vec![PromiseResult::Failed], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::AttemptFailed
    );
    assert_eq!(
        c.get_native_execution_outcome(p, 1).unwrap().kind,
        NativeOutcomeKind::TransferReceiptFailed
    );
    assert_eq!(
        c.get_campaign_payout_accounting(0).unwrap().reserved,
        U128(100_000)
    );
    assert_eq!(c.get_campaign_payout_accounting(0).unwrap().spent, U128(0));
    context(APPROVER, NOW);
    reject(&mut c, |c| {
        c.approve_native_execution(p, "retry".into(), 2, U64(NOW + 100))
    });
}
#[test]
fn unregistered_storage_and_failed_query_never_schedule_transfer() {
    for (data, kind) in [
        (
            PromiseResult::Successful(b"null".to_vec()),
            NativeOutcomeKind::RecipientUnregistered,
        ),
        (PromiseResult::Failed, NativeOutcomeKind::StorageQueryFailed),
    ] {
        // A fresh mock store is needed for each independently initialized contract fixture.
        context(OWNER, NOW);
        with_mocked_blockchain(|b| b.take_storage());
        let (mut c, p) = started();
        callback_context(vec![data], STORAGE_CALLBACK_GAS);
        c.on_native_storage_checked(p, "auth".into(), 1).detach();
        assert_eq!(
            c.get_native_payout(p).unwrap().status,
            NativeStatus::AttemptFailed
        );
        assert_eq!(c.get_native_execution_outcome(p, 1).unwrap().kind, kind);
        assert!(get_created_receipts().is_empty());
        assert_eq!(c.get_campaign_payout_accounting(0).unwrap().spent, U128(0));
    }
}
#[test]
fn malformed_or_oversized_storage_result_goes_to_locked_manual_review() {
    for bytes in [b"invalid".to_vec(), vec![0; 4097]] {
        context(OWNER, NOW);
        with_mocked_blockchain(|b| b.take_storage());
        let (mut c, p) = started();
        callback_context(vec![PromiseResult::Successful(bytes)], STORAGE_CALLBACK_GAS);
        c.on_native_storage_checked(p, "auth".into(), 1).detach();
        assert_eq!(
            c.get_native_payout(p).unwrap().status,
            NativeStatus::ManualReview
        );
        assert!(get_created_receipts().is_empty());
    }
}
#[test]
fn unexpected_transfer_return_or_result_count_is_uncertain_never_spent() {
    for results in [
        vec![],
        vec![PromiseResult::Successful(vec![]), PromiseResult::Failed],
        vec![PromiseResult::Successful(b"true".to_vec())],
        vec![PromiseResult::Successful(vec![1; 65])],
    ] {
        context(OWNER, NOW);
        with_mocked_blockchain(|b| b.take_storage());
        let (mut c, p) = dispatched();
        callback_context(results, SETTLEMENT_GAS);
        c.on_native_transfer_result(p, "auth".into(), 1);
        assert_eq!(
            c.get_native_payout(p).unwrap().status,
            NativeStatus::ManualReview
        );
        assert_eq!(
            c.get_campaign_payout_accounting(0).unwrap().reserved,
            U128(100_000)
        );
        assert_eq!(c.get_campaign_payout_accounting(0).unwrap().spent, U128(0));
    }
}
#[test]
fn stale_callback_identities_and_binding_corruption_preserve_lock() {
    let (mut c, p) = dispatched();
    for (pid, auth, attempt) in [
        (99, "auth", 1),
        (p, "other", 1),
        (p, "auth", 0),
        (p, "auth", 2),
    ] {
        callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
        reject(&mut c, |c| {
            c.on_native_transfer_result(pid, auth.into(), attempt)
        });
    }
    let mut payout = c.payouts.get(&p).unwrap().clone();
    payout.input_amount = TokenAmount::new(TokenId::near(id(TOKEN)), 100_001, 6);
    c.payouts.insert(p, payout);
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    reject(&mut c, |c| c.on_native_transfer_result(p, "auth".into(), 1));
}
#[test]
fn pause_expiry_or_role_revocation_blocks_dispatch_but_not_committed_transfer_completion() {
    let (mut c, p) = started();
    context(OWNER, NOW);
    c.pause();
    callback_context(
        vec![PromiseResult::Successful(registered())],
        STORAGE_CALLBACK_GAS,
    );
    c.on_native_storage_checked(p, "auth".into(), 1).detach();
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::AttemptFailed
    );
    assert!(get_created_receipts().is_empty());
    context(OWNER, NOW);
    with_mocked_blockchain(|b| b.take_storage());
    let (mut c, p) = dispatched();
    context(OWNER, NOW);
    c.pause();
    c.remove_accepted_token(id(TOKEN));
    c.set_native_role(id(APPROVER), NativeRole::Approver, false);
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::Succeeded
    );
}
#[test]
fn low_prepaid_gas_or_native_balance_fails_before_consumption() {
    let mut c = setup();
    let p = reserve(&mut c, "first");
    approve(&mut c, p, "auth", 1);
    let mut b = VMContextBuilder::new();
    b.current_account_id(id(CONTRACT))
        .predecessor_account_id(id(EXECUTOR))
        .prepaid_gas(Gas::from_tgas(100))
        .block_timestamp(NOW);
    testing_env!(b.build());
    reject(&mut c, |c| {
        c.begin_native_preflight(p, "auth".into(), 1).detach()
    });
    b.prepaid_gas(ENTRY_GAS)
        .account_balance(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    reject(&mut c, |c| {
        c.begin_native_preflight(p, "auth".into(), 1).detach()
    });
    assert_eq!(
        c.get_native_authorization("auth".into()).unwrap().status,
        NativeAuthorizationStatus::Approved
    );
}
#[test]
fn legacy_guards_hold_after_transfer_and_all_native_outcomes() {
    let (mut c, p) = dispatched();
    for phase in [
        NativeStatus::TransferPending,
        NativeStatus::Succeeded,
        NativeStatus::AttemptFailed,
        NativeStatus::ManualReview,
    ] {
        let mut n = c.get_native_payout(p).unwrap();
        n.status = phase;
        Disburse::native_payouts().insert(p, n);
        context(OP, NOW);
        reject_legacy(&mut c, |c| c.start_payout_execution(p, "legacy".into()));
        reject_legacy(&mut c, |c| c.mark_payout_pending_verification(p));
        reject_legacy(&mut c, |c| {
            c.mark_payout_failed(p, definitive_failure("fake"))
        });
        reject_legacy(&mut c, |c| c.move_payout_to_manual_review(p, "fake".into()));
        context(OWNER, NOW);
        c.grant_role(id("verifier.testnet"), UserRole::Verifier);
        context("verifier.testnet", NOW);
        reject_legacy(&mut c, |c| {
            c.settle_payout(p, settlement_evidence(p, id("verifier.testnet")))
        });
        for (mode, reference) in [(0, "f"), (1, "c"), (2, "m")] {
            let evidence = resolution_evidence(
                p,
                id("verifier.testnet"),
                PayoutResolutionOutcome::NonSettlementConfirmed,
                reference,
            );
            reject_legacy(&mut c, |c| match mode {
                0 => c.release_failed_payout_reservation(p, evidence),
                1 => c.confirm_manual_review_execution(p, evidence),
                _ => c.release_manual_review_reservation(p, evidence),
            });
        }
    }
}

#[test]
fn missing_or_multiple_storage_results_and_invalid_balance_keep_review_locked() {
    for results in [
        vec![],
        vec![PromiseResult::Failed, PromiseResult::Failed],
        vec![PromiseResult::Successful(
            br#"{"total":"1","available":"2"}"#.to_vec(),
        )],
    ] {
        context(OWNER, NOW);
        with_mocked_blockchain(|b| b.take_storage());
        let (mut c, p) = started();
        callback_context(results, STORAGE_CALLBACK_GAS);
        c.on_native_storage_checked(p, "auth".into(), 1).detach();
        assert_eq!(
            c.get_native_payout(p).unwrap().status,
            NativeStatus::ManualReview
        );
        assert!(get_created_receipts().is_empty());
        context(APPROVER, NOW);
        reject(&mut c, |c| {
            c.approve_native_execution(p, "retry".into(), 2, U64(NOW + 100))
        });
    }
}
#[test]
fn expired_authorization_is_rechecked_after_storage_query() {
    let (mut c, p) = started();
    let mut b = VMContextBuilder::new();
    b.current_account_id(id(CONTRACT))
        .predecessor_account_id(id(CONTRACT))
        .block_timestamp(NOW + 100)
        .prepaid_gas(STORAGE_CALLBACK_GAS);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        HashMap::new(),
        vec![PromiseResult::Successful(registered())]
    );
    c.on_native_storage_checked(p, "auth".into(), 1).detach();
    assert_eq!(
        c.get_native_execution_outcome(p, 1).unwrap().kind,
        NativeOutcomeKind::PreflightPolicyRejected
    );
    assert!(get_created_receipts().is_empty());
}
#[test]
fn two_callbacks_reload_same_campaign_accounting_instead_of_overwriting() {
    let mut c = setup();
    let p = reserve(&mut c, "one");
    let q = reserve(&mut c, "two");
    approve(&mut c, p, "auth-one", 1);
    approve(&mut c, q, "auth-two", 1);
    for (pid, auth) in [(p, "auth-one"), (q, "auth-two")] {
        context(EXECUTOR, NOW);
        c.begin_native_preflight(pid, auth.into(), 1).detach();
        callback_context(
            vec![PromiseResult::Successful(registered())],
            STORAGE_CALLBACK_GAS,
        );
        c.on_native_storage_checked(pid, auth.into(), 1).detach();
    }
    for (pid, auth) in [(q, "auth-two"), (p, "auth-one")] {
        callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
        c.on_native_transfer_result(pid, auth.into(), 1);
        // A duplicate must not consume the OTHER payout's still-reserved amount.
        callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
        reject(&mut c, |c| c.on_native_transfer_result(pid, auth.into(), 1));
    }
    let a = c.get_campaign_payout_accounting(0).unwrap();
    assert_eq!(
        (a.available, a.reserved, a.spent),
        (U128(800_000), U128(0), U128(200_000))
    );
}
#[test]
fn duplicate_storage_callback_cannot_schedule_a_second_token_call() {
    let (mut c, p) = dispatched();
    callback_context(
        vec![PromiseResult::Successful(registered())],
        STORAGE_CALLBACK_GAS,
    );
    reject(&mut c, |c| {
        c.on_native_storage_checked(p, "auth".into(), 1).detach()
    });
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::TransferPending
    );
}
#[test]
fn callback_after_failed_attempt_cannot_later_settle() {
    let (mut c, p) = dispatched();
    callback_context(vec![PromiseResult::Failed], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    reject(&mut c, |c| c.on_native_transfer_result(p, "auth".into(), 1));
    assert_eq!(c.get_campaign_payout_accounting(0).unwrap().spent, U128(0));
}
#[test]
fn cancelling_campaign_does_not_block_a_dispatched_success_or_release_other_reservations() {
    let (mut c, p) = dispatched();
    context(OWNER, NOW);
    c.cancel_campaign(0);
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    assert_eq!(c.get_campaign(0).unwrap().status, CampaignStatus::Cancelled);
    assert_eq!(
        c.get_campaign_payout_accounting(0).unwrap().spent,
        U128(100_000)
    );
}
#[test]
fn large_payout_id_is_preserved_in_binding_memo_and_callback() {
    let mut c = setup();
    c.next_payout_id = u64::MAX - 1;
    let p = reserve(&mut c, "large");
    assert_eq!(p, u64::MAX - 1);
    approve(&mut c, p, "auth", 1);
    context(EXECUTOR, NOW);
    c.begin_native_preflight(p, "auth".into(), 1).detach();
    callback_context(
        vec![PromiseResult::Successful(registered())],
        STORAGE_CALLBACK_GAS,
    );
    c.on_native_storage_checked(p, "auth".into(), 1).detach();
    callback_context(vec![PromiseResult::Successful(vec![])], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::Succeeded
    );
}
#[test]
fn insufficient_storage_callback_gas_does_not_persist_transfer_pending() {
    let (mut c, p) = started();
    callback_context(
        vec![PromiseResult::Successful(registered())],
        Gas::from_tgas(70),
    );
    reject(&mut c, |c| {
        c.on_native_storage_checked(p, "auth".into(), 1).detach()
    });
    assert_eq!(
        c.get_native_payout(p).unwrap().status,
        NativeStatus::PreflightPending
    );
}
#[test]
fn successful_unit_result_has_no_fabricated_receipt_hash_and_failure_clears_storage_hash() {
    let (mut c, p) = dispatched();
    let waiting = c.get_native_execution_outcome(p, 1).unwrap();
    assert_eq!(waiting.result_hash, [0; 32]);
    assert_eq!(waiting.promise_result_count, U64(0));
    callback_context(vec![PromiseResult::Failed], SETTLEMENT_GAS);
    c.on_native_transfer_result(p, "auth".into(), 1);
    let failed = c.get_native_execution_outcome(p, 1).unwrap();
    assert_eq!(failed.result_hash, [0; 32]);
    assert_eq!(failed.promise_result_count, U64(1));
    assert_eq!(failed.kind, NativeOutcomeKind::TransferReceiptFailed);
}
