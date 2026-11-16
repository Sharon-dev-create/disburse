//! Native authorization and immutable binding. Execution lives in the private execution module.
use crate::{Disburse, DisburseExt, PayoutRequest, state::native::*, *};
use near_sdk::{borsh, json_types::U64};
use types::destination::{ChainId, RecipientAddress};

const CONFIG_KEY: &[u8] = b"native-config-v1";
const MODE_PREFIX: &[u8] = b"native-payout-mode-v1";
const PAYOUT_PREFIX: &[u8] = b"native-payout-records-v1";
const AUTH_PREFIX: &[u8] = b"native-authorization-records-v1";
const ATTEMPT_PREFIX: &[u8] = b"native-attempt-records-v1";
const ROLE_PREFIX: &[u8] = b"native-role-assignments-v1";
const RECIPIENT_PREFIX: &[u8] = b"native-recipient-approvals-v1";

#[near]
impl Disburse {
    /// Sidecar bootstrap only: legacy STATE is read/validated, never rewritten here.
    /// No live initialization, deployment or migration is authorized by M5-B.
    pub fn initialize_native_execution(
        &mut self,
        expected_legacy_state_hash: String,
        max_payout_amount: U128,
        max_authorization_ttl_ns: U64,
    ) {
        self.assert_owner();
        require!(self.paused, "Pause required for native bootstrap");
        require!(
            env::current_account_id().as_str() == CONTRACT,
            "Wrong native contract"
        );
        require!(
            !env::storage_has_key(CONFIG_KEY),
            "Native storage already initialized"
        );
        Self::require_digest(&expected_legacy_state_hash);
        let raw =
            env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("Missing legacy STATE"));
        let old = borsh::from_slice::<Disburse>(&raw)
            .unwrap_or_else(|_| env::panic_str("Incompatible legacy STATE"));
        require!(
            borsh::to_vec(&old).unwrap() == borsh::to_vec(self).unwrap(),
            "Legacy STATE differs from current state"
        );
        require!(
            Self::native_hash(&raw) == expected_legacy_state_hash,
            "Legacy STATE hash mismatch"
        );
        self.assert_legacy_storage_prefixes();
        require!(
            max_payout_amount.0 > 0 && max_payout_amount.0 <= MAX_AMOUNT,
            "Invalid native payout cap"
        );
        require!(
            max_authorization_ttl_ns.0 > 0 && max_authorization_ttl_ns.0 <= MAX_TTL_NS,
            "Invalid native authorization TTL"
        );
        let token_id: AccountId = TOKEN.parse().unwrap();
        require!(
            self.accepted_tokens.contains(&token_id),
            "Native token must be allowlisted"
        );
        let config = NativeConfig {
            version: VERSION,
            contract_id: env::current_account_id(),
            network: NETWORK.into(),
            token_id,
            decimals: 6,
            max_amount: max_payout_amount,
            max_authorization_ttl_ns,
            legacy_state_hash: expected_legacy_state_hash,
            initialized_at_ns: U64(env::block_timestamp()),
        };
        env::storage_write(CONFIG_KEY, &borsh::to_vec(&config).unwrap());
        self.emit_event(
            "native_storage_initialized",
            near_sdk::serde_json::json!({"version": VERSION, "config": config}),
        );
    }

    pub fn get_native_config(&self) -> Option<NativeConfig> {
        env::storage_read(CONFIG_KEY).map(|raw| {
            borsh::from_slice(&raw)
                .unwrap_or_else(|_| env::panic_str("Invalid native configuration"))
        })
    }

    /// Explicit, deny-by-default sidecar roles, separate from the legacy enum hierarchy.
    pub fn set_native_role(&mut self, account_id: AccountId, role: NativeRole, enabled: bool) {
        self.assert_owner();
        self.native_config();
        require!(self.paused, "Pause required for native role configuration");
        require!(
            account_id != self.owner_id && account_id != env::current_account_id(),
            "Root/self cannot hold native roles"
        );
        let other = match role {
            NativeRole::Approver => NativeRole::Executor,
            NativeRole::Executor => NativeRole::Approver,
        };
        require!(
            !enabled || !self.has_native_role(account_id.clone(), other),
            "Native roles must be separate"
        );
        let mut roles = Self::native_roles();
        let changed = if enabled {
            roles.insert((account_id.clone(), role))
        } else {
            roles.remove(&(account_id.clone(), role))
        };
        if changed {
            self.emit_event("native_role_changed", near_sdk::serde_json::json!({"account_id":account_id,"role":role,"enabled":enabled}));
        }
    }

    pub fn has_native_role(&self, account_id: AccountId, role: NativeRole) -> bool {
        Self::native_roles().contains(&(account_id, role))
    }

    /// Governance records independently reviewed recipient evidence; this is not NEP-413 verification.
    pub fn approve_native_recipient(&mut self, recipient_id: AccountId, evidence_hash: String) {
        self.assert_owner();
        self.native_config();
        require!(self.paused, "Pause required for native recipient approval");
        self.assert_native_recipient(&recipient_id);
        Self::require_digest(&evidence_hash);
        if let Some(prior) = Self::native_recipients().get(&recipient_id) {
            require!(
                prior.evidence_hash == evidence_hash,
                "Recipient evidence is immutable"
            );
            return;
        }
        let record = NativeRecipientApproval {
            version: VERSION,
            recipient_id: recipient_id.clone(),
            evidence_hash,
            approved_by: env::predecessor_account_id(),
            approved_at_ns: U64(env::block_timestamp()),
        };
        Self::native_recipients().insert(recipient_id, record.clone());
        self.emit_event(
            "native_recipient_approved",
            near_sdk::serde_json::json!({"approval":record}),
        );
    }

    pub fn get_native_recipient(&self, recipient_id: AccountId) -> Option<NativeRecipientApproval> {
        Self::native_recipients().get(&recipient_id).cloned()
    }

    pub fn create_native_payout(
        &mut self,
        campaign_id: u64,
        idempotency_key: String,
        recipient_id: AccountId,
        amount: U128,
    ) -> u64 {
        let config = self.native_config();
        self.assert_native_recipient(&recipient_id);
        let recipient = Self::native_recipients()
            .get(&recipient_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Native recipient not approved"));
        require!(
            recipient.version == VERSION && recipient.recipient_id == recipient_id,
            "Invalid recipient approval"
        );
        require!(
            amount.0 > 0 && amount.0 <= config.max_amount.0,
            "Native amount exceeds cap"
        );
        let campaign = self.campaign_or_panic(campaign_id);
        require!(
            campaign.token_id == config.token_id && self.accepted_tokens.contains(&config.token_id),
            "Native token mismatch or disabled"
        );
        let request = PayoutRequest {
            campaign_id,
            recipient_near_account_id: Some(recipient_id.clone()),
            destination: PayoutDestination {
                chain_id: ChainId::new(NETWORK.into()).unwrap(),
                recipient_address: RecipientAddress::new(recipient_id.to_string()).unwrap(),
            },
            input_amount: TokenAmount::new(
                TokenId::near(config.token_id.clone()),
                amount.0,
                config.decimals,
            ),
            expected_output_amount: TokenAmount::new(
                TokenId::near(config.token_id.clone()),
                amount.0,
                config.decimals,
            ),
        };
        // Replays never convert a legacy payout into native mode or replace its reservation actor.
        if let Some(id) = self
            .payout_idempotency
            .get(&(campaign_id, idempotency_key.clone()))
            .copied()
        {
            self.validated_native_payout(id);
        }
        let payout_id = self.reserve_payout(idempotency_key, request, true);
        if Self::native_modes().contains_key(&payout_id) {
            return payout_id;
        }
        let payout = self.payout_or_panic(payout_id);
        let binding = NativeBinding {
            version: VERSION,
            domain: DOMAIN.into(),
            contract_id: env::current_account_id(),
            network: NETWORK.into(),
            campaign_id,
            payout_id,
            token_id: config.token_id,
            recipient_id,
            amount,
            decimals: config.decimals,
            reservation_actor: env::predecessor_account_id(),
            reserved_at_ns: U64(payout.created_at_ns),
            recipient_evidence_hash: recipient.evidence_hash,
        };
        let record = NativePayout {
            binding_hash: Self::binding_hash(&binding),
            binding,
            status: NativeStatus::Reserved,
            next_attempt_id: 1,
            current_authorization_id: None,
            current_attempt_id: None,
            updated_at_ns: U64(env::block_timestamp()),
        };
        Self::native_modes().insert(payout_id, NativeMode::NativeNearV1);
        Self::native_payouts().insert(payout_id, record.clone());
        self.emit_native_event("native_payout_reserved", &record, None);
        payout_id
    }

    pub fn approve_native_execution(
        &mut self,
        payout_id: u64,
        authorization_id: String,
        attempt_id: u64,
        expires_at_ns: U64,
    ) {
        let config = self.native_config();
        self.assert_campaign_operations_enabled();
        let actor = env::predecessor_account_id();
        require!(
            self.has_native_role(actor.clone(), NativeRole::Approver),
            "Explicit native Approver required"
        );
        let mut record = self.validated_native_payout(payout_id);
        self.assert_native_active(&record);
        require!(
            actor != record.binding.reservation_actor,
            "Cannot approve own reservation"
        );
        Self::require_native_identifier(&authorization_id);
        let now = env::block_timestamp();
        let ttl = expires_at_ns
            .0
            .checked_sub(now)
            .unwrap_or_else(|| env::panic_str("Authorization expired"));
        require!(
            ttl > 0 && ttl <= config.max_authorization_ttl_ns.0,
            "Invalid authorization expiry"
        );
        if let Some(prior) = Self::native_authorizations()
            .get(&authorization_id)
            .cloned()
        {
            require!(
                prior.binding == record.binding
                    && prior.binding_hash == record.binding_hash
                    && prior.approver_id == actor
                    && prior.attempt_id == attempt_id
                    && prior.expires_at_ns == expires_at_ns
                    && prior.status == NativeAuthorizationStatus::Approved
                    && record.status == NativeStatus::Approved
                    && record.current_authorization_id.as_ref() == Some(&authorization_id)
                    && record.current_attempt_id == Some(attempt_id),
                "Authorization ID reuse or conflicting approval"
            );
            self.validated_native_attempt(&record, &authorization_id, attempt_id);
            return;
        }
        require!(
            record.status == NativeStatus::Reserved
                && record.current_authorization_id.is_none()
                && record.current_attempt_id.is_none(),
            "Native payout not available for approval"
        );
        require!(
            attempt_id == record.next_attempt_id,
            "Stale or conflicting attempt ID"
        );
        require!(
            !Self::native_attempts().contains_key(&(payout_id, attempt_id)),
            "Attempt already exists"
        );
        let next = attempt_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Native attempt ID overflow"));
        let auth = NativeAuthorization {
            version: VERSION,
            binding: record.binding.clone(),
            binding_hash: record.binding_hash.clone(),
            authorization_id: authorization_id.clone(),
            attempt_id,
            approver_id: actor,
            approved_at_ns: U64(now),
            expires_at_ns,
            status: NativeAuthorizationStatus::Approved,
        };
        let attempt = NativeAttempt {
            version: VERSION,
            campaign_id: record.binding.campaign_id,
            payout_id,
            binding_hash: record.binding_hash.clone(),
            authorization_id: authorization_id.clone(),
            attempt_id,
            status: NativeStatus::Approved,
            executor_id: None,
            created_at_ns: U64(now),
            updated_at_ns: U64(now),
            preflight_block_height: None,
        };
        record.status = NativeStatus::Approved;
        record.next_attempt_id = next;
        record.current_authorization_id = Some(authorization_id.clone());
        record.current_attempt_id = Some(attempt_id);
        record.updated_at_ns = U64(now);
        Self::native_authorizations().insert(authorization_id, auth);
        Self::native_attempts().insert((payout_id, attempt_id), attempt);
        Self::native_payouts().insert(payout_id, record.clone());
        self.emit_native_event("native_execution_authorized", &record, None);
    }

    /// Revocation never resets an execution attempt or frees campaign reservation.
    pub fn revoke_native_authorization(
        &mut self,
        payout_id: u64,
        authorization_id: String,
        attempt_id: u64,
    ) {
        self.native_config();
        let mut record = self.validated_native_payout(payout_id);
        let (mut auth, _) = self.validated_native_attempt(&record, &authorization_id, attempt_id);
        let actor = env::predecessor_account_id();
        require!(
            actor == auth.approver_id || actor == self.owner_id,
            "Only approver or owner can revoke"
        );
        require!(
            record.status == NativeStatus::Approved
                && auth.status == NativeAuthorizationStatus::Approved,
            "Only unused approval can be revoked"
        );
        auth.status = NativeAuthorizationStatus::Revoked;
        record.status = NativeStatus::Reserved;
        record.current_authorization_id = None;
        record.current_attempt_id = None;
        record.updated_at_ns = U64(env::block_timestamp());
        Self::native_authorizations().insert(authorization_id, auth);
        Self::native_payouts().insert(payout_id, record.clone());
        self.emit_native_event("native_authorization_revoked", &record, Some(attempt_id));
    }

    pub fn get_native_payout(&self, payout_id: u64) -> Option<NativePayout> {
        Self::native_payouts().get(&payout_id).cloned()
    }
    pub fn get_native_mode(&self, payout_id: u64) -> Option<NativeMode> {
        Self::native_modes().get(&payout_id).copied()
    }
    pub fn get_native_authorization(
        &self,
        authorization_id: String,
    ) -> Option<NativeAuthorization> {
        Self::native_authorizations()
            .get(&authorization_id)
            .cloned()
    }
    pub fn get_native_attempt(&self, payout_id: u64, attempt_id: u64) -> Option<NativeAttempt> {
        Self::native_attempts()
            .get(&(payout_id, attempt_id))
            .cloned()
    }
}

impl Disburse {
    pub(crate) fn native_modes() -> LookupMap<u64, NativeMode> {
        LookupMap::new(MODE_PREFIX.to_vec())
    }
    pub(crate) fn native_payouts() -> LookupMap<u64, NativePayout> {
        LookupMap::new(PAYOUT_PREFIX.to_vec())
    }
    fn native_authorizations() -> LookupMap<String, NativeAuthorization> {
        LookupMap::new(AUTH_PREFIX.to_vec())
    }
    fn native_attempts() -> LookupMap<(u64, u64), NativeAttempt> {
        LookupMap::new(ATTEMPT_PREFIX.to_vec())
    }
    fn native_roles() -> LookupSet<(AccountId, NativeRole)> {
        LookupSet::new(ROLE_PREFIX.to_vec())
    }
    fn native_recipients() -> LookupMap<AccountId, NativeRecipientApproval> {
        LookupMap::new(RECIPIENT_PREFIX.to_vec())
    }

    pub(crate) fn assert_legacy_payout(payout_id: u64) {
        require!(
            !Self::native_modes().contains_key(&payout_id)
                && !Self::native_payouts().contains_key(&payout_id),
            "Native payout cannot use legacy lifecycle"
        );
    }
    fn native_config(&self) -> NativeConfig {
        let config = self
            .get_native_config()
            .unwrap_or_else(|| env::panic_str("Native storage not initialized"));
        require!(
            config.version == VERSION
                && config.contract_id == env::current_account_id()
                && config.contract_id.as_str() == CONTRACT
                && config.network == NETWORK
                && config.token_id.as_str() == TOKEN
                && config.decimals == 6
                && config.max_amount.0 > 0
                && config.max_amount.0 <= MAX_AMOUNT
                && config.max_authorization_ttl_ns.0 > 0
                && config.max_authorization_ttl_ns.0 <= MAX_TTL_NS,
            "Invalid native configuration"
        );
        config
    }
    fn assert_legacy_storage_prefixes(&self) {
        // Compare SDK-serialized handles, not hand-written offsets into legacy STATE.
        // Historical fixture tests pin the same SDK encoding to authentic deployed bytes.
        let expected_campaigns: LookupMap<u64, Campaign> = LookupMap::new(b"campaigns".to_vec());
        let expected_roles: LookupSet<(AccountId, UserRole)> =
            LookupSet::new(b"role-assignments".to_vec());
        let expected_tokens: LookupSet<AccountId> = LookupSet::new(b"accepted-ft-tokens".to_vec());
        let expected_payouts: LookupMap<u64, Payout> = LookupMap::new(b"payout-records".to_vec());
        let expected_idempotency: LookupMap<(u64, String), u64> =
            LookupMap::new(b"payout-idempotency".to_vec());
        require!(
            borsh::to_vec(&self.campaigns).unwrap() == borsh::to_vec(&expected_campaigns).unwrap()
                && borsh::to_vec(&self.roles).unwrap() == borsh::to_vec(&expected_roles).unwrap()
                && borsh::to_vec(&self.accepted_tokens).unwrap()
                    == borsh::to_vec(&expected_tokens).unwrap()
                && borsh::to_vec(&self.payouts).unwrap()
                    == borsh::to_vec(&expected_payouts).unwrap()
                && borsh::to_vec(&self.payout_idempotency).unwrap()
                    == borsh::to_vec(&expected_idempotency).unwrap(),
            "Incompatible legacy storage prefixes"
        );
    }
    fn require_native_identifier(id: &str) {
        require!(
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_:/.".contains(&b)),
            "Invalid native identifier"
        );
    }
    fn require_digest(value: &str) {
        require!(
            value.len() == 64
                && value
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "Expected lowercase SHA256 digest"
        );
    }
    fn native_hash(bytes: &[u8]) -> String {
        env::sha256_array(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
    fn binding_hash(binding: &NativeBinding) -> String {
        Self::native_hash(&borsh::to_vec(binding).unwrap())
    }
    fn assert_native_recipient(&self, recipient: &AccountId) {
        require!(
            recipient != &env::current_account_id()
                && recipient != &self.owner_id
                && !self.has_direct_role(recipient, UserRole::Operator),
            "Recipient cannot be contract, owner or Operator"
        );
    }
    fn validated_native_payout(&self, payout_id: u64) -> NativePayout {
        let config = self.native_config();
        require!(
            Self::native_modes().get(&payout_id) == Some(&NativeMode::NativeNearV1),
            "Not a native payout"
        );
        let record = Self::native_payouts()
            .get(&payout_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Native sidecar missing"));
        let binding = &record.binding;
        let payout = self.payout_or_panic(payout_id);
        let campaign = self.campaign_or_panic(binding.campaign_id);
        Self::available_campaign_funds(&campaign);
        require!(
            binding.version == VERSION
                && binding.domain == DOMAIN
                && binding.contract_id == config.contract_id
                && binding.network == config.network
                && binding.payout_id == payout_id
                && payout.id == payout_id
                && payout.campaign_id == binding.campaign_id
                && campaign.id == binding.campaign_id
                && binding.token_id == config.token_id
                && campaign.token_id == binding.token_id
                && payout.recipient_near_account_id.as_ref() == Some(&binding.recipient_id)
                && payout.destination.chain_id.as_str() == binding.network
                && payout.destination.recipient_address.as_str() == binding.recipient_id.as_str()
                && payout.input_amount
                    == TokenAmount::new(
                        TokenId::near(binding.token_id.clone()),
                        binding.amount.0,
                        binding.decimals
                    )
                && payout.expected_output_amount == payout.input_amount
                && binding.decimals == config.decimals
                && binding.amount.0 > 0
                && binding.amount.0 <= config.max_amount.0
                && binding.reserved_at_ns.0 == payout.created_at_ns
                && record.binding_hash == Self::binding_hash(binding),
            "Native binding mismatch"
        );
        require!(
            payout.status == Self::native_projected_status(record.status),
            "Native reservation/status mismatch"
        );
        if !matches!(
            record.status,
            NativeStatus::Succeeded | NativeStatus::Released
        ) {
            require!(
                binding.amount.0 <= campaign.reserved,
                "Native reservation is missing"
            );
        }
        record
    }
    fn assert_native_active(&self, record: &NativePayout) {
        let campaign = self.campaign_or_panic(record.binding.campaign_id);
        require!(
            campaign.status == CampaignStatus::Active,
            "Native campaign must be Active"
        );
        require!(
            self.accepted_tokens.contains(&record.binding.token_id),
            "Native token disabled"
        );
        self.assert_native_recipient(&record.binding.recipient_id);
        let approval = Self::native_recipients()
            .get(&record.binding.recipient_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Native recipient approval missing"));
        require!(
            approval.version == VERSION
                && approval.recipient_id == record.binding.recipient_id
                && approval.evidence_hash == record.binding.recipient_evidence_hash,
            "Recipient evidence mismatch"
        );
    }
    fn validated_native_attempt(
        &self,
        record: &NativePayout,
        authorization_id: &str,
        attempt_id: u64,
    ) -> (NativeAuthorization, NativeAttempt) {
        require!(
            record.current_authorization_id.as_deref() == Some(authorization_id)
                && record.current_attempt_id == Some(attempt_id),
            "Native attempt identity mismatch"
        );
        let auth = Self::native_authorizations()
            .get(&authorization_id.to_string())
            .cloned()
            .unwrap_or_else(|| env::panic_str("Native authorization missing"));
        let attempt = Self::native_attempts()
            .get(&(record.binding.payout_id, attempt_id))
            .cloned()
            .unwrap_or_else(|| env::panic_str("Native attempt missing"));
        require!(
            auth.version == VERSION
                && auth.authorization_id == authorization_id
                && auth.attempt_id == attempt_id
                && auth.binding == record.binding
                && auth.binding_hash == record.binding_hash
                && attempt.version == VERSION
                && attempt.payout_id == record.binding.payout_id
                && attempt.campaign_id == record.binding.campaign_id
                && attempt.attempt_id == attempt_id
                && attempt.authorization_id == authorization_id
                && attempt.binding_hash == record.binding_hash
                && attempt.status == record.status,
            "Native authorization/attempt binding mismatch"
        );
        (auth, attempt)
    }
    fn emit_native_event(&self, event: &str, record: &NativePayout, previous_attempt: Option<u64>) {
        let authorization_id = record.current_authorization_id.clone().or_else(|| {
            previous_attempt.and_then(|id| {
                Self::native_attempts()
                    .get(&(record.binding.payout_id, id))
                    .map(|a| a.authorization_id.clone())
            })
        });
        let authorization = authorization_id
            .as_ref()
            .and_then(|id| Self::native_authorizations().get(id).cloned());
        self.emit_event(event, near_sdk::serde_json::json!({"version":VERSION,"binding":record.binding,
            "binding_hash":record.binding_hash,"status":record.status,"authorization_id":authorization_id,
            "attempt_id":record.current_attempt_id.or(previous_attempt),"actor_id":env::predecessor_account_id(),
            "approver_id":authorization.as_ref().map(|a| &a.approver_id),
            "expires_at_ns":authorization.as_ref().map(|a| a.expires_at_ns),
            "authorization_status":authorization.as_ref().map(|a| a.status),
            "updated_at_ns":record.updated_at_ns}));
    }
}

#[cfg(test)]
mod tests;

mod execution;
