/**
 * Types pour l'analytics produit.
 * Permet d'ajouter Firebase Analytics (ou autre) plus tard sans changer les appels.
 */

export type AnalyticsEventName =
  | "login"
  | "login_biometric"
  | "login_guest"
  | "screen_view"
  | "competition_view"
  | "license_scan"
  | "register"
  | "registration_start"
  | "license_wallet_add";

export type AnalyticsEventParams = {
  screen_name?: string;
  screen_class?: string;
  method?: "email" | "biometric" | "guest";
  competition_id?: string;
  event_id?: string;
  [key: string]: string | number | boolean | undefined;
};

export interface IAnalytics {
  logEvent(name: AnalyticsEventName, params?: AnalyticsEventParams): void;
  logScreenView(screenName: string, params?: AnalyticsEventParams): void;
}
