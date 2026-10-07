/** Disciplines a licensee can be registered in (User.category). */
export const USER_CATEGORIES = ["Latin", "Standard", "Ten Dance"] as const;
export type UserCategory = (typeof USER_CATEGORIES)[number];
