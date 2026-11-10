/**
 * Link targets shared by the marketing homepage.
 *
 * The operator console is not part of this repository yet, so calls-to-action
 * lead to the closing section instead of a missing route. Set
 * NEXT_PUBLIC_LAUNCH_URL once the console exists and every CTA follows it.
 */
const launchUrl = process.env.NEXT_PUBLIC_LAUNCH_URL?.trim();

/** Target for the navigation and hero calls-to-action. */
export const CTA_HREF = launchUrl || "#get-started";

/** Target for the closing "Launch Disburse" button. */
export const APP_HREF = launchUrl || "#get-started";
