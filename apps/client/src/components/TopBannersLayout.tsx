import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useIsOnline } from "../hooks/useIsOnline";
import { useAuthStore } from "../stores/auth.store";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { OfflineBanner } from "./OfflineBanner";

interface TopBannersLayoutProps {
  children: React.ReactNode;
}

/**
 * Root layout that keeps the global top banners (impersonation #545, offline
 * #416) from masking anything.
 *
 * Both banners used to be absolutely positioned over the whole app, so they
 * hid every screen's header (PinnedHeader / GlassHeader titles, back buttons,
 * header actions). They now sit in the layout flow, stacked above the app,
 * and push it down. The first visible banner absorbs the status-bar inset
 * (the ones below it get 0), and the app below is given a top safe-area inset
 * of 0: every header that pads itself with `useSafeAreaInsets().top` lands
 * right under the banners, and native `SafeAreaView`s compute 0 on their own
 * (they are no longer under the status bar). Bottom/side insets are untouched.
 *
 * The element tree is identical whatever banners are shown, so toggling one
 * never remounts the navigator (navigation state kept).
 * Caveat: a `<Modal>` rendered by a screen inherits the overridden inset; no
 * modal currently relies on the top inset.
 */
export const TopBannersLayout = ({ children }: TopBannersLayoutProps) => {
  const impersonating = useAuthStore((s) => s.impersonating);
  const isOnline = useIsOnline();
  const insets = useSafeAreaInsets();
  const anyBanner = impersonating || !isOnline;
  const appInsets = useMemo(
    () => (anyBanner ? { ...insets, top: 0 } : insets),
    [anyBanner, insets],
  );

  return (
    <View style={styles.layout}>
      <ImpersonationBanner topInset={insets.top} />
      <OfflineBanner topInset={impersonating ? 0 : insets.top} />
      <View style={styles.layout}>
        <SafeAreaInsetsContext.Provider value={appInsets}>
          {children}
        </SafeAreaInsetsContext.Provider>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  layout: { flex: 1 },
});
