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
use types::{role::UserRole, status::CampaignStatus};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CampaignFundingInfo {
    pub campaign_id: u64,
    pub token_id: AccountId,
    pub budget: U128,
    pub funded: U128,
    pub remaining_budget: U128,
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

    fn campaign_or_panic(&self, campaign_id: u64) -> Campaign {
        self.campaigns
            .get(&campaign_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Campaign not found"))
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
}
