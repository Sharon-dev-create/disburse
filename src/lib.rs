use near_sdk::{AccountId, PanicOnDefault, env, near, require, store::LookupMap};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CampaignStatus {
    Draft,
    Active,
    Paused,
    Completed,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Campaign {
    pub id: u64,
    pub creator_id: AccountId,
    pub title: String,
    pub token_id: AccountId,
    pub budget: u128,
    pub funded: u128,
    pub reserved: u128,
    pub spent: u128,
    pub status: CampaignStatus,
    pub created_at_ns: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Disburse {
    owner_id: AccountId,
    paused: bool,
    next_campaign_id: u64,
    campaigns: LookupMap<u64, Campaign>,
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
            status: CampaignStatus::Draft,
            created_at_ns: env::block_timestamp(),
        };

        self.campaigns.insert(campaign_id, campaign);

        env::log_str(&format!("CampaignCreated:{}", campaign_id));

        campaign_id
    }

    pub fn get_campaign(&self, campaign_id: u64) -> Option<Campaign> {
        self.campaigns.get(&campaign_id).cloned()
    }

    pub fn get_campaign_count(&self) -> u64 {
        self.next_campaign_id
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

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
        assert_eq!(campaign.status, CampaignStatus::Draft);
        assert_eq!(contract.get_campaign_count(), 1);
    }

    #[test]
    fn campaign_ids_are_unique_and_incrementing() {
        let mut contract = new_contract();

        let first = contract.create_campaign("First campaign".to_string(), accounts(2), 100);

        let second = contract.create_campaign("Second campaign".to_string(), accounts(2), 200);

        assert_eq!(first, 0);
        assert_eq!(second, 1);
        assert_eq!(contract.get_campaign_count(), 2);
    }

    #[test]
    #[should_panic(expected = "Campaign title cannot be empty")]
    fn rejects_empty_campaign_title() {
        let mut contract = new_contract();

        contract.create_campaign("   ".to_string(), accounts(2), 100);
    }

    #[test]
    #[should_panic(expected = "Campaign budget must be greater than zero")]
    fn rejects_zero_campaign_budget() {
        let mut contract = new_contract();

        contract.create_campaign("Community Grants".to_string(), accounts(2), 0);
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
}
