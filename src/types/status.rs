use near_sdk::near;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignStatus {
    Draft,
    Active,
    Paused,
    Completed,
    Cancelled,
    // Appended to preserve the Borsh discriminants of the pre-existing variants.
    Approved,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatus {
    Created,
    Authorized,
    Reserved,
    Executing,
    PendingVerification,
    Succeeded,
    Failed,
    RefundPending,
    Refunded,
    ManualReview,
    // Appended to preserve the Borsh discriminants of existing payout states.
    ReservationReleased,
}
