pub mod state;
pub mod types;

use near_sdk::{
    AccountId, PanicOnDefault, env, near, require,
    store::{LookupMap, LookupSet},
};
use state::campaign::Campaign;
use types::{role::UserRole, status::CampaignStatus};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Disburse {
    owner_id: AccountId,
    paused: bool,
    next_campaign_id: u64,
    campaigns: LookupMap<u64, Campaign>,
    roles: LookupSet<(AccountId, UserRole)>,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;
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
}
