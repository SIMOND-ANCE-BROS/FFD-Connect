# ADR-0004: Expo with React Native for Mobile

**Date**: 2026-01-14
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The project requires a mobile app for iOS and Android targeting dance federation members. Key native features include QR code scanning for license verification, audio playback for competition music, push notifications for event updates, and biometric authentication. The team has existing React/TypeScript expertise that should be leveraged.

## Decision

Use React Native 0.81 with Expo 54 in managed workflow, using EAS Build for cloud-based native builds. Native modules are integrated via Expo config plugins in `app.config.js`.

## Alternatives Considered

### Alternative 1: Bare React Native

- **Pros**: Full control over native code, no Expo abstractions, access to any native module
- **Cons**: Manual Xcode/Android Studio configuration, more complex CI/CD, higher maintenance burden
- **Why not**: The maintenance overhead of managing native build configurations is not justified; all required features are available through Expo-compatible modules

### Alternative 2: Flutter

- **Pros**: High-performance rendering, mature widget library, single codebase
- **Cons**: Requires learning Dart, separate ecosystem from web stack, cannot share TypeScript types
- **Why not**: Introducing Dart fragments the team's language expertise; no code sharing with the NestJS backend or landing page

### Alternative 3: Native iOS + Android

- **Pros**: Best possible performance, full platform API access, platform-native UX
- **Cons**: Two separate codebases, doubled development effort, two skill sets required
- **Why not**: Solo/small team cannot maintain two native codebases; cross-platform is essential for velocity

## Consequences

### Positive

- OTA updates via EAS Update ship bug fixes without app store review cycles
- EAS Build handles native compilation in the cloud, no local Xcode/Android Studio needed
- Config plugins provide native module access while staying in managed workflow
- TypeScript shared between mobile client and backend via monorepo packages

### Negative

- Larger bundle size compared to bare React Native or native apps
- Limited to Expo-compatible native modules; ejecting is required for unsupported modules
- Debugging native issues can be harder behind Expo's abstraction layer

## Amendment — 2026-07 : mise à jour des versions

Les versions réelles actuelles de la stack mobile sont :

- **Expo** ~57.0
- **React Native** 0.86.0
- **React** 19.2

(L'ADR d'origine citait Expo 54 / RN 0.81.)

La décision de fond — workflow managed Expo + EAS Build — reste inchangée. Dans le cadre de la montée en SDK 57, la lecture audio a été migrée de `react-native-track-player` vers `expo-audio`.
