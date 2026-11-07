pub mod state;
pub mod types;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::{
    AccountId, PanicOnDefault, PromiseOrValue, env,
    json_types::U128,
    near, require,
    store::{LookupMap, LookupSet},
};
use state::campaign::Campaign;
use state::payout::Payout;
use types::{
    amount::{TokenAmount, TokenId},
    destination::PayoutDestination,
    evidence::{
        ExternalExecutionIdentity, PayoutResolutionEvidence, PayoutResolutionOutcome,
        SettlementEvidence,
    },
    identifier::validate_identifier,
    role::UserRole,
    status::{CampaignStatus, PayoutStatus},
};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CampaignFundingInfo {
    pub campaign_id: u64,
    pub token_id: AccountId,
    pub budget: U128,
    pub funded: U128,
    pub remaining_budget: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenAmountView {
    pub token_id: TokenId,
    pub atomic_amount: U128,
    pub decimals: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayoutView {
    pub id: u64,
    pub campaign_id: u64,
    pub recipient_near_account_id: Option<AccountId>,
    pub input_amount: TokenAmountView,
    pub destination: PayoutDestination,
    pub expected_output_amount: TokenAmountView,
    pub status: PayoutStatus,
    pub created_at_ns: u64,
    pub execution_reference: Option<String>,
    pub settlement_evidence_reference: Option<String>,
    pub lifecycle_reason: Option<String>,
    pub failure_evidence: Option<ExecutionFailureEvidence>,
    pub settlement_evidence: Option<SettlementEvidence>,
    pub resolution_evidence: Option<PayoutResolutionEvidence>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionFailureKind {
    /// The transaction was conclusively rejected before any broadcast occurred.
    RejectedBeforeSubmission,
    /// The source-chain transaction has a terminal reverted/failed result.
    TransactionReverted,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionFailureEvidence {
    pub kind: ExecutionFailureKind,
    pub evidence_reference: String,
    pub reason: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CampaignPayoutAccounting {
    pub campaign_id: u64,
    pub budget: U128,
    pub funded: U128,
    pub reserved: U128,
    pub spent: U128,
    pub available: U128,
}

type SettlementExecutionKey = (String, String, String, Option<String>);

#[derive(Clone)]
struct PayoutRequest {
    campaign_id: u64,
    recipient_near_account_id: Option<AccountId>,
    destination: PayoutDestination,
    input_amount: TokenAmount,
    expected_output_amount: TokenAmount,
}

struct CampaignFundingMessage {
    campaign_id: u64,
}

impl<'de> near_sdk::serde::Deserialize<'de> for CampaignFundingMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: near_sdk::serde::Deserializer<'de>,
    {
        struct FundingMessageVisitor;

        impl<'de> near_sdk::serde::de::Visitor<'de> for FundingMessageVisitor {
            type Value = CampaignFundingMessage;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an object containing exactly one unsigned campaign_id")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: near_sdk::serde::de::MapAccess<'de>,
            {
                let mut campaign_id = None;
                while let Some(field) = map.next_key::<String>()? {
                    if field != "campaign_id" {
                        return Err(near_sdk::serde::de::Error::unknown_field(
                            &field,
                            &["campaign_id"],
                        ));
                    }
                    if campaign_id.is_some() {
                        return Err(near_sdk::serde::de::Error::duplicate_field("campaign_id"));
                    }
                    campaign_id = Some(map.next_value::<u64>()?);
                }

                let campaign_id = campaign_id
                    .ok_or_else(|| near_sdk::serde::de::Error::missing_field("campaign_id"))?;
                Ok(CampaignFundingMessage { campaign_id })
            }
        }

        deserializer.deserialize_map(FundingMessageVisitor)
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Disburse {
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

#[near]
impl Disburse {
    #[init]
    pub fn new() -> Self {
        Self {
            owner_id: env::predecessor_account_id(),
            paused: false,
            next_campaign_id: 0,
            campaigns: LookupMap::new(b"campaigns".to_vec()),
            roles: LookupSet::new(b"role-assignments".to_vec()),
            accepted_tokens: LookupSet::new(b"accepted-ft-tokens".to_vec()),
            next_payout_id: 0,
            payouts: LookupMap::new(b"payout-records".to_vec()),
            payout_idempotency: LookupMap::new(b"payout-idempotency".to_vec()),
        }
    }

    pub fn create_campaign(&mut self, title: String, token_id: AccountId, budget: u128) -> u64 {
        require!(!self.paused, "Contract is paused");
        require!(!title.trim().is_empty(), "Campaign title cannot be empty");
        require!(title.len() <= 100, "Campaign title cannot exceed 100 bytes");
        require!(budget > 0, "Campaign budget must be greater than zero");

        let campaign_id = self.next_campaign_id;
        self.next_campaign_id = self
            .next_campaign_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Campaign ID overflow"));

        let campaign = Campaign {
            id: campaign_id,
            creator_id: env::predecessor_account_id(),
            title,
            token_id,
            budget,
            funded: 0,
            reserved: 0,
            spent: 0,
            status: types::status::CampaignStatus::Draft,
            created_at_ns: env::block_timestamp(),
        };

        self.campaigns.insert(campaign_id, campaign);
        env::log_str(&format!("CampaignCreated:{campaign_id}"));
        campaign_id
    }

    pub fn get_campaign(&self, campaign_id: u64) -> Option<Campaign> {
        self.campaigns.get(&campaign_id).cloned()
    }

    pub fn get_campaign_count(&self) -> u64 {
        self.next_campaign_id
    }

    /// Add a NEP-141 token contract to the funding allowlist. This is a trust decision about
    /// that contract's NEP-141 behavior. Duplicate additions are no-ops.
    pub fn add_accepted_token(&mut self, token_id: AccountId) {
        let actor_id = env::predecessor_account_id();
        self.assert_owner();
        if !self.accepted_tokens.insert(token_id.clone()) {
            return;
        }
        self.emit_event(
            "accepted_token_added",
            near_sdk::serde_json::json!({
                "token_id": token_id,
                "actor_id": actor_id,
            }),
        );
    }

    /// Remove a token from future funding acceptance; campaign funding history is retained.
    pub fn remove_accepted_token(&mut self, token_id: AccountId) {
        let actor_id = env::predecessor_account_id();
        self.assert_owner();
        require!(
            self.accepted_tokens.remove(&token_id),
            "Token is not accepted"
        );
        self.emit_event(
            "accepted_token_removed",
            near_sdk::serde_json::json!({
                "token_id": token_id,
                "actor_id": actor_id,
            }),
        );
    }

    pub fn is_accepted_token(&self, token_id: AccountId) -> bool {
        self.accepted_tokens.contains(&token_id)
    }

    /// Returns atomic amounts as JSON decimal strings via NEAR's `U128` wrapper.
    pub fn get_campaign_funding(&self, campaign_id: u64) -> Option<CampaignFundingInfo> {
        self.campaigns.get(&campaign_id).map(|campaign| {
            let remaining_budget = campaign
                .budget
                .checked_sub(campaign.funded)
                .unwrap_or_else(|| env::panic_str("Campaign funding invariant violated"));
            CampaignFundingInfo {
                campaign_id,
                token_id: campaign.token_id.clone(),
                budget: U128(campaign.budget),
                funded: U128(campaign.funded),
                remaining_budget: U128(remaining_budget),
            }
        })
    }

    /// Authorize a payout and reserve its campaign input amount. This does not execute it.
    pub fn create_payout(
        &mut self,
        campaign_id: u64,
        idempotency_key: String,
        recipient_near_account_id: Option<AccountId>,
        destination: PayoutDestination,
        input_amount: TokenAmount,
        expected_output_amount: TokenAmount,
    ) -> u64 {
        self.assert_campaign_operations_enabled();
        let actor_id = env::predecessor_account_id();
        require!(
            self.is_operator_or_administrator(&actor_id),
            "Operator or administrator role required to create payouts"
        );
        require!(
            validate_identifier(&idempotency_key).is_ok(),
            "Idempotency key cannot be empty"
        );
        require!(
            input_amount.atomic_amount() > 0,
            "Input amount must be greater than zero"
        );
        require!(
            expected_output_amount.atomic_amount() > 0,
            "Expected output amount must be greater than zero"
        );

        let request = PayoutRequest {
            campaign_id,
            recipient_near_account_id,
            destination,
            input_amount,
            expected_output_amount,
        };
        let idempotency_index = (campaign_id, idempotency_key);
        if let Some(existing_id) = self.payout_idempotency.get(&idempotency_index).copied() {
            let existing = self
                .payouts
                .get(&existing_id)
                .unwrap_or_else(|| env::panic_str("Payout idempotency invariant violated"));
            require!(
                Self::payout_matches_request(existing, &request),
                "Idempotency key reused with different payout details"
            );
            return existing_id;
        }

        let mut campaign = self.campaign_or_panic(campaign_id);
        self.require_campaign_status(&campaign, CampaignStatus::Active, "create payout for");
        require!(
            request.input_amount.token_id().near_account_id() == Some(&campaign.token_id),
            "Payout input token must match campaign funding token"
        );
        let available = Self::available_campaign_funds(&campaign);
        require!(
            request.input_amount.atomic_amount() <= available,
            "Insufficient available campaign funds"
        );
        let new_reserved = campaign
            .reserved
            .checked_add(request.input_amount.atomic_amount())
            .unwrap_or_else(|| env::panic_str("Campaign reservation overflow"));
        let new_committed = new_reserved
            .checked_add(campaign.spent)
            .unwrap_or_else(|| env::panic_str("Campaign accounting overflow"));
        require!(
            new_committed <= campaign.funded,
            "Campaign accounting invariant violated"
        );

        let payout_id = self.next_payout_id;
        let next_payout_id = payout_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Payout ID overflow"));
        require!(
            !self.payouts.contains_key(&payout_id),
            "Payout ID collision"
        );

        let mut payout = Payout {
            id: payout_id,
            campaign_id,
            recipient_near_account_id: request.recipient_near_account_id,
            input_amount: request.input_amount,
            destination: request.destination,
            expected_output_amount: request.expected_output_amount,
            status: PayoutStatus::Created,
            created_at_ns: env::block_timestamp(),
            execution_reference: None,
            settlement_evidence_reference: None,
        };
        payout.status = PayoutStatus::Authorized;
        campaign.reserved = new_reserved;
        payout.status = PayoutStatus::Reserved;

        self.campaigns.insert(campaign_id, campaign);
        self.payouts.insert(payout_id, payout.clone());
        self.payout_idempotency.insert(idempotency_index, payout_id);
        self.next_payout_id = next_payout_id;
        self.emit_event("payout_reserved", near_sdk::serde_json::json!({
            "payout_id": payout_id,
            "campaign_id": campaign_id,
            "actor_id": actor_id,
            "input_token_id": Self::token_id_string(payout.input_amount.token_id()),
            "input_amount": payout.input_amount.atomic_amount().to_string(),
            "expected_output_token_id": Self::token_id_string(payout.expected_output_amount.token_id()),
            "expected_output_amount": payout.expected_output_amount.atomic_amount().to_string(),
            "status": "Reserved",
        }));
        payout_id
    }

    pub fn get_payout(&self, payout_id: u64) -> Option<PayoutView> {
        self.payouts
            .get(&payout_id)
            .map(|payout| self.payout_view(payout))
    }

    pub fn get_campaign_payout(&self, campaign_id: u64, payout_id: u64) -> Option<PayoutView> {
        self.payouts
            .get(&payout_id)
            .filter(|payout| payout.campaign_id == campaign_id)
            .map(|payout| self.payout_view(payout))
    }

    pub fn get_payout_by_idempotency(
        &self,
        campaign_id: u64,
        idempotency_key: String,
    ) -> Option<PayoutView> {
        self.payout_idempotency
            .get(&(campaign_id, idempotency_key))
            .and_then(|id| self.payouts.get(id))
            .map(|payout| self.payout_view(payout))
    }

    pub fn get_campaign_payout_accounting(
        &self,
        campaign_id: u64,
    ) -> Option<CampaignPayoutAccounting> {
        self.campaigns
            .get(&campaign_id)
            .map(|campaign| CampaignPayoutAccounting {
                campaign_id,
                budget: U128(campaign.budget),
                funded: U128(campaign.funded),
                reserved: U128(campaign.reserved),
                spent: U128(campaign.spent),
                available: U128(Self::available_campaign_funds(campaign)),
            })
    }

    /// Begin the off-chain execution phase. No transaction is submitted by this contract.
    pub fn start_payout_execution(&mut self, payout_id: u64, execution_reference: String) {
        self.assert_campaign_operations_enabled();
        let actor_id = self.assert_payout_operator_or_administrator();
        require!(
            validate_identifier(&execution_reference).is_ok(),
            "Execution reference cannot be empty"
        );
        require!(
            execution_reference.len() <= 256,
            "Execution reference cannot exceed 256 bytes"
        );
        let mut payout = self.payout_or_panic(payout_id);
        require!(
            payout.status == PayoutStatus::Reserved,
            "Payout must be Reserved to start execution"
        );
        require!(
            Self::execution_references()
                .get(&execution_reference)
                .is_none(),
            "Execution reference has already been used"
        );

        let previous_status = payout.status;
        payout.status = PayoutStatus::Executing;
        payout.execution_reference = Some(execution_reference.clone());
        self.payouts.insert(payout_id, payout.clone());
        Self::execution_references().insert(execution_reference.clone(), payout_id);
        self.emit_event(
            "payout_execution_started",
            near_sdk::serde_json::json!({
                "payout_id": payout_id,
                "campaign_id": payout.campaign_id,
                "actor_id": actor_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "execution_reference": execution_reference,
            }),
        );
    }

    /// Records that execution was submitted or acknowledged; it is not settlement evidence.
    pub fn mark_payout_pending_verification(&mut self, payout_id: u64) {
        self.assert_campaign_operations_enabled();
        let actor_id = self.assert_payout_operator_or_administrator();
        let mut payout = self.payout_or_panic(payout_id);
        require!(
            payout.status == PayoutStatus::Executing,
            "Payout must be Executing before submission can be recorded"
        );
        let execution_reference = payout
            .execution_reference
            .clone()
            .unwrap_or_else(|| env::panic_str("Execution reference is missing"));
        require!(
            Self::execution_references().get(&execution_reference) == Some(&payout_id),
            "Execution reference index is inconsistent"
        );
        let previous_status = payout.status;
        payout.status = PayoutStatus::PendingVerification;
        self.payouts.insert(payout_id, payout.clone());
        self.emit_event(
            "payout_pending_verification",
            near_sdk::serde_json::json!({
                "payout_id": payout_id,
                "campaign_id": payout.campaign_id,
                "actor_id": actor_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "execution_reference": execution_reference,
            }),
        );
    }

    /// Records a terminal execution failure. The privileged caller attests the supplied evidence;
    /// the contract does not independently query a source chain or verify the evidence reference.
    pub fn mark_payout_failed(&mut self, payout_id: u64, evidence: ExecutionFailureEvidence) {
        let actor_id = self.assert_payout_operator_or_administrator();
        require!(
            validate_identifier(&evidence.reason).is_ok(),
            "Failure reason cannot be empty"
        );
        require!(
            evidence.reason.len() <= 512,
            "Failure reason cannot exceed 512 bytes"
        );
        require!(
            validate_identifier(&evidence.evidence_reference).is_ok(),
            "Failure evidence reference cannot be empty"
        );
        require!(
            evidence.evidence_reference.len() <= 256,
            "Failure evidence reference cannot exceed 256 bytes"
        );
        let mut payout = self.payout_or_panic(payout_id);
        require!(
            matches!(
                payout.status,
                PayoutStatus::Executing | PayoutStatus::PendingVerification
            ),
            "Only executing or pending payouts can be marked Failed"
        );
        require!(
            payout.status != PayoutStatus::PendingVerification
                || evidence.kind != ExecutionFailureKind::RejectedBeforeSubmission,
            "A submitted payout cannot use pre-submission rejection evidence"
        );
        let previous_status = payout.status;
        payout.status = PayoutStatus::Failed;
        self.payouts.insert(payout_id, payout.clone());
        Self::payout_lifecycle_reasons().insert(payout_id, evidence.reason.clone());
        Self::payout_failure_evidence().insert(payout_id, evidence.clone());
        self.emit_event(
            "payout_execution_failed",
            near_sdk::serde_json::json!({
                "payout_id": payout_id,
                "campaign_id": payout.campaign_id,
                "actor_id": actor_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "execution_reference": payout.execution_reference,
                "failure_kind": evidence.kind,
                "evidence_reference": evidence.evidence_reference,
                "reason": evidence.reason,
            }),
        );
    }

    /// Paused contracts still allow an authorized operator to quarantine uncertain execution.
    pub fn move_payout_to_manual_review(&mut self, payout_id: u64, reason: String) {
        let actor_id = self.assert_payout_operator_or_administrator();
        require!(
            validate_identifier(&reason).is_ok(),
            "Manual review reason cannot be empty"
        );
        require!(
            reason.len() <= 512,
            "Manual review reason cannot exceed 512 bytes"
        );
        let mut payout = self.payout_or_panic(payout_id);
        require!(
            matches!(
                payout.status,
                PayoutStatus::Executing | PayoutStatus::PendingVerification
            ),
            "Only executing or pending payouts can enter ManualReview"
        );
        let previous_status = payout.status;
        payout.status = PayoutStatus::ManualReview;
        self.payouts.insert(payout_id, payout.clone());
        Self::payout_lifecycle_reasons().insert(payout_id, reason.clone());
        self.emit_event(
            "payout_manual_review",
            near_sdk::serde_json::json!({
                "payout_id": payout_id,
                "campaign_id": payout.campaign_id,
                "actor_id": actor_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "execution_reference": payout.execution_reference,
                "reason": reason,
            }),
        );
    }

    /// Release a Failed payout's reservation after explicit verifier attestation of
    /// non-settlement. Existing failure evidence is required as the basis for review.
    pub fn release_failed_payout_reservation(
        &mut self,
        payout_id: u64,
        evidence: PayoutResolutionEvidence,
    ) {
        let actor_id = self.assert_verifier();
        let payout = self.payout_or_panic(payout_id);
        require!(
            payout.status == PayoutStatus::Failed,
            "Only Failed payouts can use failed-payout recovery"
        );
        require!(
            Self::payout_failure_evidence().get(&payout_id).is_some(),
            "Failure evidence is required before releasing a Failed payout"
        );
        let execution_key = Self::validate_resolution_evidence(
            payout_id,
            &actor_id,
            &evidence,
            PayoutResolutionOutcome::NonSettlementConfirmed,
        );
        self.assert_recovery_evidence_available(&evidence, execution_key.as_ref());
        self.release_reservation_with_evidence(
            payout,
            evidence,
            execution_key,
            "failed_payout_reservation_released",
        );
    }

    /// Reconcile ManualReview as an executed payout and return it to the normal
    /// PendingVerification → Succeeded settlement path without moving accounting.
    pub fn confirm_manual_review_execution(
        &mut self,
        payout_id: u64,
        evidence: PayoutResolutionEvidence,
    ) {
        let actor_id = self.assert_verifier();
        let mut payout = self.payout_or_panic(payout_id);
        require!(
            payout.status == PayoutStatus::ManualReview,
            "Only ManualReview payouts can be confirmed executed"
        );
        let execution_reference = payout
            .execution_reference
            .clone()
            .unwrap_or_else(|| env::panic_str("Execution reference is missing"));
        require!(
            Self::execution_references().get(&execution_reference) == Some(&payout_id),
            "Execution reference index is inconsistent"
        );
        let execution_key = Self::validate_resolution_evidence(
            payout_id,
            &actor_id,
            &evidence,
            PayoutResolutionOutcome::ExecutionConfirmed,
        );
        self.assert_recovery_evidence_available(&evidence, execution_key.as_ref());

        let previous_status = payout.status;
        payout.status = PayoutStatus::PendingVerification;
        self.payouts.insert(payout_id, payout.clone());
        Self::payout_resolution_evidence().insert(payout_id, evidence.clone());
        Self::index_resolution_evidence(&evidence, execution_key);
        self.emit_event(
            "manual_review_execution_confirmed",
            near_sdk::serde_json::json!({
                "payout_id": payout_id,
                "campaign_id": payout.campaign_id,
                "verifier_id": actor_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "execution_reference": execution_reference,
                "evidence_reference": evidence.evidence_reference,
            }),
        );
    }

    /// Release a ManualReview payout only after structured verifier attestation that it
    /// definitely did not settle. Uncertain outcomes must remain reserved for review.
    pub fn release_manual_review_reservation(
        &mut self,
        payout_id: u64,
        evidence: PayoutResolutionEvidence,
    ) {
        let actor_id = self.assert_verifier();
        let payout = self.payout_or_panic(payout_id);
        require!(
            payout.status == PayoutStatus::ManualReview,
            "Only ManualReview payouts can be resolved as non-settled"
        );
        let execution_key = Self::validate_resolution_evidence(
            payout_id,
            &actor_id,
            &evidence,
            PayoutResolutionOutcome::NonSettlementConfirmed,
        );
        self.assert_recovery_evidence_available(&evidence, execution_key.as_ref());
        self.release_reservation_with_evidence(
            payout,
            evidence,
            execution_key,
            "manual_review_non_settlement_confirmed",
        );
    }

    /// Settle only a pending payout based on an explicit trusted-verifier attestation.
    /// Settlement remains available while globally paused so already-submitted external
    /// executions can be reconciled. The contract matches normalized claims and updates
    /// reservation accounting, but does not independently verify the destination-chain
    /// transaction or content hash. Token decimals are not authoritative; equality uses token
    /// identity and atomic amount.
    pub fn settle_payout(&mut self, payout_id: u64, evidence: SettlementEvidence) {
        let actor_id = env::predecessor_account_id();
        require!(
            self.has_direct_role(&actor_id, UserRole::Verifier),
            "Explicit Verifier role required to settle payouts"
        );

        let mut payout = self.payout_or_panic(payout_id);
        require!(
            payout.status == PayoutStatus::PendingVerification,
            "Only PendingVerification payouts can be settled"
        );
        require!(
            evidence.payout_id == payout_id,
            "Evidence payout ID does not match"
        );
        require!(
            evidence.verifier_id == actor_id,
            "Evidence verifier must match the calling account"
        );
        require!(
            validate_identifier(&evidence.provider_id).is_ok() && evidence.provider_id.len() <= 64,
            "Provider identifier must be nonempty and at most 64 bytes"
        );
        require!(
            evidence.destination_chain_id.as_str().len() <= 128,
            "Destination chain identifier cannot exceed 128 bytes"
        );
        require!(
            evidence.recipient_address.as_str().len() <= 256,
            "Recipient address cannot exceed 256 bytes"
        );
        require!(
            Self::token_id_string(evidence.output_amount.token_id()).len() <= 256,
            "Output token identifier cannot exceed 256 bytes"
        );
        require!(
            validate_identifier(&evidence.destination_transaction_reference).is_ok()
                && evidence.destination_transaction_reference.len() <= 256,
            "Execution identifier must be nonempty and at most 256 bytes"
        );
        if let Some(event_identifier) = &evidence.transaction_event_identifier {
            require!(
                validate_identifier(event_identifier).is_ok() && event_identifier.len() <= 128,
                "Transaction event identifier must be nonempty and at most 128 bytes"
            );
        }
        let evidence_reference = evidence
            .evidence_reference
            .as_ref()
            .unwrap_or_else(|| env::panic_str("Evidence reference is required"))
            .clone();
        require!(
            validate_identifier(&evidence_reference).is_ok() && evidence_reference.len() <= 256,
            "Evidence reference must be nonempty and at most 256 bytes"
        );
        require!(
            validate_identifier(&evidence.verification_method).is_ok()
                && evidence.verification_method.len() <= 128,
            "Verification method must be nonempty and at most 128 bytes"
        );
        require!(
            evidence.content_hash.len() == 64
                && evidence
                    .content_hash
                    .bytes()
                    .all(|byte| { byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) }),
            "Content hash must be 64 lowercase hexadecimal SHA-256 characters"
        );
        require!(
            evidence.destination_chain_id == payout.destination.chain_id,
            "Evidence destination chain does not match payout"
        );
        require!(
            evidence.recipient_address == payout.destination.recipient_address,
            "Evidence recipient does not match payout"
        );
        require!(
            evidence.output_amount.token_id() == payout.expected_output_amount.token_id(),
            "Evidence output token does not match payout"
        );
        require!(
            evidence.output_amount.atomic_amount() == payout.expected_output_amount.atomic_amount(),
            "Evidence output amount does not match payout"
        );

        let execution_key = Self::settlement_execution_key(&evidence);
        if let Some(existing_payout_id) = Self::settlement_execution_index().get(&execution_key) {
            require!(
                *existing_payout_id == payout_id,
                "Settlement execution evidence has already been used"
            );
            let resolution_map = Self::payout_resolution_evidence();
            let resolution = resolution_map.get(&payout_id);
            require!(
                resolution.is_some_and(|resolution| {
                    resolution.outcome == PayoutResolutionOutcome::ExecutionConfirmed
                        && resolution
                            .external_execution
                            .as_ref()
                            .is_some_and(|identity| {
                                Self::external_execution_key(identity) == execution_key
                            })
                }),
                "Execution identity is reserved by a different payout resolution"
            );
        }
        require!(
            Self::settlement_reference_index()
                .get(&evidence_reference)
                .is_none(),
            "Settlement evidence reference has already been used"
        );

        let mut campaign = self.campaign_or_panic(payout.campaign_id);
        require!(
            payout.input_amount.token_id().near_account_id() == Some(&campaign.token_id),
            "Payout input token does not match campaign funding token"
        );
        require!(
            campaign.funded <= campaign.budget,
            "Campaign funding invariant violated"
        );
        let old_committed = campaign
            .reserved
            .checked_add(campaign.spent)
            .unwrap_or_else(|| env::panic_str("Campaign accounting overflow"));
        require!(
            old_committed <= campaign.funded,
            "Campaign accounting invariant violated"
        );
        let new_reserved = campaign
            .reserved
            .checked_sub(payout.input_amount.atomic_amount())
            .unwrap_or_else(|| env::panic_str("Campaign reserved balance underflow"));
        let new_spent = campaign
            .spent
            .checked_add(payout.input_amount.atomic_amount())
            .unwrap_or_else(|| env::panic_str("Campaign spent balance overflow"));
        let new_committed = new_reserved
            .checked_add(new_spent)
            .unwrap_or_else(|| env::panic_str("Campaign accounting overflow"));
        require!(
            new_committed <= campaign.funded && campaign.funded <= campaign.budget,
            "Campaign accounting invariant violated"
        );

        let previous_status = payout.status;
        campaign.reserved = new_reserved;
        campaign.spent = new_spent;
        payout.status = PayoutStatus::Succeeded;
        payout.settlement_evidence_reference = Some(evidence_reference.clone());

        self.campaigns.insert(campaign.id, campaign);
        self.payouts.insert(payout_id, payout.clone());
        Self::payout_settlement_evidence().insert(payout_id, evidence.clone());
        if Self::settlement_execution_index()
            .get(&execution_key)
            .is_none()
        {
            Self::settlement_execution_index().insert(execution_key, payout_id);
        }
        Self::settlement_reference_index().insert(evidence_reference.clone(), payout_id);
        self.emit_event(
            "payout_settled",
            near_sdk::serde_json::json!({
                "payout_id": payout_id,
                "campaign_id": payout.campaign_id,
                "verifier_id": actor_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "destination_chain_id": evidence.destination_chain_id.as_str(),
                "provider_id": evidence.provider_id,
                "execution_id": evidence.destination_transaction_reference,
                "transaction_event_identifier": evidence.transaction_event_identifier,
                "output_token_id": Self::token_id_string(evidence.output_amount.token_id()),
                "recipient_address": evidence.recipient_address.as_str(),
                "actual_output_amount": evidence.output_amount.atomic_amount().to_string(),
                "evidence_reference": evidence_reference,
                "content_hash": evidence.content_hash,
                "input_amount_moved_to_spent": payout.input_amount.atomic_amount().to_string(),
            }),
        );
    }

    /// Grant a non-owner role. The owner is the only grant authority and cannot self-grant.
    pub fn grant_role(&mut self, account_id: AccountId, role: UserRole) {
        let actor_id = env::predecessor_account_id();
        self.assert_owner();
        require!(role != UserRole::Owner, "Owner role cannot be granted");
        require!(account_id != actor_id, "Cannot grant a role to yourself");

        if !self.roles.insert((account_id.clone(), role)) {
            return;
        }

        self.emit_event(
            "role_granted",
            near_sdk::serde_json::json!({
                "account_id": account_id,
                "role": Self::role_name(role),
                "actor_id": actor_id,
            }),
        );
    }

    /// Revoke a role; revoking an absent assignment fails clearly.
    pub fn revoke_role(&mut self, account_id: AccountId, role: UserRole) {
        let actor_id = env::predecessor_account_id();
        self.assert_owner();
        require!(role != UserRole::Owner, "Owner role cannot be revoked");
        require!(
            account_id != self.owner_id || role != UserRole::Administrator,
            "Owner administrative authority cannot be revoked"
        );
        require!(
            self.roles.remove(&(account_id.clone(), role)),
            "Role is not assigned"
        );

        self.emit_event(
            "role_revoked",
            near_sdk::serde_json::json!({
                "account_id": account_id,
                "role": Self::role_name(role),
                "actor_id": actor_id,
            }),
        );
    }

    /// The owner has implicit Owner and Administrator roles; other roles are explicit.
    pub fn has_role(&self, account_id: AccountId, role: UserRole) -> bool {
        if account_id == self.owner_id {
            return matches!(role, UserRole::Owner | UserRole::Administrator)
                || self.has_direct_role(&account_id, role);
        }
        self.has_direct_role(&account_id, role)
    }

    pub fn approve_campaign(&mut self, campaign_id: u64) {
        self.assert_campaign_operations_enabled();
        let actor_id = env::predecessor_account_id();
        require!(
            self.is_administrator(&actor_id),
            "Administrator role required to approve campaigns"
        );
        let campaign = self.campaign_or_panic(campaign_id);
        self.require_campaign_status(&campaign, CampaignStatus::Draft, "approve");
        self.set_campaign_status(
            campaign,
            CampaignStatus::Approved,
            "campaign_approved",
            actor_id,
        );
    }

    pub fn activate_campaign(&mut self, campaign_id: u64) {
        self.assert_campaign_operations_enabled();
        let actor_id = env::predecessor_account_id();
        require!(
            self.has_direct_role(&actor_id, UserRole::Operator),
            "Operator role required to activate campaigns"
        );
        let campaign = self.campaign_or_panic(campaign_id);
        self.require_campaign_status(&campaign, CampaignStatus::Approved, "activate");
        self.set_campaign_status(
            campaign,
            CampaignStatus::Active,
            "campaign_activated",
            actor_id,
        );
    }

    pub fn pause_campaign(&mut self, campaign_id: u64) {
        self.assert_campaign_operations_enabled();
        let actor_id = env::predecessor_account_id();
        require!(
            self.is_operator_or_administrator(&actor_id),
            "Operator or administrator role required to pause campaigns"
        );
        let campaign = self.campaign_or_panic(campaign_id);
        self.require_campaign_status(&campaign, CampaignStatus::Active, "pause");
        self.set_campaign_status(
            campaign,
            CampaignStatus::Paused,
            "campaign_paused",
            actor_id,
        );
    }

    pub fn resume_campaign(&mut self, campaign_id: u64) {
        self.assert_campaign_operations_enabled();
        let actor_id = env::predecessor_account_id();
        require!(
            self.is_operator_or_administrator(&actor_id),
            "Operator or administrator role required to resume campaigns"
        );
        let campaign = self.campaign_or_panic(campaign_id);
        self.require_campaign_status(&campaign, CampaignStatus::Paused, "resume");
        self.set_campaign_status(
            campaign,
            CampaignStatus::Active,
            "campaign_resumed",
            actor_id,
        );
    }

    pub fn cancel_campaign(&mut self, campaign_id: u64) {
        self.assert_campaign_operations_enabled();
        let actor_id = env::predecessor_account_id();
        let campaign = self.campaign_or_panic(campaign_id);
        let is_administrator = self.is_administrator(&actor_id);

        let authorized = match campaign.status {
            CampaignStatus::Draft | CampaignStatus::Approved => {
                actor_id == campaign.creator_id || is_administrator
            }
            CampaignStatus::Active | CampaignStatus::Paused => is_administrator,
            CampaignStatus::Completed | CampaignStatus::Cancelled => false,
        };
        require!(
            authorized,
            match campaign.status {
                CampaignStatus::Draft | CampaignStatus::Approved => {
                    "Only the campaign creator or an administrator can cancel this campaign"
                }
                CampaignStatus::Active | CampaignStatus::Paused => {
                    "Administrator role required to cancel an active campaign"
                }
                CampaignStatus::Completed => "Completed campaigns cannot be cancelled",
                CampaignStatus::Cancelled => "Cancelled campaigns cannot be cancelled again",
            }
        );

        self.set_campaign_status(
            campaign,
            CampaignStatus::Cancelled,
            "campaign_cancelled",
            actor_id,
        );
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the contract owner can perform this action"
        );
    }

    fn has_direct_role(&self, account_id: &AccountId, role: UserRole) -> bool {
        self.roles.contains(&(account_id.clone(), role))
    }

    fn is_administrator(&self, account_id: &AccountId) -> bool {
        account_id == &self.owner_id || self.has_direct_role(account_id, UserRole::Administrator)
    }

    fn is_operator_or_administrator(&self, account_id: &AccountId) -> bool {
        self.is_administrator(account_id) || self.has_direct_role(account_id, UserRole::Operator)
    }

    fn assert_campaign_operations_enabled(&self) {
        require!(!self.paused, "Contract is paused");
    }

    fn assert_payout_operator_or_administrator(&self) -> AccountId {
        let actor_id = env::predecessor_account_id();
        require!(
            self.is_operator_or_administrator(&actor_id),
            "Operator or administrator role required for payout lifecycle"
        );
        actor_id
    }

    fn assert_verifier(&self) -> AccountId {
        let actor_id = env::predecessor_account_id();
        require!(
            self.has_direct_role(&actor_id, UserRole::Verifier),
            "Explicit Verifier role required for payout recovery"
        );
        actor_id
    }

    fn validate_resolution_evidence(
        payout_id: u64,
        actor_id: &AccountId,
        evidence: &PayoutResolutionEvidence,
        expected_outcome: PayoutResolutionOutcome,
    ) -> Option<SettlementExecutionKey> {
        require!(
            evidence.payout_id == payout_id,
            "Resolution payout ID does not match"
        );
        require!(
            &evidence.verifier_id == actor_id,
            "Resolution verifier must match the calling account"
        );
        require!(
            evidence.outcome == expected_outcome,
            "Resolution outcome does not match the requested recovery path"
        );
        require!(
            evidence.verified_at_ns > 0,
            "Resolution verification timestamp must be nonzero"
        );
        require!(
            validate_identifier(&evidence.verification_method).is_ok()
                && evidence.verification_method.len() <= 128,
            "Verification method must be nonempty and at most 128 bytes"
        );
        require!(
            validate_identifier(&evidence.evidence_reference).is_ok()
                && evidence.evidence_reference.len() <= 256,
            "Resolution evidence reference must be nonempty and at most 256 bytes"
        );
        require!(
            evidence.content_hash.len() == 64
                && evidence
                    .content_hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            "Content hash must be 64 lowercase hexadecimal SHA-256 characters"
        );
        require!(
            validate_identifier(&evidence.reason).is_ok() && evidence.reason.len() <= 512,
            "Resolution reason must be nonempty and at most 512 bytes"
        );

        let execution_key = evidence.external_execution.as_ref().map(|identity| {
            require!(
                validate_identifier(&identity.provider_id).is_ok()
                    && identity.provider_id.len() <= 64,
                "Provider identifier must be nonempty and at most 64 bytes"
            );
            require!(
                identity.destination_chain_id.as_str().len() <= 128,
                "Destination chain identifier cannot exceed 128 bytes"
            );
            require!(
                validate_identifier(&identity.execution_reference).is_ok()
                    && identity.execution_reference.len() <= 256,
                "Execution identifier must be nonempty and at most 256 bytes"
            );
            if let Some(event_identifier) = &identity.transaction_event_identifier {
                require!(
                    validate_identifier(event_identifier).is_ok() && event_identifier.len() <= 128,
                    "Transaction event identifier must be nonempty and at most 128 bytes"
                );
            }
            Self::external_execution_key(identity)
        });
        require!(
            expected_outcome != PayoutResolutionOutcome::ExecutionConfirmed
                || execution_key.is_some(),
            "Execution confirmation requires an external execution identity"
        );
        execution_key
    }

    fn external_execution_key(identity: &ExternalExecutionIdentity) -> SettlementExecutionKey {
        (
            identity.provider_id.clone(),
            identity.destination_chain_id.as_str().to_string(),
            identity.execution_reference.clone(),
            identity.transaction_event_identifier.clone(),
        )
    }

    fn settlement_execution_key(evidence: &SettlementEvidence) -> SettlementExecutionKey {
        (
            evidence.provider_id.clone(),
            evidence.destination_chain_id.as_str().to_string(),
            evidence.destination_transaction_reference.clone(),
            evidence.transaction_event_identifier.clone(),
        )
    }

    fn assert_recovery_evidence_available(
        &self,
        evidence: &PayoutResolutionEvidence,
        execution_key: Option<&SettlementExecutionKey>,
    ) {
        require!(
            Self::settlement_reference_index()
                .get(&evidence.evidence_reference)
                .is_none(),
            "Resolution evidence reference has already been used"
        );
        if let Some(execution_key) = execution_key {
            require!(
                Self::settlement_execution_index()
                    .get(execution_key)
                    .is_none(),
                "External execution identity has already been used"
            );
        }
    }

    fn index_resolution_evidence(
        evidence: &PayoutResolutionEvidence,
        execution_key: Option<SettlementExecutionKey>,
    ) {
        Self::settlement_reference_index()
            .insert(evidence.evidence_reference.clone(), evidence.payout_id);
        if let Some(execution_key) = execution_key {
            Self::settlement_execution_index().insert(execution_key, evidence.payout_id);
        }
    }

    fn release_reservation_with_evidence(
        &mut self,
        mut payout: Payout,
        evidence: PayoutResolutionEvidence,
        execution_key: Option<SettlementExecutionKey>,
        event: &str,
    ) {
        require!(
            matches!(
                payout.status,
                PayoutStatus::Failed | PayoutStatus::ManualReview
            ),
            "Payout is not eligible for reservation release"
        );
        let mut campaign = self.campaign_or_panic(payout.campaign_id);
        require!(
            payout.input_amount.token_id().near_account_id() == Some(&campaign.token_id),
            "Payout input token does not match campaign funding token"
        );
        require!(
            campaign.funded <= campaign.budget,
            "Campaign funding invariant violated"
        );
        let committed = campaign
            .reserved
            .checked_add(campaign.spent)
            .unwrap_or_else(|| env::panic_str("Campaign accounting overflow"));
        require!(
            committed <= campaign.funded,
            "Campaign accounting invariant violated"
        );
        let new_reserved = campaign
            .reserved
            .checked_sub(payout.input_amount.atomic_amount())
            .unwrap_or_else(|| env::panic_str("Campaign reserved balance underflow"));
        let new_committed = new_reserved
            .checked_add(campaign.spent)
            .unwrap_or_else(|| env::panic_str("Campaign accounting overflow"));
        require!(
            new_committed <= campaign.funded && campaign.funded <= campaign.budget,
            "Campaign accounting invariant violated"
        );

        let previous_status = payout.status;
        campaign.reserved = new_reserved;
        payout.status = PayoutStatus::ReservationReleased;
        self.campaigns.insert(campaign.id, campaign);
        self.payouts.insert(payout.id, payout.clone());
        Self::payout_resolution_evidence().insert(payout.id, evidence.clone());
        Self::index_resolution_evidence(&evidence, execution_key);
        self.emit_event(
            event,
            near_sdk::serde_json::json!({
                "payout_id": payout.id,
                "campaign_id": payout.campaign_id,
                "verifier_id": evidence.verifier_id,
                "previous_status": Self::payout_status_name(previous_status),
                "new_status": Self::payout_status_name(payout.status),
                "released_input_amount": payout.input_amount.atomic_amount().to_string(),
                "evidence_reference": evidence.evidence_reference,
                "resolution_outcome": evidence.outcome,
            }),
        );
    }

    fn payout_or_panic(&self, payout_id: u64) -> Payout {
        self.payouts
            .get(&payout_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Payout not found"))
    }

    fn execution_references() -> LookupMap<String, u64> {
        LookupMap::new(b"payout-execution-references".to_vec())
    }

    fn payout_lifecycle_reasons() -> LookupMap<u64, String> {
        LookupMap::new(b"payout-lifecycle-reasons".to_vec())
    }

    fn payout_failure_evidence() -> LookupMap<u64, ExecutionFailureEvidence> {
        LookupMap::new(b"payout-failure-evidence-v1".to_vec())
    }

    fn payout_settlement_evidence() -> LookupMap<u64, SettlementEvidence> {
        LookupMap::new(b"payout-settlement-records-v1".to_vec())
    }

    fn payout_resolution_evidence() -> LookupMap<u64, PayoutResolutionEvidence> {
        LookupMap::new(b"payout-resolution-records-v1".to_vec())
    }

    fn settlement_execution_index() -> LookupMap<(String, String, String, Option<String>), u64> {
        LookupMap::new(b"payout-settlement-executions-v1".to_vec())
    }

    fn settlement_reference_index() -> LookupMap<String, u64> {
        LookupMap::new(b"payout-settlement-references-v1".to_vec())
    }

    fn campaign_or_panic(&self, campaign_id: u64) -> Campaign {
        self.campaigns
            .get(&campaign_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Campaign not found"))
    }

    fn payout_matches_request(payout: &Payout, request: &PayoutRequest) -> bool {
        payout.campaign_id == request.campaign_id
            && payout.recipient_near_account_id == request.recipient_near_account_id
            && payout.destination == request.destination
            && payout.input_amount == request.input_amount
            && payout.expected_output_amount == request.expected_output_amount
    }

    fn available_campaign_funds(campaign: &Campaign) -> u128 {
        require!(
            campaign.funded <= campaign.budget,
            "Campaign funding invariant violated"
        );
        let committed = campaign
            .reserved
            .checked_add(campaign.spent)
            .unwrap_or_else(|| env::panic_str("Campaign accounting overflow"));
        require!(
            committed <= campaign.funded,
            "Campaign accounting invariant violated"
        );
        campaign
            .funded
            .checked_sub(committed)
            .unwrap_or_else(|| env::panic_str("Campaign accounting underflow"))
    }

    fn token_id_string(token_id: &TokenId) -> String {
        token_id
            .near_account_id()
            .map(ToString::to_string)
            .or_else(|| token_id.external_identifier().map(ToString::to_string))
            .unwrap_or_default()
    }

    fn token_amount_view(amount: &TokenAmount) -> TokenAmountView {
        TokenAmountView {
            token_id: amount.token_id().clone(),
            atomic_amount: U128(amount.atomic_amount()),
            decimals: amount.decimals(),
        }
    }

    fn payout_view(&self, payout: &Payout) -> PayoutView {
        PayoutView {
            id: payout.id,
            campaign_id: payout.campaign_id,
            recipient_near_account_id: payout.recipient_near_account_id.clone(),
            input_amount: Self::token_amount_view(&payout.input_amount),
            destination: payout.destination.clone(),
            expected_output_amount: Self::token_amount_view(&payout.expected_output_amount),
            status: payout.status,
            created_at_ns: payout.created_at_ns,
            execution_reference: payout.execution_reference.clone(),
            settlement_evidence_reference: payout.settlement_evidence_reference.clone(),
            lifecycle_reason: Self::payout_lifecycle_reasons().get(&payout.id).cloned(),
            failure_evidence: Self::payout_failure_evidence().get(&payout.id).cloned(),
            settlement_evidence: Self::payout_settlement_evidence().get(&payout.id).cloned(),
            resolution_evidence: Self::payout_resolution_evidence().get(&payout.id).cloned(),
        }
    }

    fn require_campaign_status(&self, campaign: &Campaign, expected: CampaignStatus, action: &str) {
        require!(
            campaign.status == expected,
            format!("Cannot {action} campaign from {:?} status", campaign.status)
        );
    }

    fn set_campaign_status(
        &mut self,
        mut campaign: Campaign,
        status: CampaignStatus,
        event: &str,
        actor_id: AccountId,
    ) {
        campaign.status = status;
        let campaign_id = campaign.id;
        self.campaigns.insert(campaign_id, campaign);
        self.emit_event(
            event,
            near_sdk::serde_json::json!({
                "campaign_id": campaign_id,
                "actor_id": actor_id,
            }),
        );
    }

    fn role_name(role: UserRole) -> &'static str {
        match role {
            UserRole::Owner => "owner",
            UserRole::Administrator => "administrator",
            UserRole::Operator => "operator",
            UserRole::Verifier => "verifier",
        }
    }

    fn payout_status_name(status: PayoutStatus) -> &'static str {
        match status {
            PayoutStatus::Created => "Created",
            PayoutStatus::Authorized => "Authorized",
            PayoutStatus::Reserved => "Reserved",
            PayoutStatus::Executing => "Executing",
            PayoutStatus::PendingVerification => "PendingVerification",
            PayoutStatus::Succeeded => "Succeeded",
            PayoutStatus::Failed => "Failed",
            PayoutStatus::RefundPending => "RefundPending",
            PayoutStatus::Refunded => "Refunded",
            PayoutStatus::ManualReview => "ManualReview",
            PayoutStatus::ReservationReleased => "ReservationReleased",
        }
    }

    fn emit_event(&self, event: &str, data: near_sdk::serde_json::Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "disburse",
                "version": "1.0.0",
                "event": event,
                "data": [data],
            })
        ));
    }

    fn decode_funding_message(msg: &str) -> Option<u64> {
        near_sdk::serde_json::from_str::<CampaignFundingMessage>(msg)
            .ok()
            .map(|message| message.campaign_id)
    }
}

#[near]
impl FungibleTokenReceiver for Disburse {
    /// Accept funding only from the allowlisted predecessor FT, for a matching campaign token.
    /// Campaigns deliberately fund only while Approved; activation remains a separate action.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        let unused = || PromiseOrValue::Value(U128(amount.0));

        if self.paused || amount.0 == 0 || !self.accepted_tokens.contains(&token_id) {
            return unused();
        }

        let Some(campaign_id) = Self::decode_funding_message(&msg) else {
            return unused();
        };
        let Some(mut campaign) = self.campaigns.get(&campaign_id).cloned() else {
            return unused();
        };

        if campaign.status != CampaignStatus::Approved || campaign.token_id != token_id {
            return unused();
        }

        let Some(total_funded) = campaign.funded.checked_add(amount.0) else {
            return unused();
        };
        if total_funded > campaign.budget {
            return unused();
        }

        campaign.funded = total_funded;
        self.campaigns.insert(campaign_id, campaign);
        self.emit_event(
            "campaign_funded",
            near_sdk::serde_json::json!({
                "campaign_id": campaign_id,
                "sender_id": sender_id,
                "token_id": token_id,
                "amount": amount,
                "total_funded": U128(total_funded),
            }),
        );
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::testing_env;
    use near_sdk::{
        PromiseOrValue,
        json_types::U128,
        test_utils::{VMContextBuilder, accounts, get_logs},
    };
    use std::panic::{AssertUnwindSafe, catch_unwind};

    fn set_context(predecessor: AccountId) {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor);
        testing_env!(context.build());
    }

    fn new_contract() -> Disburse {
        set_context(accounts(1));
        Disburse::new()
    }

    fn create_campaign_as(contract: &mut Disburse, creator: AccountId) -> u64 {
        set_context(creator);
        contract.create_campaign("Test campaign".to_string(), accounts(5), 1_000)
    }

    fn approve_as_owner(contract: &mut Disburse, campaign_id: u64) {
        set_context(accounts(1));
        contract.approve_campaign(campaign_id);
    }

    fn make_approved_campaign(contract: &mut Disburse, creator: AccountId) -> u64 {
        let campaign_id = create_campaign_as(contract, creator);
        approve_as_owner(contract, campaign_id);
        campaign_id
    }

    fn make_active_campaign(contract: &mut Disburse, creator: AccountId) -> u64 {
        let campaign_id = make_approved_campaign(contract, creator);
        set_context(accounts(1));
        contract.grant_role(accounts(3), UserRole::Operator);
        set_context(accounts(3));
        contract.activate_campaign(campaign_id);
        campaign_id
    }

    fn assert_campaign_call_fails_unchanged<F>(contract: &mut Disburse, campaign_id: u64, action: F)
    where
        F: FnOnce(&mut Disburse),
    {
        let before = contract.get_campaign(campaign_id);
        let result = catch_unwind(AssertUnwindSafe(|| action(contract)));
        assert!(result.is_err());
        assert_eq!(contract.get_campaign(campaign_id), before);
    }

    fn approved_funding_campaign(budget: u128, campaign_token: AccountId) -> (Disburse, u64) {
        let mut contract = new_contract();
        contract.add_accepted_token(accounts(3));
        set_context(accounts(2));
        let campaign_id =
            contract.create_campaign("Funding campaign".to_string(), campaign_token, budget);
        set_context(accounts(1));
        contract.approve_campaign(campaign_id);
        (contract, campaign_id)
    }

    fn receiver_unused(
        contract: &mut Disburse,
        token_contract: AccountId,
        sender: AccountId,
        amount: u128,
        msg: &str,
    ) -> u128 {
        set_context(token_contract);
        match FungibleTokenReceiver::ft_on_transfer(contract, sender, U128(amount), msg.to_string())
        {
            PromiseOrValue::Value(U128(unused)) => unused,
            PromiseOrValue::Promise(_) => panic!("funding receiver must be synchronous"),
        }
    }

    fn assert_rejected_funding_unchanged(
        contract: &mut Disburse,
        campaign_id: u64,
        token_contract: AccountId,
        amount: u128,
        msg: &str,
    ) {
        let before = contract.get_campaign(campaign_id).unwrap();
        let unused = receiver_unused(contract, token_contract, accounts(4), amount, msg);
        assert_eq!(unused, amount);

        let after = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(after.funded, before.funded);
        assert_eq!(after.budget, before.budget);
        assert_eq!(after.reserved, before.reserved);
        assert_eq!(after.spent, before.spent);
        assert_eq!(after, before);
        assert!(
            get_logs()
                .iter()
                .all(|log| !log.contains("\"event\":\"campaign_funded\""))
        );
    }

    fn payout_destination(address: &str) -> PayoutDestination {
        PayoutDestination {
            chain_id: types::destination::ChainId::new("eip155:1".to_string()).unwrap(),
            recipient_address: types::destination::RecipientAddress::new(address.to_string())
                .unwrap(),
        }
    }

    fn payout_amount(token_id: TokenId, amount: u128) -> TokenAmount {
        TokenAmount::new(token_id, amount, 6)
    }

    fn funded_active_campaign(funded: u128) -> (Disburse, u64) {
        let (mut contract, campaign_id) = approved_funding_campaign(funded, accounts(3));
        assert_eq!(
            receiver_unused(
                &mut contract,
                accounts(3),
                accounts(4),
                funded,
                &format!("{{\"campaign_id\":{campaign_id}}}")
            ),
            0
        );
        set_context(accounts(1));
        contract.grant_role(accounts(2), UserRole::Operator);
        set_context(accounts(2));
        contract.activate_campaign(campaign_id);
        (contract, campaign_id)
    }

    fn submit_test_payout(
        contract: &mut Disburse,
        campaign_id: u64,
        key: &str,
        amount: u128,
    ) -> u64 {
        contract.create_payout(
            campaign_id,
            key.to_string(),
            Some(accounts(4)),
            payout_destination("0xrecipient"),
            payout_amount(TokenId::near(accounts(3)), amount),
            payout_amount(TokenId::external("sol:usdc".to_string()).unwrap(), 95),
        )
    }

    fn reserve_test_payout(contract: &mut Disburse, campaign_id: u64, key: &str) -> u64 {
        submit_test_payout(contract, campaign_id, key, 10)
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
            output_amount: TokenAmount::new(
                TokenId::external("sol:usdc".to_string()).unwrap(),
                95,
                18,
            ),
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
                destination_chain_id: types::destination::ChainId::new("eip155:1".to_string())
                    .unwrap(),
                execution_reference: format!("0xtx{payout_id}"),
                transaction_event_identifier: Some("7".to_string()),
            }),
        }
    }

    fn failed_test_payout(contract: &mut Disburse, campaign_id: u64, key: &str) -> u64 {
        let payout_id = reserve_test_payout(contract, campaign_id, key);
        contract.start_payout_execution(payout_id, format!("execution:{key}"));
        contract.mark_payout_failed(payout_id, definitive_failure(&format!("failure:{key}")));
        payout_id
    }

    fn manual_review_test_payout(contract: &mut Disburse, campaign_id: u64, key: &str) -> u64 {
        let payout_id = reserve_test_payout(contract, campaign_id, key);
        contract.start_payout_execution(payout_id, format!("execution:{key}"));
        contract.move_payout_to_manual_review(payout_id, "Execution outcome uncertain".into());
        payout_id
    }

    fn pending_test_payout(contract: &mut Disburse, campaign_id: u64, key: &str) -> u64 {
        let payout_id = reserve_test_payout(contract, campaign_id, key);
        contract.start_payout_execution(payout_id, format!("execution:{key}"));
        contract.mark_payout_pending_verification(payout_id);
        payout_id
    }

    fn grant_verifier(contract: &mut Disburse, verifier: AccountId) {
        set_context(accounts(1));
        contract.grant_role(verifier.clone(), UserRole::Verifier);
        set_context(verifier);
    }

    #[test]
    fn initializes_with_caller_as_owner() {
        let contract = new_contract();
        assert_eq!(contract.get_owner(), accounts(1));
        assert!(!contract.is_paused());
        assert_eq!(contract.get_campaign_count(), 0);
    }

    #[test]
    fn creates_campaign_with_zero_initial_funding() {
        let mut contract = new_contract();
        let campaign_id =
            contract.create_campaign("Community Grants".to_string(), accounts(2), 1_000_000);
        let campaign = contract.get_campaign(campaign_id).unwrap();

        assert_eq!(campaign_id, 0);
        assert_eq!(campaign.creator_id, accounts(1));
        assert_eq!(campaign.title, "Community Grants");
        assert_eq!(campaign.token_id, accounts(2));
        assert_eq!(campaign.budget, 1_000_000);
        assert_eq!(campaign.funded, 0);
        assert_eq!(campaign.reserved, 0);
        assert_eq!(campaign.spent, 0);
        assert_eq!(campaign.status, types::status::CampaignStatus::Draft);
        assert_eq!(contract.get_campaign_count(), 1);
    }

    #[test]
    fn campaign_ids_are_unique_and_incrementing() {
        let mut contract = new_contract();
        let first = contract.create_campaign("First campaign".to_string(), accounts(2), 100);
        let second = contract.create_campaign("Second campaign".to_string(), accounts(2), 200);
        assert_eq!((first, second), (0, 1));
        assert_eq!(contract.get_campaign_count(), 2);
    }

    #[test]
    #[should_panic(expected = "Campaign title cannot be empty")]
    fn rejects_empty_campaign_title() {
        new_contract().create_campaign("   ".to_string(), accounts(2), 100);
    }

    #[test]
    #[should_panic(expected = "Campaign budget must be greater than zero")]
    fn rejects_zero_campaign_budget() {
        new_contract().create_campaign("Community Grants".to_string(), accounts(2), 0);
    }

    #[test]
    fn owner_can_pause_and_unpause() {
        let mut contract = new_contract();
        contract.pause();
        assert!(contract.is_paused());
        contract.unpause();
        assert!(!contract.is_paused());
    }

    #[test]
    #[should_panic(expected = "Only the contract owner")]
    fn non_owner_cannot_pause() {
        let mut contract = new_contract();
        set_context(accounts(2));
        contract.pause();
    }

    #[test]
    #[should_panic(expected = "Contract is paused")]
    fn cannot_create_campaign_while_contract_is_paused() {
        let mut contract = new_contract();
        contract.pause();
        contract.create_campaign("Blocked campaign".to_string(), accounts(2), 100);
    }

    #[test]
    fn owner_can_grant_administrator_operator_and_verifier_roles() {
        let mut contract = new_contract();

        for (account, role) in [
            (accounts(2), UserRole::Administrator),
            (accounts(3), UserRole::Operator),
            (accounts(4), UserRole::Verifier),
        ] {
            set_context(accounts(1));
            contract.grant_role(account.clone(), role);
            assert!(contract.has_role(account, role));
        }

        assert!(contract.has_role(accounts(1), UserRole::Owner));
        assert!(contract.has_role(accounts(1), UserRole::Administrator));
        assert!(!contract.has_role(accounts(1), UserRole::Operator));
    }

    #[test]
    fn non_owner_cannot_grant_or_revoke_roles() {
        let mut contract = new_contract();
        contract.grant_role(accounts(2), UserRole::Operator);

        set_context(accounts(2));
        let grant = catch_unwind(AssertUnwindSafe(|| {
            contract.grant_role(accounts(3), UserRole::Verifier)
        }));
        assert!(grant.is_err());
        assert!(!contract.has_role(accounts(3), UserRole::Verifier));

        let revoke = catch_unwind(AssertUnwindSafe(|| {
            contract.revoke_role(accounts(2), UserRole::Operator)
        }));
        assert!(revoke.is_err());
        assert!(contract.has_role(accounts(2), UserRole::Operator));
    }

    #[test]
    fn owner_role_cannot_be_granted_and_owner_cannot_self_grant() {
        let mut contract = new_contract();

        let owner_role = catch_unwind(AssertUnwindSafe(|| {
            contract.grant_role(accounts(2), UserRole::Owner)
        }));
        assert!(owner_role.is_err());
        assert!(!contract.has_role(accounts(2), UserRole::Owner));

        let self_grant = catch_unwind(AssertUnwindSafe(|| {
            contract.grant_role(accounts(1), UserRole::Operator)
        }));
        assert!(self_grant.is_err());
        assert!(!contract.has_role(accounts(1), UserRole::Operator));
    }

    #[test]
    fn duplicate_role_grants_are_idempotent_and_absent_revocations_fail() {
        let mut contract = new_contract();
        contract.grant_role(accounts(2), UserRole::Verifier);
        contract.grant_role(accounts(2), UserRole::Verifier);
        assert!(contract.has_role(accounts(2), UserRole::Verifier));

        let absent = catch_unwind(AssertUnwindSafe(|| {
            contract.revoke_role(accounts(2), UserRole::Operator)
        }));
        assert!(absent.is_err());
        assert!(!contract.has_role(accounts(2), UserRole::Operator));

        contract.revoke_role(accounts(2), UserRole::Verifier);
        assert!(!contract.has_role(accounts(2), UserRole::Verifier));
    }

    #[test]
    fn owner_administrative_authority_cannot_be_revoked() {
        let mut contract = new_contract();

        for role in [UserRole::Owner, UserRole::Administrator] {
            let result = catch_unwind(AssertUnwindSafe(|| contract.revoke_role(accounts(1), role)));
            assert!(result.is_err());
        }

        assert!(contract.has_role(accounts(1), UserRole::Owner));
        assert!(contract.has_role(accounts(1), UserRole::Administrator));
    }

    #[test]
    fn campaign_creator_does_not_receive_privileged_roles_automatically() {
        let mut contract = new_contract();
        create_campaign_as(&mut contract, accounts(2));

        for role in [
            UserRole::Administrator,
            UserRole::Operator,
            UserRole::Verifier,
        ] {
            assert!(!contract.has_role(accounts(2), role));
        }
    }

    #[test]
    fn administrator_approves_draft_and_owner_is_implicit_administrator() {
        let mut contract = new_contract();
        let campaign_id = create_campaign_as(&mut contract, accounts(2));
        assert!(contract.has_role(accounts(1), UserRole::Administrator));

        set_context(accounts(1));
        contract.grant_role(accounts(4), UserRole::Administrator);
        set_context(accounts(4));
        contract.approve_campaign(campaign_id);
        assert_eq!(
            contract.get_campaign(campaign_id).unwrap().status,
            CampaignStatus::Approved
        );
    }

    #[test]
    fn role_and_campaign_events_follow_nep297_envelope() {
        use near_sdk::test_utils::get_logs;

        let mut contract = new_contract();
        contract.grant_role(accounts(4), UserRole::Administrator);
        let role_event = get_logs()
            .into_iter()
            .find(|log| log.starts_with("EVENT_JSON:"))
            .unwrap();
        let role_event: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(role_event.trim_start_matches("EVENT_JSON:")).unwrap();
        assert_eq!(role_event["standard"], "disburse");
        assert_eq!(role_event["version"], "1.0.0");
        assert_eq!(role_event["event"], "role_granted");
        assert_eq!(role_event["data"][0]["account_id"], accounts(4).as_str());
        assert_eq!(role_event["data"][0]["role"], "administrator");
        assert_eq!(role_event["data"][0]["actor_id"], accounts(1).as_str());

        let campaign_id = create_campaign_as(&mut contract, accounts(2));
        set_context(accounts(4));
        contract.approve_campaign(campaign_id);
        let campaign_event = get_logs()
            .into_iter()
            .find(|log| log.starts_with("EVENT_JSON:"))
            .unwrap();
        let campaign_event: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(campaign_event.trim_start_matches("EVENT_JSON:"))
                .unwrap();
        assert_eq!(campaign_event["event"], "campaign_approved");
        assert_eq!(campaign_event["data"][0]["campaign_id"], campaign_id);
        assert_eq!(campaign_event["data"][0]["actor_id"], accounts(4).as_str());
    }

    #[test]
    fn non_administrator_cannot_approve_and_campaign_remains_draft() {
        let mut contract = new_contract();
        let campaign_id = create_campaign_as(&mut contract, accounts(2));

        set_context(accounts(3));
        assert_campaign_call_fails_unchanged(&mut contract, campaign_id, |contract| {
            contract.approve_campaign(campaign_id)
        });
    }

    #[test]
    fn operator_activates_approved_campaign_but_not_draft() {
        let mut contract = new_contract();
        let draft_id = create_campaign_as(&mut contract, accounts(2));
        set_context(accounts(1));
        contract.grant_role(accounts(3), UserRole::Operator);

        set_context(accounts(3));
        assert_campaign_call_fails_unchanged(&mut contract, draft_id, |contract| {
            contract.activate_campaign(draft_id)
        });

        approve_as_owner(&mut contract, draft_id);
        set_context(accounts(3));
        contract.activate_campaign(draft_id);
        assert_eq!(
            contract.get_campaign(draft_id).unwrap().status,
            CampaignStatus::Active
        );
    }

    #[test]
    fn non_operator_cannot_activate_campaign() {
        let mut contract = new_contract();
        let campaign_id = make_approved_campaign(&mut contract, accounts(2));
        set_context(accounts(3));

        assert_campaign_call_fails_unchanged(&mut contract, campaign_id, |contract| {
            contract.activate_campaign(campaign_id)
        });
    }

    #[test]
    fn operator_or_administrator_can_pause_and_resume_active_campaign() {
        let mut contract = new_contract();
        let campaign_id = make_active_campaign(&mut contract, accounts(2));

        set_context(accounts(3));
        contract.pause_campaign(campaign_id);
        assert_eq!(
            contract.get_campaign(campaign_id).unwrap().status,
            CampaignStatus::Paused
        );

        set_context(accounts(1));
        contract.resume_campaign(campaign_id);
        assert_eq!(
            contract.get_campaign(campaign_id).unwrap().status,
            CampaignStatus::Active
        );
    }

    #[test]
    fn creator_can_cancel_draft_and_approved_campaigns() {
        let mut contract = new_contract();
        let draft_id = create_campaign_as(&mut contract, accounts(2));
        set_context(accounts(2));
        contract.cancel_campaign(draft_id);
        assert_eq!(
            contract.get_campaign(draft_id).unwrap().status,
            CampaignStatus::Cancelled
        );

        let approved_id = make_approved_campaign(&mut contract, accounts(2));
        set_context(accounts(2));
        contract.cancel_campaign(approved_id);
        assert_eq!(
            contract.get_campaign(approved_id).unwrap().status,
            CampaignStatus::Cancelled
        );
    }

    #[test]
    fn creator_cannot_cancel_active_or_paused_campaigns() {
        let mut contract = new_contract();
        let active_id = make_active_campaign(&mut contract, accounts(2));

        set_context(accounts(2));
        assert_campaign_call_fails_unchanged(&mut contract, active_id, |contract| {
            contract.cancel_campaign(active_id)
        });

        set_context(accounts(3));
        contract.pause_campaign(active_id);
        set_context(accounts(2));
        assert_campaign_call_fails_unchanged(&mut contract, active_id, |contract| {
            contract.cancel_campaign(active_id)
        });
    }

    #[test]
    fn administrator_can_cancel_active_and_paused_campaigns() {
        let mut contract = new_contract();
        let active_id = make_active_campaign(&mut contract, accounts(2));
        set_context(accounts(1));
        contract.cancel_campaign(active_id);
        assert_eq!(
            contract.get_campaign(active_id).unwrap().status,
            CampaignStatus::Cancelled
        );

        let paused_id = make_active_campaign(&mut contract, accounts(2));
        set_context(accounts(3));
        contract.pause_campaign(paused_id);
        set_context(accounts(1));
        contract.cancel_campaign(paused_id);
        assert_eq!(
            contract.get_campaign(paused_id).unwrap().status,
            CampaignStatus::Cancelled
        );
    }

    #[test]
    fn completed_and_cancelled_campaigns_cannot_transition() {
        let mut contract = new_contract();
        let completed_id = create_campaign_as(&mut contract, accounts(2));
        let mut completed = contract.get_campaign(completed_id).unwrap();
        completed.status = CampaignStatus::Completed;
        contract.campaigns.insert(completed_id, completed);

        set_context(accounts(1));
        assert_campaign_call_fails_unchanged(&mut contract, completed_id, |contract| {
            contract.cancel_campaign(completed_id)
        });

        let cancelled_id = create_campaign_as(&mut contract, accounts(2));
        set_context(accounts(2));
        contract.cancel_campaign(cancelled_id);
        set_context(accounts(1));
        contract.grant_role(accounts(3), UserRole::Operator);
        set_context(accounts(3));
        assert_campaign_call_fails_unchanged(&mut contract, cancelled_id, |contract| {
            contract.activate_campaign(cancelled_id)
        });
    }

    #[test]
    fn nonexistent_campaign_and_invalid_transition_fail_without_state_changes() {
        let mut contract = new_contract();
        let campaign_id = create_campaign_as(&mut contract, accounts(2));
        approve_as_owner(&mut contract, campaign_id);
        contract.grant_role(accounts(3), UserRole::Administrator);

        set_context(accounts(3));
        assert_campaign_call_fails_unchanged(&mut contract, campaign_id, |contract| {
            contract.approve_campaign(campaign_id)
        });
        let missing = catch_unwind(AssertUnwindSafe(|| contract.approve_campaign(999)));
        assert!(missing.is_err());
        assert_eq!(
            contract.get_campaign(campaign_id).unwrap().status,
            CampaignStatus::Approved
        );
    }

    #[test]
    fn global_pause_blocks_lifecycle_and_unpause_preserves_campaign_status() {
        let mut contract = new_contract();
        let campaign_id = create_campaign_as(&mut contract, accounts(2));
        set_context(accounts(1));
        contract.pause();

        set_context(accounts(1));
        assert_campaign_call_fails_unchanged(&mut contract, campaign_id, |contract| {
            contract.approve_campaign(campaign_id)
        });

        contract.unpause();
        assert_eq!(
            contract.get_campaign(campaign_id).unwrap().status,
            CampaignStatus::Draft
        );
        contract.approve_campaign(campaign_id);
        assert_eq!(
            contract.get_campaign(campaign_id).unwrap().status,
            CampaignStatus::Approved
        );
    }

    #[test]
    fn non_owner_cannot_unpause_contract() {
        let mut contract = new_contract();
        contract.pause();
        set_context(accounts(2));
        let result = catch_unwind(AssertUnwindSafe(|| contract.unpause()));
        assert!(result.is_err());
        assert!(contract.is_paused());
    }

    #[test]
    fn owner_manages_persistent_token_allowlist_and_duplicate_add_is_idempotent() {
        let mut contract = new_contract();
        let token_id = accounts(3);
        assert!(!contract.is_accepted_token(token_id.clone()));

        contract.add_accepted_token(token_id.clone());
        contract.add_accepted_token(token_id.clone());
        assert!(contract.is_accepted_token(token_id.clone()));
        let added_events = get_logs()
            .iter()
            .filter(|log| log.contains("\"event\":\"accepted_token_added\""))
            .count();
        assert_eq!(added_events, 1);

        contract.remove_accepted_token(token_id.clone());
        assert!(!contract.is_accepted_token(token_id));
        assert!(
            get_logs()
                .iter()
                .any(|log| log.contains("\"event\":\"accepted_token_removed\""))
        );
    }

    #[test]
    fn non_owner_cannot_change_token_allowlist() {
        let mut contract = new_contract();
        set_context(accounts(2));
        let add = catch_unwind(AssertUnwindSafe(|| {
            contract.add_accepted_token(accounts(3))
        }));
        assert!(add.is_err());
        assert!(!contract.is_accepted_token(accounts(3)));

        set_context(accounts(1));
        contract.add_accepted_token(accounts(3));
        set_context(accounts(2));
        let remove = catch_unwind(AssertUnwindSafe(|| {
            contract.remove_accepted_token(accounts(3))
        }));
        assert!(remove.is_err());
        assert!(contract.is_accepted_token(accounts(3)));
    }

    #[test]
    fn approved_campaign_accepts_multiple_deposits_and_reports_atomic_balances() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));

        assert_eq!(
            receiver_unused(
                &mut contract,
                accounts(3),
                accounts(4),
                300,
                &format!("{{\"campaign_id\":{campaign_id}}}")
            ),
            0
        );
        let funding_event = get_logs()
            .into_iter()
            .find(|log| log.contains("\"event\":\"campaign_funded\""))
            .unwrap();
        let event: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(funding_event.trim_start_matches("EVENT_JSON:"))
                .unwrap();
        assert_eq!(event["data"][0]["campaign_id"], campaign_id);
        assert_eq!(event["data"][0]["sender_id"], accounts(4).as_str());
        assert_eq!(event["data"][0]["token_id"], accounts(3).as_str());
        assert_eq!(event["data"][0]["amount"], "300");
        assert_eq!(event["data"][0]["total_funded"], "300");

        assert_eq!(
            receiver_unused(
                &mut contract,
                accounts(3),
                accounts(5),
                200,
                &format!("{{\"campaign_id\":{campaign_id}}}")
            ),
            0
        );

        let campaign = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(campaign.budget, 1_000);
        assert_eq!(campaign.funded, 500);
        assert_eq!(campaign.reserved, 0);
        assert_eq!(campaign.spent, 0);
        assert_eq!(campaign.status, CampaignStatus::Approved);

        let funding = contract.get_campaign_funding(campaign_id).unwrap();
        assert_eq!(funding.token_id, accounts(3));
        assert_eq!(funding.budget, U128(1_000));
        assert_eq!(funding.funded, U128(500));
        assert_eq!(funding.remaining_budget, U128(500));
        let json = near_sdk::serde_json::to_string(&funding).unwrap();
        assert!(json.contains("\"funded\":\"500\""));
    }

    #[test]
    fn unsupported_predecessor_cannot_spoof_allowlisted_token_in_message() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));
        let spoofed_message = format!(
            "{{\"campaign_id\":{campaign_id},\"token_id\":\"{}\"}}",
            accounts(3)
        );
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(4),
            100,
            &spoofed_message,
        );
    }

    #[test]
    fn wrong_campaign_token_contract_is_rejected() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(4));
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(3),
            100,
            &format!("{{\"campaign_id\":{campaign_id}}}"),
        );
    }

    #[test]
    fn malformed_zero_and_nonexistent_campaign_deposits_return_all_tokens() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));
        assert_rejected_funding_unchanged(&mut contract, campaign_id, accounts(3), 100, "not-json");
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(3),
            0,
            &format!("{{\"campaign_id\":{campaign_id}}}"),
        );
        assert_eq!(
            receiver_unused(
                &mut contract,
                accounts(3),
                accounts(4),
                75,
                "{\"campaign_id\":999}"
            ),
            75
        );
        assert!(
            get_logs()
                .iter()
                .all(|log| !log.contains("\"event\":\"campaign_funded\""))
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap().funded, 0);
        assert_eq!(contract.get_campaign_funding(999), None);
    }

    #[test]
    fn funding_message_rejects_ambiguous_invalid_and_trailing_json_without_side_effects() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));
        let invalid_messages = [
            "{}",
            "{\"campaign_id\":0,\"campaign_id\":0}",
            "{\"campaign_id\":0,\"campaign_id\":1}",
            "{\"campaign_id\":0,\"unexpected\":true}",
            "{\"campaign_id\":null}",
            "{\"campaign_id\":\"0\"}",
            "{\"campaign_id\":-0}",
            "{\"campaign_id\":-1}",
            "{\"campaign_id\":1.0}",
            "{\"campaign_id\":1.5}",
            "{\"campaign_id\":1e0}",
            "{\"campaign_id\":18446744073709551616}",
            "{\"campaign_id\":0} trailing",
            "{\"campaign_id\":0}{\"campaign_id\":1}",
            "[0]",
            "null",
            "\"0\"",
            "not-json",
        ];

        for message in invalid_messages {
            assert_rejected_funding_unchanged(&mut contract, campaign_id, accounts(3), 13, message);
        }

        let max_u64_message = format!("{{\"campaign_id\":{}}}", u64::MAX);
        assert_eq!(
            Disburse::decode_funding_message(&max_u64_message),
            Some(u64::MAX)
        );
    }

    #[test]
    fn deposits_exceeding_budget_or_overflowing_funded_are_rejected_unchanged() {
        let (mut contract, campaign_id) = approved_funding_campaign(100, accounts(3));
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(3),
            101,
            &format!("{{\"campaign_id\":{campaign_id}}}"),
        );

        let mut campaign = contract.get_campaign(campaign_id).unwrap();
        campaign.budget = u128::MAX;
        campaign.funded = u128::MAX - 1;
        contract.campaigns.insert(campaign_id, campaign);
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(3),
            2,
            &format!("{{\"campaign_id\":{campaign_id}}}"),
        );
    }

    #[test]
    fn only_approved_campaigns_accept_funding() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));
        for status in [
            CampaignStatus::Draft,
            CampaignStatus::Active,
            CampaignStatus::Paused,
            CampaignStatus::Completed,
            CampaignStatus::Cancelled,
        ] {
            let mut campaign = contract.get_campaign(campaign_id).unwrap();
            campaign.status = status;
            contract.campaigns.insert(campaign_id, campaign);
            assert_rejected_funding_unchanged(
                &mut contract,
                campaign_id,
                accounts(3),
                10,
                &format!("{{\"campaign_id\":{campaign_id}}}"),
            );
        }
    }

    #[test]
    fn global_pause_returns_funding_without_changing_campaign_accounting() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));
        contract.pause();
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(3),
            25,
            &format!("{{\"campaign_id\":{campaign_id}}}"),
        );
    }

    #[test]
    fn removing_token_preserves_historical_funding_and_blocks_future_deposits() {
        let (mut contract, campaign_id) = approved_funding_campaign(1_000, accounts(3));
        assert_eq!(
            receiver_unused(
                &mut contract,
                accounts(3),
                accounts(4),
                450,
                &format!("{{\"campaign_id\":{campaign_id}}}")
            ),
            0
        );
        set_context(accounts(1));
        contract.remove_accepted_token(accounts(3));

        let before = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(before.funded, 450);
        assert_rejected_funding_unchanged(
            &mut contract,
            campaign_id,
            accounts(3),
            100,
            &format!("{{\"campaign_id\":{campaign_id}}}"),
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap().funded, 450);
    }

    #[test]
    fn operator_reserves_exact_input_and_views_use_u128_strings() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let before = contract.get_campaign(campaign_id).unwrap();
        let id = submit_test_payout(&mut contract, campaign_id, "payout-1", 40);
        let after = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(after.reserved, 40);
        assert_eq!(after.funded, before.funded);
        assert_eq!(after.spent, before.spent);
        assert_eq!(
            contract.get_payout(id).unwrap().status,
            PayoutStatus::Reserved
        );
        assert_eq!(
            contract.get_campaign_payout(campaign_id, id).unwrap().id,
            id
        );
        assert_eq!(contract.get_campaign_payout(999, id), None);
        let by_key = contract
            .get_payout_by_idempotency(campaign_id, "payout-1".to_string())
            .unwrap();
        assert_eq!(by_key.id, id);
        assert_eq!(
            contract
                .get_campaign_payout_accounting(campaign_id)
                .unwrap()
                .available,
            U128(60)
        );
        assert!(
            near_sdk::serde_json::to_string(&contract.get_payout(id).unwrap())
                .unwrap()
                .contains("\"atomic_amount\":\"40\"")
        );
        let event: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(
            get_logs()
                .last()
                .unwrap()
                .strip_prefix("EVENT_JSON:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(event["event"], "payout_reserved");
        assert_eq!(event["data"][0]["input_amount"], "40");
        assert_eq!(event["data"][0]["expected_output_amount"], "95");
        assert_eq!(contract.get_payout(999), None);
    }

    #[test]
    fn administrator_and_owner_can_create_payouts() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        set_context(accounts(1));
        contract.create_payout(
            campaign_id,
            "owner".into(),
            None,
            payout_destination("addr"),
            payout_amount(TokenId::near(accounts(3)), 1),
            payout_amount(TokenId::near(accounts(5)), 2),
        );
        set_context(accounts(1));
        contract.grant_role(accounts(5), UserRole::Administrator);
        set_context(accounts(5));
        contract.create_payout(
            campaign_id,
            "admin".into(),
            None,
            payout_destination("addr"),
            payout_amount(TokenId::near(accounts(3)), 1),
            payout_amount(TokenId::near(accounts(5)), 2),
        );
        assert_eq!(
            contract.get_payout(0).unwrap().status,
            PayoutStatus::Reserved
        );
        assert_eq!(
            contract.get_payout(1).unwrap().status,
            PayoutStatus::Reserved
        );
    }

    #[test]
    fn identical_idempotent_retry_does_not_reserve_or_emit_again() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let first = submit_test_payout(&mut contract, campaign_id, "stable", 40);
        let before_logs = get_logs().len();
        let second = submit_test_payout(&mut contract, campaign_id, "stable", 40);
        assert_eq!(first, second);
        assert_eq!(contract.get_campaign(campaign_id).unwrap().reserved, 40);
        assert_eq!(contract.next_payout_id, 1);
        assert_eq!(get_logs().len(), before_logs);
    }

    #[test]
    fn payout_rejections_preserve_campaign_ids_records_and_events() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        for (caller, role) in [(accounts(4), None), (accounts(5), Some(UserRole::Verifier))] {
            if let Some(role) = role {
                set_context(accounts(1));
                contract.grant_role(caller.clone(), role);
            }
            set_context(caller);
            let before = contract.get_campaign(campaign_id).unwrap();
            assert!(
                catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                    &mut contract,
                    campaign_id,
                    "no",
                    1
                )))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
            assert_eq!(contract.next_payout_id, 0);
            assert_eq!(
                contract.get_payout_by_idempotency(campaign_id, "no".into()),
                None
            );
            assert!(
                get_logs()
                    .iter()
                    .all(|log| !log.contains("payout_reserved"))
            );
        }
    }

    #[test]
    fn global_pause_blocks_reservations_without_mutation() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        set_context(accounts(1));
        contract.pause();
        set_context(accounts(2));
        let before = contract.get_campaign(campaign_id).unwrap();
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                campaign_id,
                "paused",
                1
            )))
            .is_err()
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
        assert_eq!(contract.next_payout_id, 0);
        assert_eq!(contract.get_payout(0), None);
    }

    #[test]
    fn invalid_campaign_amount_token_and_balance_are_rejected() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let before = contract.get_campaign(campaign_id).unwrap();
        let fails =
            |contract: &mut Disburse, key: &str, input: TokenAmount, output: TokenAmount| {
                catch_unwind(AssertUnwindSafe(|| {
                    contract.create_payout(
                        campaign_id,
                        key.into(),
                        None,
                        payout_destination("addr"),
                        input,
                        output,
                    )
                }))
                .is_err()
            };
        set_context(accounts(2));
        assert!(fails(
            &mut contract,
            "zero-in",
            payout_amount(TokenId::near(accounts(3)), 0),
            payout_amount(TokenId::near(accounts(5)), 1)
        ));
        assert!(fails(
            &mut contract,
            "zero-out",
            payout_amount(TokenId::near(accounts(3)), 1),
            payout_amount(TokenId::near(accounts(5)), 0)
        ));
        assert!(fails(
            &mut contract,
            "wrong-token",
            payout_amount(TokenId::near(accounts(5)), 1),
            payout_amount(TokenId::near(accounts(5)), 1)
        ));
        assert!(fails(
            &mut contract,
            "too-much",
            payout_amount(TokenId::near(accounts(3)), 101),
            payout_amount(TokenId::near(accounts(5)), 1)
        ));
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
        assert_eq!(contract.next_payout_id, 0);
    }

    #[test]
    fn idempotency_key_payload_mismatch_and_campaign_scope() {
        let (mut contract, c1) = funded_active_campaign(100);
        set_context(accounts(2));
        let first = submit_test_payout(&mut contract, c1, "scope", 10);
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                c1,
                "scope",
                11
            )))
            .is_err()
        );
        let c2 = contract.create_campaign("second".into(), accounts(3), 100);
        set_context(accounts(1));
        contract.approve_campaign(c2);
        assert_eq!(
            receiver_unused(
                &mut contract,
                accounts(3),
                accounts(4),
                100,
                &format!("{{\"campaign_id\":{c2}}}")
            ),
            0
        );
        set_context(accounts(1));
        contract.grant_role(accounts(2), UserRole::Operator);
        set_context(accounts(2));
        contract.activate_campaign(c2);
        let second = submit_test_payout(&mut contract, c2, "scope", 10);
        assert_ne!(first, second);
        assert_eq!(contract.get_campaign(c1).unwrap().reserved, 10);
        assert_eq!(contract.get_campaign(c2).unwrap().reserved, 10);
    }

    #[test]
    fn idempotency_rejects_each_changed_request_field_and_blank_keys() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        set_context(accounts(2));
        submit_test_payout(&mut contract, campaign_id, "fields", 10);
        let baseline = || {
            (
                Some(accounts(4)),
                payout_destination("0xrecipient"),
                payout_amount(TokenId::near(accounts(3)), 10),
                payout_amount(TokenId::external("sol:usdc".to_string()).unwrap(), 95),
            )
        };
        for changed in [
            (
                None,
                payout_destination("0xrecipient"),
                payout_amount(TokenId::near(accounts(3)), 10),
                payout_amount(TokenId::external("sol:usdc".to_string()).unwrap(), 95),
            ),
            (
                Some(accounts(4)),
                payout_destination("another"),
                payout_amount(TokenId::near(accounts(3)), 10),
                payout_amount(TokenId::external("sol:usdc".to_string()).unwrap(), 95),
            ),
            (
                Some(accounts(4)),
                payout_destination("0xrecipient"),
                payout_amount(TokenId::near(accounts(3)), 10),
                payout_amount(TokenId::external("sol:usdc".to_string()).unwrap(), 94),
            ),
            (
                Some(accounts(4)),
                payout_destination("0xrecipient"),
                payout_amount(TokenId::near(accounts(3)), 10),
                payout_amount(TokenId::external("sol:other".to_string()).unwrap(), 95),
            ),
        ] {
            let before = contract.get_campaign(campaign_id).unwrap();
            assert!(
                catch_unwind(AssertUnwindSafe(|| contract.create_payout(
                    campaign_id,
                    "fields".into(),
                    changed.0,
                    changed.1,
                    changed.2,
                    changed.3
                )))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
            assert_eq!(contract.next_payout_id, 1);
        }
        let (recipient, destination, input, output) = baseline();
        for blank in ["", "  \t"] {
            assert!(
                catch_unwind(AssertUnwindSafe(|| contract.create_payout(
                    campaign_id,
                    blank.into(),
                    recipient.clone(),
                    destination.clone(),
                    input.clone(),
                    output.clone()
                )))
                .is_err()
            );
        }
        assert_eq!(contract.get_campaign(campaign_id).unwrap().reserved, 10);
        assert_eq!(contract.next_payout_id, 1);
    }

    #[test]
    fn exact_available_balance_can_be_reserved_and_spent_is_counted() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let mut campaign = contract.get_campaign(campaign_id).unwrap();
        campaign.reserved = 30;
        campaign.spent = 20;
        contract.campaigns.insert(campaign_id, campaign);
        set_context(accounts(2));
        let id = submit_test_payout(&mut contract, campaign_id, "remaining", 50);
        let updated = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(updated.reserved, 80);
        assert_eq!(updated.spent, 20);
        assert_eq!(
            contract
                .get_campaign_payout_accounting(campaign_id)
                .unwrap()
                .available,
            U128(0)
        );
        assert_eq!(
            contract.get_payout(id).unwrap().input_amount.atomic_amount,
            U128(50)
        );
    }

    #[test]
    fn nonexistent_campaign_and_available_balance_underflow_are_rejected() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        set_context(accounts(2));
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                999,
                "missing",
                1
            )))
            .is_err()
        );
        let mut campaign = contract.get_campaign(campaign_id).unwrap();
        campaign.reserved = 101;
        contract.campaigns.insert(campaign_id, campaign);
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                campaign_id,
                "underflow",
                1
            )))
            .is_err()
        );
        assert_eq!(contract.next_payout_id, 0);
        assert_eq!(contract.get_payout(0), None);
    }

    #[test]
    fn rejected_non_active_campaign_and_malformed_accounting_do_not_create_payout() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let mut campaign = contract.get_campaign(campaign_id).unwrap();
        campaign.status = CampaignStatus::Paused;
        contract.campaigns.insert(campaign_id, campaign.clone());
        set_context(accounts(2));
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                campaign_id,
                "inactive",
                1
            )))
            .is_err()
        );
        campaign.status = CampaignStatus::Active;
        campaign.reserved = u128::MAX;
        campaign.spent = 1;
        contract.campaigns.insert(campaign_id, campaign);
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                campaign_id,
                "overflow",
                1
            )))
            .is_err()
        );
        assert_eq!(contract.next_payout_id, 0);
        assert_eq!(contract.get_payout(0), None);
    }

    #[test]
    fn every_non_active_campaign_status_rejects_payout_creation() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        set_context(accounts(2));
        for status in [
            CampaignStatus::Draft,
            CampaignStatus::Approved,
            CampaignStatus::Paused,
            CampaignStatus::Cancelled,
            CampaignStatus::Completed,
        ] {
            let mut campaign = contract.get_campaign(campaign_id).unwrap();
            campaign.status = status;
            contract.campaigns.insert(campaign_id, campaign.clone());
            assert!(
                catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                    &mut contract,
                    campaign_id,
                    "inactive",
                    1
                )))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), campaign);
            assert_eq!(contract.next_payout_id, 0);
            assert_eq!(
                contract.get_payout_by_idempotency(campaign_id, "inactive".into()),
                None
            );
            assert!(
                get_logs()
                    .iter()
                    .all(|log| !log.contains("payout_reserved"))
            );
        }
    }

    #[test]
    fn payout_id_overflow_fails_before_any_persistent_write() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        contract.next_payout_id = u64::MAX;
        set_context(accounts(2));
        let before = contract.get_campaign(campaign_id).unwrap();
        assert!(
            catch_unwind(AssertUnwindSafe(|| submit_test_payout(
                &mut contract,
                campaign_id,
                "overflow-id",
                1
            )))
            .is_err()
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
        assert_eq!(contract.get_payout(u64::MAX), None);
        assert_eq!(
            contract.get_payout_by_idempotency(campaign_id, "overflow-id".into()),
            None
        );
    }

    #[test]
    fn reserved_payout_starts_execution_with_unique_reference_and_event() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = reserve_test_payout(&mut contract, campaign_id, "exec-start");
        let accounting = contract.get_campaign(campaign_id).unwrap();
        contract.start_payout_execution(payout_id, "tx:source:123".into());
        let payout = contract.get_payout(payout_id).unwrap();
        assert_eq!(payout.status, PayoutStatus::Executing);
        assert_eq!(payout.execution_reference.as_deref(), Some("tx:source:123"));
        let after = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(after.reserved, accounting.reserved);
        assert_eq!(after.spent, accounting.spent);
        assert_eq!(after.funded, accounting.funded);
        assert_eq!(after.budget, accounting.budget);
        let event: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(
            get_logs()
                .last()
                .unwrap()
                .strip_prefix("EVENT_JSON:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(event["event"], "payout_execution_started");
        assert_eq!(event["data"][0]["previous_status"], "Reserved");
        assert_eq!(event["data"][0]["new_status"], "Executing");
        assert_eq!(event["data"][0]["execution_reference"], "tx:source:123");
    }

    #[test]
    fn execution_reference_validation_is_strictly_unique_even_for_same_payout() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let first = reserve_test_payout(&mut contract, campaign_id, "reference-first");
        let second = reserve_test_payout(&mut contract, campaign_id, "reference-second");
        for invalid in ["", " \t", &"x".repeat(257)] {
            assert!(
                catch_unwind(AssertUnwindSafe(
                    || contract.start_payout_execution(first, invalid.to_string())
                ))
                .is_err()
            );
        }
        contract.start_payout_execution(first, "shared-ref".into());
        set_context(accounts(1));
        contract.grant_role(accounts(5), UserRole::Administrator);
        set_context(accounts(5));
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.start_payout_execution(second, "shared-ref".into())
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(second).unwrap().status,
            PayoutStatus::Reserved
        );
        // Existing index entry for this same payout must also cause a rejection.
        let third = reserve_test_payout(&mut contract, campaign_id, "reference-third");
        Disburse::execution_references().insert("same-owner-ref".into(), third);
        set_context(accounts(2));
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.start_payout_execution(third, "same-owner-ref".into())
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(third).unwrap().status,
            PayoutStatus::Reserved
        );
        assert_eq!(
            contract.get_payout(third).unwrap().execution_reference,
            None
        );
        assert_eq!(
            Disburse::execution_references().get(&"same-owner-ref".to_string()),
            Some(&third)
        );
        assert!(get_logs().is_empty());
    }

    #[test]
    fn only_executing_payout_can_be_marked_pending_verification() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let reserved = reserve_test_payout(&mut contract, campaign_id, "not-started");
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.mark_payout_pending_verification(reserved)
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(reserved).unwrap().status,
            PayoutStatus::Reserved
        );
        assert_eq!(contract.get_payout(999), None);
        contract.start_payout_execution(reserved, "tx:pending".into());
        let before = contract.get_campaign(campaign_id).unwrap();
        contract.mark_payout_pending_verification(reserved);
        let payout = contract.get_payout(reserved).unwrap();
        assert_eq!(payout.status, PayoutStatus::PendingVerification);
        assert_eq!(payout.execution_reference.as_deref(), Some("tx:pending"));
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
        let event: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(
            get_logs()
                .last()
                .unwrap()
                .strip_prefix("EVENT_JSON:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(event["event"], "payout_pending_verification");
        assert_eq!(event["data"][0]["previous_status"], "Executing");
        assert_eq!(event["data"][0]["new_status"], "PendingVerification");
    }

    #[test]
    fn operator_admin_and_owner_can_transition_but_verifier_cannot() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let operator_payout = reserve_test_payout(&mut contract, campaign_id, "auth-op");
        contract.start_payout_execution(operator_payout, "tx:operator".into());
        contract.mark_payout_pending_verification(operator_payout);

        let admin_payout = reserve_test_payout(&mut contract, campaign_id, "auth-admin");
        set_context(accounts(1));
        contract.grant_role(accounts(5), UserRole::Administrator);
        set_context(accounts(5));
        contract.start_payout_execution(admin_payout, "tx:admin".into());

        let owner_payout = reserve_test_payout(&mut contract, campaign_id, "auth-owner");
        set_context(accounts(1));
        contract.start_payout_execution(owner_payout, "tx:owner".into());

        set_context(accounts(1));
        contract.grant_role(accounts(4), UserRole::Verifier);
        set_context(accounts(4));
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.mark_payout_pending_verification(admin_payout)
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(admin_payout).unwrap().status,
            PayoutStatus::Executing
        );
        assert!(
            get_logs()
                .iter()
                .all(|log| !log.contains("payout_pending_verification"))
        );
    }

    #[test]
    fn definitive_failure_from_executing_and_pending_retains_reservation_and_reason() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let executing = reserve_test_payout(&mut contract, campaign_id, "fail-executing");
        let before = contract.get_campaign(campaign_id).unwrap();
        contract.start_payout_execution(executing, "tx:reverted-a".into());
        contract.mark_payout_failed(executing, definitive_failure("receipt:reverted-a"));
        let failed = contract.get_payout(executing).unwrap();
        assert_eq!(failed.status, PayoutStatus::Failed);
        assert_eq!(
            failed.failure_evidence,
            Some(definitive_failure("receipt:reverted-a"))
        );
        assert_eq!(
            failed.lifecycle_reason.as_deref(),
            Some("Source transaction has a terminal reverted status")
        );
        assert_eq!(failed.execution_reference.as_deref(), Some("tx:reverted-a"));
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
        let event: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(
            get_logs()
                .last()
                .unwrap()
                .strip_prefix("EVENT_JSON:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(event["event"], "payout_execution_failed");
        assert_eq!(event["data"][0]["previous_status"], "Executing");
        assert_eq!(event["data"][0]["new_status"], "Failed");
        assert_eq!(event["data"][0]["evidence_reference"], "receipt:reverted-a");

        let pending = reserve_test_payout(&mut contract, campaign_id, "fail-pending");
        let before_pending = contract.get_campaign(campaign_id).unwrap();
        contract.start_payout_execution(pending, "tx:reverted-b".into());
        contract.mark_payout_pending_verification(pending);
        assert!(
            catch_unwind(AssertUnwindSafe(|| contract.mark_payout_failed(
                pending,
                ExecutionFailureEvidence {
                    kind: ExecutionFailureKind::RejectedBeforeSubmission,
                    evidence_reference: "provider:rejected".into(),
                    reason: "Pre-submission rejection".into(),
                }
            )))
            .is_err()
        );
        contract.mark_payout_failed(pending, definitive_failure("receipt:reverted-b"));
        assert_eq!(
            contract.get_payout(pending).unwrap().status,
            PayoutStatus::Failed
        );
        assert_eq!(
            contract
                .get_campaign_payout(campaign_id, pending)
                .unwrap()
                .failure_evidence,
            Some(definitive_failure("receipt:reverted-b"))
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before_pending);
    }

    #[test]
    fn failure_evidence_persists_all_fields_and_is_scoped_to_its_payout() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let rejected = reserve_test_payout(&mut contract, campaign_id, "evidence-rejected");
        let unfailed = reserve_test_payout(&mut contract, campaign_id, "evidence-absent");
        let rejected_evidence = ExecutionFailureEvidence {
            kind: ExecutionFailureKind::RejectedBeforeSubmission,
            evidence_reference: "signer:reject-42".into(),
            reason: "Transaction was definitively rejected before broadcast".into(),
        };
        assert_eq!(
            contract.get_payout(rejected).unwrap().failure_evidence,
            None
        );
        assert_eq!(
            contract
                .get_campaign_payout(campaign_id, unfailed)
                .unwrap()
                .failure_evidence,
            None
        );
        contract.start_payout_execution(rejected, "attempt:reject-42".into());
        contract.mark_payout_failed(rejected, rejected_evidence.clone());

        let reverted = reserve_test_payout(&mut contract, campaign_id, "evidence-reverted");
        let reverted_evidence = ExecutionFailureEvidence {
            kind: ExecutionFailureKind::TransactionReverted,
            evidence_reference: "chain:receipt-99".into(),
            reason: "Source transaction has a terminal reverted status".into(),
        };
        contract.start_payout_execution(reverted, "attempt:reverted-99".into());
        contract.mark_payout_pending_verification(reverted);
        contract.mark_payout_failed(reverted, reverted_evidence.clone());

        assert_eq!(
            contract.get_payout(rejected).unwrap().failure_evidence,
            Some(rejected_evidence.clone())
        );
        assert_eq!(
            contract
                .get_campaign_payout(campaign_id, rejected)
                .unwrap()
                .failure_evidence,
            Some(rejected_evidence)
        );
        assert_eq!(
            contract.get_payout(reverted).unwrap().failure_evidence,
            Some(reverted_evidence.clone())
        );
        assert_eq!(
            contract
                .get_campaign_payout(campaign_id, reverted)
                .unwrap()
                .failure_evidence,
            Some(reverted_evidence)
        );
        assert_eq!(
            contract.get_payout(unfailed).unwrap().failure_evidence,
            None
        );
        assert_eq!(
            contract
                .get_campaign_payout(campaign_id, unfailed)
                .unwrap()
                .failure_evidence,
            None
        );
        assert_eq!(contract.get_payout(999), None);
        assert_eq!(contract.get_campaign_payout(campaign_id, 999), None);
    }

    #[test]
    fn manual_review_from_execution_states_keeps_reservation_and_reference() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let executing = reserve_test_payout(&mut contract, campaign_id, "review-executing");
        let before = contract.get_campaign(campaign_id).unwrap();
        contract.start_payout_execution(executing, "tx:uncertain-a".into());
        contract.move_payout_to_manual_review(executing, "Broadcast outcome is uncertain".into());
        let review = contract.get_payout(executing).unwrap();
        assert_eq!(review.status, PayoutStatus::ManualReview);
        assert_eq!(
            review.execution_reference.as_deref(),
            Some("tx:uncertain-a")
        );
        assert_eq!(
            review.lifecycle_reason.as_deref(),
            Some("Broadcast outcome is uncertain")
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);

        let pending = reserve_test_payout(&mut contract, campaign_id, "review-pending");
        let before_pending = contract.get_campaign(campaign_id).unwrap();
        contract.start_payout_execution(pending, "tx:uncertain-b".into());
        contract.mark_payout_pending_verification(pending);
        contract
            .move_payout_to_manual_review(pending, "Provider and chain evidence disagree".into());
        assert_eq!(
            contract.get_payout(pending).unwrap().status,
            PayoutStatus::ManualReview
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before_pending);
    }

    #[test]
    fn failure_and_manual_review_are_available_during_pause_but_submission_is_blocked() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let failing = reserve_test_payout(&mut contract, campaign_id, "pause-fail");
        contract.start_payout_execution(failing, "tx:pause-fail".into());
        let reviewing = reserve_test_payout(&mut contract, campaign_id, "pause-review");
        contract.start_payout_execution(reviewing, "tx:pause-review".into());
        set_context(accounts(1));
        contract.pause();
        set_context(accounts(2));
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.mark_payout_pending_verification(reviewing)
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(reviewing).unwrap().status,
            PayoutStatus::Executing
        );
        contract.mark_payout_failed(failing, definitive_failure("receipt:pause-fail"));
        contract.move_payout_to_manual_review(reviewing, "Uncertain while paused".into());
        assert_eq!(
            contract.get_payout(failing).unwrap().status,
            PayoutStatus::Failed
        );
        assert_eq!(
            contract.get_payout(reviewing).unwrap().status,
            PayoutStatus::ManualReview
        );
    }

    #[test]
    fn invalid_lifecycle_reasons_and_terminal_restarts_are_rejected_without_events() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = reserve_test_payout(&mut contract, campaign_id, "invalid-lifecycle");
        let before = contract.get_campaign(campaign_id).unwrap();
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.mark_payout_failed(payout_id, definitive_failure("evidence"))
            ))
            .is_err()
        );
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.move_payout_to_manual_review(payout_id, "review".into())
            ))
            .is_err()
        );
        contract.start_payout_execution(payout_id, "tx:terminal".into());
        assert!(
            catch_unwind(AssertUnwindSafe(|| contract.mark_payout_failed(
                payout_id,
                ExecutionFailureEvidence {
                    kind: ExecutionFailureKind::TransactionReverted,
                    evidence_reference: "".into(),
                    reason: "failed".into()
                }
            )))
            .is_err()
        );
        assert!(
            catch_unwind(AssertUnwindSafe(|| contract.mark_payout_failed(
                payout_id,
                ExecutionFailureEvidence {
                    kind: ExecutionFailureKind::TransactionReverted,
                    evidence_reference: "receipt".into(),
                    reason: " ".repeat(513)
                }
            )))
            .is_err()
        );
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.move_payout_to_manual_review(payout_id, "".into())
            ))
            .is_err()
        );
        contract.mark_payout_failed(payout_id, definitive_failure("receipt:terminal"));
        let failed = contract.get_payout(payout_id).unwrap();
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.start_payout_execution(payout_id, "retry".into())
            ))
            .is_err()
        );
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.move_payout_to_manual_review(payout_id, "late review".into())
            ))
            .is_err()
        );
        assert_eq!(contract.get_payout(payout_id).unwrap(), failed);
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
        assert!(
            get_logs()
                .iter()
                .all(|log| !log.contains("\"new_status\":\"Succeeded\""))
        );
    }

    #[test]
    fn global_pause_blocks_starting_execution_and_nonexistent_payouts_fail() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = reserve_test_payout(&mut contract, campaign_id, "pause-start");
        set_context(accounts(1));
        contract.pause();
        set_context(accounts(2));
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.start_payout_execution(payout_id, "tx:paused".into())
            ))
            .is_err()
        );
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.start_payout_execution(999, "tx:missing".into())
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(payout_id).unwrap().status,
            PayoutStatus::Reserved
        );
    }

    #[test]
    fn verifier_settlement_matches_payout_and_moves_reserved_input_to_spent() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = pending_test_payout(&mut contract, campaign_id, "settle-valid");
        let before = contract.get_campaign(campaign_id).unwrap();
        grant_verifier(&mut contract, accounts(5));
        set_context(accounts(1));
        contract.pause();
        set_context(accounts(5));
        let evidence = settlement_evidence(payout_id, accounts(5));
        contract.settle_payout(payout_id, evidence.clone());

        let after = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(after.reserved, before.reserved - 10);
        assert_eq!(after.spent, before.spent + 10);
        assert_eq!(after.funded, before.funded);
        assert_eq!(after.budget, before.budget);
        assert!(after.reserved + after.spent <= after.funded);
        let payout = contract.get_payout(payout_id).unwrap();
        assert_eq!(payout.status, PayoutStatus::Succeeded);
        assert_eq!(payout.settlement_evidence, Some(evidence.clone()));
        assert_eq!(
            payout.settlement_evidence_reference,
            evidence.evidence_reference
        );
        let campaign_view = contract
            .get_campaign_payout(campaign_id, payout_id)
            .unwrap();
        assert_eq!(campaign_view.settlement_evidence, Some(evidence));
        assert_eq!(campaign_view, payout);
        let event: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(
            get_logs()
                .last()
                .unwrap()
                .strip_prefix("EVENT_JSON:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(event["event"], "payout_settled");
        assert_eq!(event["data"][0]["verifier_id"], accounts(5).as_str());
        assert_eq!(event["data"][0]["destination_chain_id"], "eip155:1");
        assert_eq!(event["data"][0]["execution_id"], format!("0xtx{payout_id}"));
        assert_eq!(event["data"][0]["actual_output_amount"], "95");
        assert_eq!(event["data"][0]["input_amount_moved_to_spent"], "10");
        assert_eq!(event["data"][0]["content_hash"], "a".repeat(64));
    }

    #[test]
    fn only_explicit_verifiers_can_settle() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = pending_test_payout(&mut contract, campaign_id, "settle-auth");
        let before_campaign = contract.get_campaign(campaign_id).unwrap();
        let before_payout = contract.get_payout(payout_id).unwrap();
        set_context(accounts(1));
        contract.grant_role(accounts(4), UserRole::Administrator);

        for caller in [accounts(2), accounts(4), accounts(1)] {
            set_context(caller.clone());
            let evidence = settlement_evidence(payout_id, caller);
            assert!(
                catch_unwind(AssertUnwindSafe(
                    || contract.settle_payout(payout_id, evidence)
                ))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), before_campaign);
            assert_eq!(contract.get_payout(payout_id).unwrap(), before_payout);
            assert!(get_logs().iter().all(|log| !log.contains("payout_settled")));
        }

        set_context(accounts(1));
        contract.grant_role(accounts(5), UserRole::Verifier);
        set_context(accounts(5));
        contract.settle_payout(payout_id, settlement_evidence(payout_id, accounts(5)));

        set_context(accounts(1));
        contract.grant_role(accounts(2), UserRole::Verifier);
        set_context(accounts(2));
        let both_roles = pending_test_payout(&mut contract, campaign_id, "settle-dual-role");
        contract.settle_payout(both_roles, settlement_evidence(both_roles, accounts(2)));
    }

    #[test]
    fn verifier_cannot_self_grant_verifier_role() {
        let mut contract = new_contract();
        set_context(accounts(1));
        contract.grant_role(accounts(5), UserRole::Verifier);
        set_context(accounts(5));
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.grant_role(accounts(5), UserRole::Verifier)
            ))
            .is_err()
        );
        assert!(contract.has_role(accounts(5), UserRole::Verifier));
    }

    #[test]
    fn settlement_rejects_mismatched_or_malformed_evidence_without_consuming_it() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = pending_test_payout(&mut contract, campaign_id, "settle-validation");
        grant_verifier(&mut contract, accounts(5));
        let original = settlement_evidence(payout_id, accounts(5));
        let before_campaign = contract.get_campaign(campaign_id).unwrap();
        let before_payout = contract.get_payout(payout_id).unwrap();

        let mut variants = Vec::new();
        let mut evidence = original.clone();
        evidence.destination_chain_id =
            types::destination::ChainId::new("unknown:chain".into()).unwrap();
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.recipient_address =
            types::destination::RecipientAddress::new("wrong-recipient".into()).unwrap();
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.output_amount =
            TokenAmount::new(TokenId::external("other:token".into()).unwrap(), 95, 18);
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.output_amount =
            TokenAmount::new(TokenId::external("sol:usdc".into()).unwrap(), 94, 18);
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.payout_id = 999;
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.verifier_id = accounts(4);
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.destination_transaction_reference = " ".into();
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.destination_transaction_reference = "x".repeat(257);
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.destination_chain_id = types::destination::ChainId::new("c".repeat(129)).unwrap();
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.recipient_address =
            types::destination::RecipientAddress::new("r".repeat(257)).unwrap();
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.output_amount =
            TokenAmount::new(TokenId::external("t".repeat(257)).unwrap(), 95, 6);
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.transaction_event_identifier = Some(" ".into());
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.evidence_reference = Some("".into());
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.evidence_reference = Some("r".repeat(257));
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.content_hash = "not-a-sha256".into();
        variants.push(evidence);
        let mut evidence = original.clone();
        evidence.verification_method = " ".into();
        variants.push(evidence);

        for invalid in variants {
            set_context(accounts(5));
            assert!(
                catch_unwind(AssertUnwindSafe(
                    || contract.settle_payout(payout_id, invalid)
                ))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), before_campaign);
            assert_eq!(contract.get_payout(payout_id).unwrap(), before_payout);
            assert!(
                Disburse::settlement_execution_index()
                    .get(&(
                        original.provider_id.clone(),
                        original.destination_chain_id.as_str().to_string(),
                        original.destination_transaction_reference.clone(),
                        original.transaction_event_identifier.clone(),
                    ))
                    .is_none()
            );
            assert!(
                Disburse::settlement_reference_index()
                    .get(original.evidence_reference.as_ref().unwrap())
                    .is_none()
            );
            assert!(get_logs().iter().all(|log| !log.contains("payout_settled")));
        }

        // The identical valid evidence remains usable after all rejected attempts.
        contract.settle_payout(payout_id, original);
        assert_eq!(
            contract.get_payout(payout_id).unwrap().status,
            PayoutStatus::Succeeded
        );
    }

    #[test]
    fn settlement_replay_is_global_and_event_index_distinguishes_logs() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let first = pending_test_payout(&mut contract, campaign_id, "replay-first");
        let second = pending_test_payout(&mut contract, campaign_id, "replay-second");
        grant_verifier(&mut contract, accounts(5));
        let mut evidence1 = settlement_evidence(first, accounts(5));
        evidence1.destination_transaction_reference = "0xsharedtx".into();
        evidence1.transaction_event_identifier = Some("3".into());
        evidence1.evidence_reference = Some("evidence:shared-3".into());
        contract.settle_payout(first, evidence1.clone());

        let mut same_execution = evidence1.clone();
        same_execution.payout_id = second;
        same_execution.evidence_reference = Some("evidence:other-ref".into());
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.settle_payout(second, same_execution)
            ))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(second).unwrap().status,
            PayoutStatus::PendingVerification
        );

        let mut different_log = evidence1.clone();
        different_log.payout_id = second;
        different_log.transaction_event_identifier = Some("4".into());
        different_log.evidence_reference = Some("evidence:shared-4".into());
        contract.settle_payout(second, different_log);
        assert_eq!(
            contract.get_payout(second).unwrap().status,
            PayoutStatus::Succeeded
        );

        let event_count = get_logs()
            .iter()
            .filter(|log| log.contains("\"event\":\"payout_settled\""))
            .count();
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.settle_payout(first, evidence1.clone())
            ))
            .is_err()
        );
        assert_eq!(
            get_logs()
                .iter()
                .filter(|log| log.contains("\"event\":\"payout_settled\""))
                .count(),
            event_count
        );
    }

    #[test]
    fn duplicate_evidence_reference_is_rejected_and_does_not_consume_execution_key() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let first = pending_test_payout(&mut contract, campaign_id, "duplicate-ref-first");
        let second = pending_test_payout(&mut contract, campaign_id, "duplicate-ref-second");
        grant_verifier(&mut contract, accounts(5));
        let mut first_evidence = settlement_evidence(first, accounts(5));
        first_evidence.evidence_reference = Some("same-reference".into());
        contract.settle_payout(first, first_evidence);

        let mut second_evidence = settlement_evidence(second, accounts(5));
        second_evidence.evidence_reference = Some("same-reference".into());
        let key = (
            second_evidence.provider_id.clone(),
            second_evidence.destination_chain_id.as_str().to_string(),
            second_evidence.destination_transaction_reference.clone(),
            second_evidence.transaction_event_identifier.clone(),
        );
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.settle_payout(second, second_evidence.clone())
            ))
            .is_err()
        );
        assert!(Disburse::settlement_execution_index().get(&key).is_none());
        assert_eq!(
            contract.get_payout(second).unwrap().status,
            PayoutStatus::PendingVerification
        );
        second_evidence.evidence_reference = Some("unique-reference".into());
        contract.settle_payout(second, second_evidence);
        assert_eq!(
            contract.get_payout(second).unwrap().status,
            PayoutStatus::Succeeded
        );
    }

    #[test]
    fn only_pending_verification_can_settle_and_failed_manual_review_keep_reservations() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let reserved = reserve_test_payout(&mut contract, campaign_id, "state-reserved");
        let executing = reserve_test_payout(&mut contract, campaign_id, "state-executing");
        contract.start_payout_execution(executing, "execution:state-executing".into());
        let failed = reserve_test_payout(&mut contract, campaign_id, "state-failed");
        contract.start_payout_execution(failed, "execution:state-failed".into());
        contract.mark_payout_failed(failed, definitive_failure("failure:evidence"));
        let manual = reserve_test_payout(&mut contract, campaign_id, "state-manual");
        contract.start_payout_execution(manual, "execution:state-manual".into());
        contract.move_payout_to_manual_review(manual, "uncertain".into());
        let before = contract.get_campaign(campaign_id).unwrap();

        grant_verifier(&mut contract, accounts(5));
        for payout_id in [reserved, executing, failed, manual] {
            let payout_before = contract.get_payout(payout_id).unwrap();
            assert!(
                catch_unwind(AssertUnwindSafe(|| contract.settle_payout(
                    payout_id,
                    settlement_evidence(payout_id, accounts(5)),
                )))
                .is_err()
            );
            assert_eq!(contract.get_payout(payout_id).unwrap(), payout_before);
            assert!(
                contract
                    .get_payout(payout_id)
                    .unwrap()
                    .settlement_evidence
                    .is_none()
            );
        }
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
    }

    #[test]
    fn accounting_underflow_and_overflow_reject_settlement_without_partial_writes() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = pending_test_payout(&mut contract, campaign_id, "accounting-underflow");
        grant_verifier(&mut contract, accounts(5));
        let evidence = settlement_evidence(payout_id, accounts(5));
        let mut campaign = contract.get_campaign(campaign_id).unwrap();
        campaign.reserved = 9;
        contract.campaigns.insert(campaign_id, campaign.clone());
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.settle_payout(payout_id, evidence.clone())
            ))
            .is_err()
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), campaign);
        assert_eq!(
            contract.get_payout(payout_id).unwrap().status,
            PayoutStatus::PendingVerification
        );
        assert!(
            Disburse::payout_settlement_evidence()
                .get(&payout_id)
                .is_none()
        );

        campaign.reserved = 10;
        campaign.spent = u128::MAX;
        contract.campaigns.insert(campaign_id, campaign.clone());
        assert!(
            catch_unwind(AssertUnwindSafe(
                || contract.settle_payout(payout_id, evidence.clone())
            ))
            .is_err()
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), campaign);
        assert!(
            Disburse::payout_settlement_evidence()
                .get(&payout_id)
                .is_none()
        );

        // Restore a consistent campaign and prove failed attempts left the identifiers available.
        campaign.spent = 0;
        contract.campaigns.insert(campaign_id, campaign);
        contract.settle_payout(payout_id, evidence);
        assert_eq!(
            contract.get_payout(payout_id).unwrap().status,
            PayoutStatus::Succeeded
        );
    }

    #[test]
    fn failed_payout_release_requires_verifier_and_failure_evidence() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = failed_test_payout(&mut contract, campaign_id, "recover-failed-auth");
        let before_campaign = contract.get_campaign(campaign_id).unwrap();
        let before_payout = contract.get_payout(payout_id).unwrap();

        set_context(accounts(1));
        contract.grant_role(accounts(4), UserRole::Administrator);
        for caller in [accounts(2), accounts(4), accounts(1)] {
            set_context(caller.clone());
            let evidence = resolution_evidence(
                payout_id,
                caller,
                PayoutResolutionOutcome::NonSettlementConfirmed,
                "recover:failed-auth",
            );
            assert!(
                catch_unwind(AssertUnwindSafe(|| {
                    contract.release_failed_payout_reservation(payout_id, evidence)
                }))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), before_campaign);
            assert_eq!(contract.get_payout(payout_id).unwrap(), before_payout);
        }

        grant_verifier(&mut contract, accounts(5));
        let mut wrong_verifier = resolution_evidence(
            payout_id,
            accounts(3),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "recover:failed-auth",
        );
        set_context(accounts(5));
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.release_failed_payout_reservation(payout_id, wrong_verifier.clone())
            }))
            .is_err()
        );
        assert_eq!(contract.get_campaign(campaign_id).unwrap(), before_campaign);

        wrong_verifier.verifier_id = accounts(5);
        contract.release_failed_payout_reservation(payout_id, wrong_verifier);
        let after = contract.get_campaign(campaign_id).unwrap();
        assert_eq!(after.reserved, before_campaign.reserved - 10);
        assert_eq!(after.spent, before_campaign.spent);
        assert_eq!(after.funded, before_campaign.funded);
        assert_eq!(after.budget, before_campaign.budget);
        let released = contract.get_payout(payout_id).unwrap();
        assert_eq!(released.status, PayoutStatus::ReservationReleased);
        assert!(released.resolution_evidence.is_some());
        let logs = get_logs();
        let event = logs.last().unwrap();
        assert!(event.contains("failed_payout_reservation_released"));
        assert!(event.contains("\"released_input_amount\":\"10\""));

        set_context(accounts(2));
        let missing_evidence_payout = failed_test_payout(
            &mut contract,
            campaign_id,
            "recover-missing-failure-evidence",
        );
        set_context(accounts(5));
        let resolution = resolution_evidence(
            missing_evidence_payout,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "recover:missing-failure",
        );
        Disburse::payout_failure_evidence().remove(&missing_evidence_payout);
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.release_failed_payout_reservation(missing_evidence_payout, resolution)
            }))
            .is_err()
        );
    }

    #[test]
    fn manual_review_execution_confirmation_preserves_reservation_then_settles_normally() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = manual_review_test_payout(&mut contract, campaign_id, "recover-executed");
        let before = contract
            .get_campaign_payout_accounting(campaign_id)
            .unwrap();
        grant_verifier(&mut contract, accounts(5));
        let evidence = resolution_evidence(
            payout_id,
            accounts(5),
            PayoutResolutionOutcome::ExecutionConfirmed,
            "recover:executed",
        );
        contract.confirm_manual_review_execution(payout_id, evidence.clone());

        let pending = contract.get_payout(payout_id).unwrap();
        assert_eq!(pending.status, PayoutStatus::PendingVerification);
        assert_eq!(
            pending.execution_reference,
            Some("execution:recover-executed".into())
        );
        assert_eq!(pending.resolution_evidence, Some(evidence));
        let after_resolution = contract
            .get_campaign_payout_accounting(campaign_id)
            .unwrap();
        assert_eq!(after_resolution.reserved, before.reserved);
        assert_eq!(after_resolution.spent, before.spent);
        assert!(
            get_logs()
                .last()
                .unwrap()
                .contains("manual_review_execution_confirmed")
        );

        contract.settle_payout(payout_id, settlement_evidence(payout_id, accounts(5)));
        assert_eq!(
            contract.get_payout(payout_id).unwrap().status,
            PayoutStatus::Succeeded
        );
        let settled = contract
            .get_campaign_payout_accounting(campaign_id)
            .unwrap();
        assert_eq!(settled.reserved.0, before.reserved.0 - 10);
        assert_eq!(settled.spent.0, before.spent.0 + 10);
    }

    #[test]
    fn manual_review_non_settlement_releases_only_reserved_funds() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id =
            manual_review_test_payout(&mut contract, campaign_id, "recover-not-executed");
        let before = contract
            .get_campaign_payout_accounting(campaign_id)
            .unwrap();
        grant_verifier(&mut contract, accounts(5));
        let evidence = resolution_evidence(
            payout_id,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "recover:not-executed",
        );
        contract.release_manual_review_reservation(payout_id, evidence.clone());

        let released = contract.get_payout(payout_id).unwrap();
        assert_eq!(released.status, PayoutStatus::ReservationReleased);
        assert_eq!(released.resolution_evidence, Some(evidence));
        let after = contract
            .get_campaign_payout_accounting(campaign_id)
            .unwrap();
        assert_eq!(after.reserved.0, before.reserved.0 - 10);
        assert_eq!(after.spent, before.spent);
        assert_eq!(after.funded, before.funded);
        assert_eq!(after.budget, before.budget);
        assert_eq!(after.available.0, before.available.0 + 10);
        assert!(
            get_logs()
                .last()
                .unwrap()
                .contains("manual_review_non_settlement_confirmed")
        );

        let unchanged = after.clone();
        let repeat = resolution_evidence(
            payout_id,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "recover:not-executed-again",
        );
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.release_manual_review_reservation(payout_id, repeat)
            }))
            .is_err()
        );
        assert_eq!(
            contract
                .get_campaign_payout_accounting(campaign_id)
                .unwrap(),
            unchanged
        );

        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.start_payout_execution(payout_id, "again".into())
            }))
            .is_err()
        );
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.settle_payout(payout_id, settlement_evidence(payout_id, accounts(5)))
            }))
            .is_err()
        );
    }

    #[test]
    fn recovery_evidence_and_nonsettlement_execution_identity_share_settlement_replay_indexes() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let released_id =
            manual_review_test_payout(&mut contract, campaign_id, "cross-replay-release");
        let pending_id = pending_test_payout(&mut contract, campaign_id, "cross-replay-settle");
        grant_verifier(&mut contract, accounts(5));

        let mut release = resolution_evidence(
            released_id,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "cross-path:recovery-ref",
        );
        let mut later_settlement = settlement_evidence(pending_id, accounts(5));
        release.external_execution = Some(ExternalExecutionIdentity {
            provider_id: later_settlement.provider_id.clone(),
            destination_chain_id: later_settlement.destination_chain_id.clone(),
            execution_reference: later_settlement.destination_transaction_reference.clone(),
            transaction_event_identifier: later_settlement.transaction_event_identifier.clone(),
        });
        contract.release_manual_review_reservation(released_id, release.clone());

        later_settlement.evidence_reference = Some("cross-path:settlement-ref".into());
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.settle_payout(pending_id, later_settlement.clone())
            }))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(pending_id).unwrap().status,
            PayoutStatus::PendingVerification
        );

        set_context(accounts(2));
        let second_failed = failed_test_payout(&mut contract, campaign_id, "cross-replay-ref");
        set_context(accounts(5));
        let conflicting_reference = resolution_evidence(
            second_failed,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            release.evidence_reference.as_str(),
        );
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.release_failed_payout_reservation(second_failed, conflicting_reference)
            }))
            .is_err()
        );
        assert_eq!(
            contract.get_payout(second_failed).unwrap().status,
            PayoutStatus::Failed
        );
    }

    #[test]
    fn settlement_reference_cannot_be_reused_for_recovery_and_recovery_identity_is_not_consumed_on_failure()
     {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let settled_id = pending_test_payout(&mut contract, campaign_id, "settled-before-recovery");
        let failed_id = failed_test_payout(&mut contract, campaign_id, "recovery-after-settlement");
        grant_verifier(&mut contract, accounts(5));
        let mut settlement = settlement_evidence(settled_id, accounts(5));
        settlement.evidence_reference = Some("shared:reference".into());
        contract.settle_payout(settled_id, settlement);

        let mut recovery = resolution_evidence(
            failed_id,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "shared:reference",
        );
        let failed_key = recovery.external_execution.as_ref().unwrap();
        let index_key = Disburse::external_execution_key(failed_key);
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.release_failed_payout_reservation(failed_id, recovery.clone())
            }))
            .is_err()
        );
        assert!(
            Disburse::settlement_execution_index()
                .get(&index_key)
                .is_none()
        );
        assert!(
            Disburse::payout_resolution_evidence()
                .get(&failed_id)
                .is_none()
        );
        assert_eq!(
            contract.get_payout(failed_id).unwrap().status,
            PayoutStatus::Failed
        );

        recovery.evidence_reference = "recovery:unique-reference".into();
        contract.release_failed_payout_reservation(failed_id, recovery);
        assert!(
            Disburse::settlement_execution_index()
                .get(&index_key)
                .is_some()
        );
    }

    #[test]
    fn malformed_recovery_evidence_and_accounting_leave_state_unchanged() {
        let (mut contract, campaign_id) = funded_active_campaign(100);
        let payout_id = failed_test_payout(&mut contract, campaign_id, "recover-invalid");
        grant_verifier(&mut contract, accounts(5));
        let before = contract.get_campaign(campaign_id).unwrap();
        let invalid_evidence = [
            {
                let mut evidence = resolution_evidence(
                    payout_id,
                    accounts(5),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "invalid:empty-ref",
                );
                evidence.evidence_reference.clear();
                evidence
            },
            {
                let mut evidence = resolution_evidence(
                    payout_id,
                    accounts(5),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "invalid:long-ref",
                );
                evidence.evidence_reference = "r".repeat(257);
                evidence
            },
            {
                let mut evidence = resolution_evidence(
                    payout_id,
                    accounts(5),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "invalid:hash",
                );
                evidence.content_hash = "bad".into();
                evidence
            },
            {
                let mut evidence = resolution_evidence(
                    payout_id,
                    accounts(5),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "invalid:reason",
                );
                evidence.reason = " ".into();
                evidence
            },
            {
                let mut evidence = resolution_evidence(
                    payout_id,
                    accounts(5),
                    PayoutResolutionOutcome::NonSettlementConfirmed,
                    "invalid:outcome",
                );
                evidence.outcome = PayoutResolutionOutcome::ExecutionConfirmed;
                evidence
            },
        ];
        for evidence in invalid_evidence {
            assert!(
                catch_unwind(AssertUnwindSafe(|| {
                    contract.release_failed_payout_reservation(payout_id, evidence)
                }))
                .is_err()
            );
            assert_eq!(contract.get_campaign(campaign_id).unwrap(), before);
            assert_eq!(
                contract.get_payout(payout_id).unwrap().status,
                PayoutStatus::Failed
            );
        }

        let good = resolution_evidence(
            payout_id,
            accounts(5),
            PayoutResolutionOutcome::NonSettlementConfirmed,
            "recover:accounting-underflow",
        );
        let mut inconsistent = contract.campaigns.get(&campaign_id).unwrap().clone();
        inconsistent.reserved = 9;
        contract.campaigns.insert(campaign_id, inconsistent.clone());
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                contract.release_failed_payout_reservation(payout_id, good.clone())
            }))
            .is_err()
        );
        assert_eq!(contract.campaigns.get(&campaign_id), Some(&inconsistent));
        assert!(
            Disburse::settlement_reference_index()
                .get(&good.evidence_reference)
                .is_none()
        );
        assert!(
            Disburse::payout_resolution_evidence()
                .get(&payout_id)
                .is_none()
        );
    }
}
