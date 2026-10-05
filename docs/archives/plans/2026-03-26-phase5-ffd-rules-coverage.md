# Phase 5 — FFD Rules Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix 3 confirmed business-rule bugs and bring test coverage to 100% on the critical FFD regulation utilities (age-group, participation-rules, level-accession) and the registration service eligibility paths.

**Architecture:** All changes are in pure utility functions and one NestJS service. Bug fixes are small (1-5 lines each). Test additions are the bulk of the work: 1 new spec file for level-accession, boundary tests added to age-group spec, eligibility tests added to registration service spec. Each task follows TDD: write failing test, confirm red, implement fix, confirm green.

**Tech Stack:** TypeScript 5.6, NestJS 11, Jest 29, Prisma 7

---

## Task 1 — Bug fix: Senior V upward choice ignores category restriction

**Files:**

- Modify: `apps/backend/src/common/participation-rules/participation-rules.util.ts`
- Modify: `apps/backend/src/common/participation-rules/participation-rules.util.spec.ts`

**Bug:** `COUPLE_UPWARD_CHOICES` on line 112 maps `"Senior V": ["Senior IV"]` unconditionally. The loop in `getAllowedCoupleAgeClassesForEvent` iterates this map and adds Senior IV for Senior V regardless of event category. Lines 133-137 already correctly gate the special participation rule on Latin/Latines/Ten Dance, but the upward-choices loop re-adds Senior IV unconditionally, bypassing the category check.

- [x] **Step 1: Update the existing bug-documenting test and add the regression test**

In `apps/backend/src/common/participation-rules/participation-rules.util.spec.ts`, find the test that asserts Senior V includes Senior IV via upward choices and **replace it** with:

```typescript
it('Senior V in Standard should NOT include Senior IV (category restriction)', () => {
  const result = getAllowedCoupleAgeClassesForEvent('Senior V', '', 'standard');
  expect(result).not.toContain('Senior IV');
});
```

- [x] **Step 2: Confirm the test fails (red)**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="participation-rules.util.spec" --no-coverage 2>&1 | tail -20
```

Expected: The updated test fails — `getAllowedCoupleAgeClassesForEvent("Senior V", "", "standard")` still returns `"Senior IV"`.

- [x] **Step 3: Fix the production code**

In `apps/backend/src/common/participation-rules/participation-rules.util.ts`, remove `"Senior V": ["Senior IV"]` from `COUPLE_UPWARD_CHOICES`. Change:

```typescript
const COUPLE_UPWARD_CHOICES: Record<string, string[]> = {
  'Junior II': ['Youth'],
  Youth: ['Adulte'],
  Adulte: [],
  'Senior I': ['Adulte'],
  'Senior II': ['Senior I'],
  'Senior III': ['Senior II'],
  'Senior IV': ['Senior III'],
  'Senior V': ['Senior IV'],
};
```

to:

```typescript
const COUPLE_UPWARD_CHOICES: Record<string, string[]> = {
  'Junior II': ['Youth'],
  Youth: ['Adulte'],
  Adulte: [],
  'Senior I': ['Adulte'],
  'Senior II': ['Senior I'],
  'Senior III': ['Senior II'],
  'Senior IV': ['Senior III'],
  // Senior V → Senior IV is handled with category check in isCoupleAgeGroupAllowedInEvent
};
```

- [x] **Step 4: Confirm all tests pass (green)**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="participation-rules.util.spec" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. Latin/Ten Dance tests still pass because the category-aware block in `isCoupleAgeGroupAllowedInEvent` handles Senior V → Senior IV for those categories.

- [x] **Step 5: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect
git add apps/backend/src/common/participation-rules/participation-rules.util.ts apps/backend/src/common/participation-rules/participation-rules.util.spec.ts
git commit -m "fix(participation-rules): Senior V upward choice to Senior IV restricted to Latin/Latines/Ten Dance

COUPLE_UPWARD_CHOICES had 'Senior V' → ['Senior IV'] unconditionally,
bypassing the category check in getAllowedCoupleAgeClassesForEvent.
Removed the entry; the category-aware block in isCoupleAgeGroupAllowedInEvent
already handles the allowed case correctly.

Fixes Article 9 §1.3 compliance."
```

---

## Task 2 — Bug fix: Eligibility check skipped when eventKind/competitionType missing

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`

**Bug:** The eligibility check runs only if `finalAgeGroup && (eventKind || competitionType)`. When an event has `eventKind = null` AND `competitionType = null`, eligibility is entirely skipped even though a `finalAgeGroup` exists.

**Fix:** Change the condition to only require `finalAgeGroup`. The `checkParticipationEligibility` function handles null `eventKind`/`competitionType` gracefully.

- [x] **Step 1: Write the failing test**

In `apps/backend/src/competitions/services/competition-registration.service.spec.ts`, add the following import at the top if not already present:

```typescript
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
```

Then add inside the `describe("register", ...)` block, after the existing tests:

```typescript
it('should throw BadRequestException when age group mismatch even without eventKind/competitionType', async () => {
  const mockEvent = {
    id: 'e1',
    competitionId: 'c1',
    eventType: 'SOLO',
    competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: null },
    category: 'Latin',
    ageGroup: 'Solo Adulte',
    eventKind: null,
    level: null,
  };
  mockPrismaService.event.findUnique.mockResolvedValue(mockEvent);
  mockPrismaService.registration.findFirst.mockResolvedValue(null);
  // Born 2014 → age 11 at ref year 2025 → Solo Juvénile, not Solo Adulte
  mockPrismaService.user.findUnique.mockResolvedValue({
    birthDate: new Date(2014, 5, 1),
  });

  await expect(service.register('e1', 'u1', undefined, { byOrganizer: true })).rejects.toThrow(
    BadRequestException,
  );
});
```

- [x] **Step 2: Confirm the test fails (red)**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="competition-registration.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: Test fails — the registration succeeds instead of throwing.

- [x] **Step 3: Fix the production code**

In `apps/backend/src/competitions/services/competition-registration.service.ts`, find the line containing:

```typescript
if (finalAgeGroup && (eventKind || competitionType)) {
```

and change it to:

```typescript
if (finalAgeGroup) {
```

- [x] **Step 4: Confirm all tests pass (green)**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="competition-registration.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect
git add apps/backend/src/competitions/services/competition-registration.service.ts apps/backend/src/competitions/services/competition-registration.service.spec.ts
git commit -m "fix(registration): run eligibility check when finalAgeGroup present, regardless of eventKind/competitionType

The condition guarding checkParticipationEligibility required eventKind
or competitionType to be set. Events missing both fields silently skipped
age group validation, allowing mismatched registrations through.

checkParticipationEligibility already handles null eventKind/competitionType
gracefully, so the extra guard was unnecessary."
```

---

## Task 3 — Bug fix: Couple age group silently falls back to event.ageGroup

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts`
- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`

**Bug:** When couple age computation fails (e.g. partner has no birthDate) and no `options.coupleAgeGroup` is provided, `finalAgeGroup` falls back to `event.ageGroup`. This means incomplete data silently passes eligibility because the registrant's age group is auto-set to match the event's required age group.

**Fix:** Replace `event.ageGroup` with `null` in the fallback.

- [x] **Step 1: Write the failing test**

Add inside `describe("register", ...)` in `competition-registration.service.spec.ts`:

```typescript
it('should NOT use event.ageGroup as fallback when couple age computation fails', async () => {
  const mockEvent = {
    id: 'e1',
    competitionId: 'c1',
    eventType: 'COUPLE',
    competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: 'NATIONALE' },
    category: 'Latin',
    ageGroup: 'Adulte',
    eventKind: 'CLASSIFICATRICE',
    level: 'Avancé',
  };
  mockPrismaService.event.findUnique.mockResolvedValue(mockEvent);
  mockPrismaService.registration.findFirst.mockResolvedValue(null);
  mockPrismaService.registration.create.mockResolvedValue({ id: 'r1' });
  // registrant has birthDate, partner has no birthDate → computeCoupleAgeGroup returns null
  mockPrismaService.user.findUnique
    .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
    .mockResolvedValueOnce({ birthDate: null, firstName: 'Jean', lastName: 'Dupont' });

  const result = await service.register('e1', 'u1', 'Jean Dupont', {
    byOrganizer: true,
    partnerUserId: 'partner1',
  });

  expect(result.id).toBe('r1');
  // Critical: coupleAgeGroup should be null, NOT "Adulte" (the event's ageGroup)
  expect(mockPrismaService.registration.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        coupleAgeGroup: null,
      }),
    }),
  );
});
```

- [x] **Step 2: Confirm the test fails (red)**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="competition-registration.service.spec" --no-coverage 2>&1 | tail -25
```

Expected: Test fails — `coupleAgeGroup` is `"Adulte"` instead of `null`.

- [x] **Step 3: Fix the production code**

In `apps/backend/src/competitions/services/competition-registration.service.ts`, find:

```typescript
const finalAgeGroup =
  computedAgeGroup ??
  (isCouple
    ? options.coupleAgeGroup?.trim()
      ? options.coupleAgeGroup.trim()
      : event.ageGroup
    : null);
```

Replace with:

```typescript
const finalAgeGroup =
  computedAgeGroup ??
  (isCouple && options.coupleAgeGroup?.trim() ? options.coupleAgeGroup.trim() : null);
```

- [x] **Step 4: Confirm all tests pass (green)**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="competition-registration.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect
git add apps/backend/src/competitions/services/competition-registration.service.ts apps/backend/src/competitions/services/competition-registration.service.spec.ts
git commit -m "fix(registration): remove event.ageGroup fallback for couple age group

When couple age computation failed (missing partner birthDate) and no
explicit coupleAgeGroup option was provided, finalAgeGroup fell back to
event.ageGroup — guaranteeing eligibility checks would pass silently.

Now finalAgeGroup is null in that case, correctly flagging incomplete data."
```

---

## Task 4 — New spec file: level-accession.util.spec.ts

**Files:**

- Create: `apps/backend/src/common/level-accession/level-accession.util.spec.ts`

`level-accession.util.ts` has zero test coverage. It implements passport requirements for Articles 2 and 3 (couple level access thresholds). This task creates the full spec file.

- [x] **Step 1: Verify the exports in `level-accession.util.ts`**

```bash
grep "^export" apps/backend/src/common/level-accession/level-accession.util.ts
```

Expected: exports for `passportOrder`, `hasAtLeastPassport`, `coupleMeetsPassportForLevel`, `getMaxLevelForCoupleAgeGroup`, `getAllowedLevelsForCouple`, `canAccessIntermediaire`, `meetsPassportForAvance`, `meetsPassportForInternational`, plus constants.

Also verify constant names:

```bash
grep "^export const" apps/backend/src/common/level-accession/level-accession.util.ts
```

- [x] **Step 2: Create the spec file**

Create `apps/backend/src/common/level-accession/level-accession.util.spec.ts`:

```typescript
import {
  passportOrder,
  hasAtLeastPassport,
  coupleMeetsPassportForLevel,
  getMaxLevelForCoupleAgeGroup,
  getAllowedLevelsForCouple,
  canAccessIntermediaire,
  meetsPassportForAvance,
  meetsPassportForInternational,
} from './level-accession.util';

// ---------------------------------------------------------------------------
// passportOrder
// ---------------------------------------------------------------------------
describe('passportOrder', () => {
  it('returns correct index for each passport color in order', () => {
    expect(passportOrder('BLANC')).toBe(0);
    expect(passportOrder('BEIGE')).toBe(1);
    expect(passportOrder('JAUNE')).toBe(2);
    expect(passportOrder('ORANGE')).toBe(3);
    expect(passportOrder('VERT')).toBe(4);
    expect(passportOrder('VIOLET')).toBe(5);
    expect(passportOrder('BLEU')).toBe(6);
    expect(passportOrder('ROUGE')).toBe(7);
    expect(passportOrder('NOIR')).toBe(8);
  });

  it('returns -1 for null, undefined, empty, or unknown', () => {
    expect(passportOrder(null)).toBe(-1);
    expect(passportOrder(undefined)).toBe(-1);
    expect(passportOrder('')).toBe(-1);
    expect(passportOrder('INCONNU')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// hasAtLeastPassport
// ---------------------------------------------------------------------------
describe('hasAtLeastPassport', () => {
  it('uses the best of Latin and Standard passports', () => {
    // Latin=ORANGE, Standard=BLANC → best=ORANGE → meets ORANGE minimum
    expect(hasAtLeastPassport('ORANGE', 'BLANC', 'ORANGE')).toBe(true);
    // Latin=BLANC, Standard=ORANGE → best=ORANGE → meets ORANGE minimum
    expect(hasAtLeastPassport('BLANC', 'ORANGE', 'ORANGE')).toBe(true);
  });

  it('returns false when both are below minimum', () => {
    expect(hasAtLeastPassport('BLANC', 'BEIGE', 'ORANGE')).toBe(false);
  });

  it('returns true when passport is above minimum', () => {
    expect(hasAtLeastPassport('ROUGE', null, 'ORANGE')).toBe(true);
  });

  it('returns false when both are null', () => {
    expect(hasAtLeastPassport(null, null, 'ORANGE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// coupleMeetsPassportForLevel
// ---------------------------------------------------------------------------
describe('coupleMeetsPassportForLevel', () => {
  const pOrange = { passportLevelLatin: 'ORANGE', passportLevelStandard: null };
  const pViolet = { passportLevelLatin: 'VIOLET', passportLevelStandard: null };
  const pRouge = { passportLevelLatin: 'ROUGE', passportLevelStandard: null };
  const pBlanc = { passportLevelLatin: 'BLANC', passportLevelStandard: null };

  it('Débutant always returns true — no passport requirement', () => {
    expect(coupleMeetsPassportForLevel(pBlanc, pBlanc, 'Débutant')).toBe(true);
    expect(
      coupleMeetsPassportForLevel(
        { passportLevelLatin: null, passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: null },
        'Débutant',
      ),
    ).toBe(true);
  });

  it('Intermédiaire requires ORANGE for both partners', () => {
    expect(coupleMeetsPassportForLevel(pOrange, pOrange, 'Intermédiaire')).toBe(true);
    expect(coupleMeetsPassportForLevel(pOrange, pBlanc, 'Intermédiaire')).toBe(false);
    expect(coupleMeetsPassportForLevel(pBlanc, pOrange, 'Intermédiaire')).toBe(false);
  });

  it('Avancé requires VIOLET for both partners', () => {
    expect(coupleMeetsPassportForLevel(pViolet, pViolet, 'Avancé')).toBe(true);
    expect(coupleMeetsPassportForLevel(pOrange, pViolet, 'Avancé')).toBe(false);
  });

  it('International requires ROUGE for both partners', () => {
    expect(coupleMeetsPassportForLevel(pRouge, pRouge, 'International')).toBe(true);
    expect(coupleMeetsPassportForLevel(pViolet, pRouge, 'International')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMaxLevelForCoupleAgeGroup
// ---------------------------------------------------------------------------
describe('getMaxLevelForCoupleAgeGroup', () => {
  it('Juvénile I, Juvénile II, and Junior I cap at Intermédiaire', () => {
    expect(getMaxLevelForCoupleAgeGroup('Juvénile I')).toBe('Intermédiaire');
    expect(getMaxLevelForCoupleAgeGroup('Juvénile II')).toBe('Intermédiaire');
    expect(getMaxLevelForCoupleAgeGroup('Junior I')).toBe('Intermédiaire');
  });

  it('Junior II and Youth cap at Avancé', () => {
    expect(getMaxLevelForCoupleAgeGroup('Junior II')).toBe('Avancé');
    expect(getMaxLevelForCoupleAgeGroup('Youth')).toBe('Avancé');
  });

  it('Adulte and all Seniors cap at International', () => {
    for (const ag of ['Adulte', 'Senior I', 'Senior II', 'Senior III', 'Senior IV', 'Senior V']) {
      expect(getMaxLevelForCoupleAgeGroup(ag)).toBe('International');
    }
  });

  it('returns null for null, undefined, empty, or unknown', () => {
    expect(getMaxLevelForCoupleAgeGroup(null)).toBeNull();
    expect(getMaxLevelForCoupleAgeGroup(undefined)).toBeNull();
    expect(getMaxLevelForCoupleAgeGroup('')).toBeNull();
    expect(getMaxLevelForCoupleAgeGroup('Inconnu')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAllowedLevelsForCouple
// ---------------------------------------------------------------------------
describe('getAllowedLevelsForCouple', () => {
  const bothRouge = { passportLevelLatin: 'ROUGE', passportLevelStandard: 'ROUGE' };
  const bothOrange = { passportLevelLatin: 'ORANGE', passportLevelStandard: null };
  const bothBlanc = { passportLevelLatin: 'BLANC', passportLevelStandard: null };
  const bothViolet = { passportLevelLatin: 'VIOLET', passportLevelStandard: null };

  it('returns empty array for null or unknown age group', () => {
    expect(getAllowedLevelsForCouple(null, bothRouge, bothRouge)).toEqual([]);
    expect(getAllowedLevelsForCouple('Inconnu', bothRouge, bothRouge)).toEqual([]);
  });

  it('Juvénile I with ORANGE passports → [Intermédiaire, Débutant] (cap=Intermédiaire)', () => {
    const result = getAllowedLevelsForCouple('Juvénile I', bothOrange, bothOrange);
    expect(result).toEqual(['Intermédiaire', 'Débutant']);
  });

  it("Juvénile I with BLANC passports → [Débutant] only (can't access Intermédiaire)", () => {
    const result = getAllowedLevelsForCouple('Juvénile I', bothBlanc, bothBlanc);
    expect(result).toEqual(['Débutant']);
  });

  it('Adulte with ROUGE passports → [International, Avancé, Intermédiaire]', () => {
    const result = getAllowedLevelsForCouple('Adulte', bothRouge, bothRouge);
    expect(result).toEqual(['International', 'Avancé', 'Intermédiaire']);
  });

  it('Adulte with ORANGE passports → [Intermédiaire] only', () => {
    const result = getAllowedLevelsForCouple('Adulte', bothOrange, bothOrange);
    expect(result).toEqual(['Intermédiaire']);
  });

  it('Junior II with VIOLET passports → [Avancé, Intermédiaire, Débutant] (cap=Avancé)', () => {
    const result = getAllowedLevelsForCouple('Junior II', bothViolet, bothViolet);
    expect(result).toEqual(['Avancé', 'Intermédiaire', 'Débutant']);
  });

  it('one partner below passport requirement filters out that level', () => {
    const p1 = { passportLevelLatin: 'VIOLET', passportLevelStandard: null };
    const p2 = { passportLevelLatin: 'ORANGE', passportLevelStandard: null };
    // p2 has ORANGE → meets Intermédiaire but not Avancé or International
    const result = getAllowedLevelsForCouple('Adulte', p1, p2);
    expect(result).toEqual(['Intermédiaire']);
  });
});

// ---------------------------------------------------------------------------
// Shorthand wrappers
// ---------------------------------------------------------------------------
describe('canAccessIntermediaire', () => {
  it('returns true when both partners have at least ORANGE', () => {
    expect(
      canAccessIntermediaire(
        { passportLevelLatin: 'ORANGE', passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: 'VERT' },
      ),
    ).toBe(true);
  });

  it('returns false when one partner is below ORANGE', () => {
    expect(
      canAccessIntermediaire(
        { passportLevelLatin: 'ORANGE', passportLevelStandard: null },
        { passportLevelLatin: 'JAUNE', passportLevelStandard: 'BEIGE' },
      ),
    ).toBe(false);
  });
});

describe('meetsPassportForAvance', () => {
  it('returns true when both partners have at least VIOLET', () => {
    expect(
      meetsPassportForAvance(
        { passportLevelLatin: 'VIOLET', passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: 'BLEU' },
      ),
    ).toBe(true);
  });

  it('returns false when one partner is below VIOLET', () => {
    expect(
      meetsPassportForAvance(
        { passportLevelLatin: 'VIOLET', passportLevelStandard: null },
        { passportLevelLatin: 'ORANGE', passportLevelStandard: null },
      ),
    ).toBe(false);
  });
});

describe('meetsPassportForInternational', () => {
  it('returns true when both partners have at least ROUGE', () => {
    expect(
      meetsPassportForInternational(
        { passportLevelLatin: 'ROUGE', passportLevelStandard: null },
        { passportLevelLatin: null, passportLevelStandard: 'NOIR' },
      ),
    ).toBe(true);
  });

  it('returns false when one partner is below ROUGE', () => {
    expect(
      meetsPassportForInternational(
        { passportLevelLatin: 'ROUGE', passportLevelStandard: null },
        { passportLevelLatin: 'VIOLET', passportLevelStandard: null },
      ),
    ).toBe(false);
  });
});
```

- [x] **Step 3: Run the tests**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="level-accession.util.spec" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass (no production code changes — this is pure coverage addition).

- [x] **Step 4: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect
git add apps/backend/src/common/level-accession/level-accession.util.spec.ts
git commit -m "test(level-accession): add comprehensive spec for passport/level utilities

Covers passportOrder, hasAtLeastPassport, coupleMeetsPassportForLevel,
getMaxLevelForCoupleAgeGroup, getAllowedLevelsForCouple,
canAccessIntermediaire, meetsPassportForAvance, meetsPassportForInternational.
Includes null/empty/unknown edge cases and cross-partner passport filtering.

Articles 2.1 (Intermédiaire/ORANGE), 2.2 (Avancé/VIOLET),
2.3 (International/ROUGE), 3 (max level by age group)."
```

---

## Task 5 — Age boundary tests

**Files:**

- Modify: `apps/backend/src/common/age-group/age-group.util.spec.ts`

Every age threshold is a hard regulatory boundary. The existing tests cover typical cases but not exact boundaries. This task adds precise boundary tests for every threshold in `computeSoloAgeGroup` and `computeCoupleAgeGroup`.

- [x] **Step 1: Append boundary tests to the existing spec file**

Add the following at the bottom of `apps/backend/src/common/age-group/age-group.util.spec.ts`, inside the outer `describe` block (before the final `});`):

```typescript
describe('computeSoloAgeGroup — exact threshold boundaries', () => {
  const refYear = 2025;
  // birthForAge(n) produces a date that results in exactly n years old at 31 Dec 2025
  const birthForAge = (age: number) => new Date(refYear - age, 0, 1);

  it('age 11 → Solo Juvénile (upper boundary of Juvénile)', () => {
    expect(computeSoloAgeGroup(birthForAge(11), refYear)).toBe('Solo Juvénile');
  });

  it('age 12 → Solo Junior 1 (lower boundary of Junior 1)', () => {
    expect(computeSoloAgeGroup(birthForAge(12), refYear)).toBe('Solo Junior 1');
  });

  it('age 13 → Solo Junior 1 (upper boundary of Junior 1)', () => {
    expect(computeSoloAgeGroup(birthForAge(13), refYear)).toBe('Solo Junior 1');
  });

  it('age 14 → Solo Junior 2 (lower boundary of Junior 2)', () => {
    expect(computeSoloAgeGroup(birthForAge(14), refYear)).toBe('Solo Junior 2');
  });

  it('age 15 → Solo Junior 2 (upper boundary of Junior 2)', () => {
    expect(computeSoloAgeGroup(birthForAge(15), refYear)).toBe('Solo Junior 2');
  });

  it('age 16 → Solo Youth (lower boundary of Youth)', () => {
    expect(computeSoloAgeGroup(birthForAge(16), refYear)).toBe('Solo Youth');
  });

  it('age 18 → Solo Youth (upper boundary of Youth)', () => {
    expect(computeSoloAgeGroup(birthForAge(18), refYear)).toBe('Solo Youth');
  });

  it('age 19 → Solo Adulte (lower boundary of Adulte)', () => {
    expect(computeSoloAgeGroup(birthForAge(19), refYear)).toBe('Solo Adulte');
  });

  it('age 29 → Solo Adulte (upper boundary of Adulte)', () => {
    expect(computeSoloAgeGroup(birthForAge(29), refYear)).toBe('Solo Adulte');
  });

  it('age 30 → Solo Senior (lower boundary of Senior)', () => {
    expect(computeSoloAgeGroup(birthForAge(30), refYear)).toBe('Solo Senior');
  });
});

describe('computeCoupleAgeGroup — exact threshold boundaries', () => {
  const refYear = 2025;
  const birthForAge = (age: number) => new Date(refYear - age, 0, 1);

  it('older=9, younger=8 → Juvénile I (upper boundary of Juvénile I)', () => {
    expect(computeCoupleAgeGroup(birthForAge(9), birthForAge(8), refYear)).toBe('Juvénile I');
  });

  it('older=10, younger=8 → Juvénile II (lower boundary)', () => {
    expect(computeCoupleAgeGroup(birthForAge(10), birthForAge(8), refYear)).toBe('Juvénile II');
  });

  it('older=11, younger=9 → Juvénile II (upper boundary)', () => {
    expect(computeCoupleAgeGroup(birthForAge(11), birthForAge(9), refYear)).toBe('Juvénile II');
  });

  it('older=12, younger=10 → Junior I (lower boundary)', () => {
    expect(computeCoupleAgeGroup(birthForAge(12), birthForAge(10), refYear)).toBe('Junior I');
  });

  it('older=14, younger=12 → Junior II (lower boundary)', () => {
    expect(computeCoupleAgeGroup(birthForAge(14), birthForAge(12), refYear)).toBe('Junior II');
  });

  it('older=16, younger=14 → Youth (lower boundary)', () => {
    expect(computeCoupleAgeGroup(birthForAge(16), birthForAge(14), refYear)).toBe('Youth');
  });

  it('older=19, younger=18 → Adulte (lower boundary)', () => {
    expect(computeCoupleAgeGroup(birthForAge(19), birthForAge(18), refYear)).toBe('Adulte');
  });

  it('both partners same age (25) → Adulte', () => {
    expect(computeCoupleAgeGroup(birthForAge(25), birthForAge(25), refYear)).toBe('Adulte');
  });

  it('both partners same age (35) → Senior I (both 35 ≥ 35 and 35 ≥ 30)', () => {
    expect(computeCoupleAgeGroup(birthForAge(35), birthForAge(35), refYear)).toBe('Senior I');
  });

  it('Senior I: older=35, younger=30 (both meet threshold)', () => {
    expect(computeCoupleAgeGroup(birthForAge(35), birthForAge(30), refYear)).toBe('Senior I');
  });

  it('Senior I miss: older=34 → Adulte (older does not meet 35 threshold)', () => {
    expect(computeCoupleAgeGroup(birthForAge(34), birthForAge(30), refYear)).toBe('Adulte');
  });

  it('Senior I miss: younger=29 → Adulte (younger does not meet 30 threshold)', () => {
    expect(computeCoupleAgeGroup(birthForAge(35), birthForAge(29), refYear)).toBe('Adulte');
  });

  it('Senior II: older=45, younger=40', () => {
    expect(computeCoupleAgeGroup(birthForAge(45), birthForAge(40), refYear)).toBe('Senior II');
  });

  it('Senior II miss: younger=39 → Senior I', () => {
    expect(computeCoupleAgeGroup(birthForAge(45), birthForAge(39), refYear)).toBe('Senior I');
  });

  it('Senior III: older=55, younger=50', () => {
    expect(computeCoupleAgeGroup(birthForAge(55), birthForAge(50), refYear)).toBe('Senior III');
  });

  it('Senior IV: older=65, younger=60', () => {
    expect(computeCoupleAgeGroup(birthForAge(65), birthForAge(60), refYear)).toBe('Senior IV');
  });

  it('Senior V: older=70, younger=70', () => {
    expect(computeCoupleAgeGroup(birthForAge(70), birthForAge(70), refYear)).toBe('Senior V');
  });

  it('Senior V miss: younger=69 → Senior IV', () => {
    expect(computeCoupleAgeGroup(birthForAge(70), birthForAge(69), refYear)).toBe('Senior IV');
  });
});
```

- [x] **Step 2: Run the tests**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="age-group.util.spec" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [x] **Step 3: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect
git add apps/backend/src/common/age-group/age-group.util.spec.ts
git commit -m "test(age-group): add exact boundary tests for solo and couple age group thresholds

Solo: every Article 5 threshold (11/12, 13/14, 15/16, 18/19, 29/30).
Couple: Juvénile I/II, Junior I/II, Youth, Adulte lower bounds, plus
Senior I-V with both-partners-meet / one-partner-misses cases, and
same-age-partner scenarios."
```

---

## Task 6 — Registration eligibility and MAJEURE specialty tests

**Files:**

- Modify: `apps/backend/src/competitions/services/competition-registration.service.spec.ts`

**Prerequisite:** Tasks 2 and 3 must be completed first.

- [x] **Step 1: Add eligibility and MAJEURE specialty tests**

Add the following `describe` block inside the top-level `describe("CompetitionRegistrationService", ...)` after the `describe("unregister", ...)` block:

```typescript
describe('register — eligibility and MAJEURE specialty rule (Article 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaService.registration.create.mockResolvedValue({ id: 'r1' });
  });

  it('should throw BadRequestException for CLASSIFICATRICE when age group mismatch', async () => {
    mockPrismaService.event.findUnique.mockResolvedValue({
      id: 'e1',
      competitionId: 'c1',
      eventType: 'SOLO',
      competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: 'NATIONALE' },
      category: 'Latin',
      ageGroup: 'Solo Adulte',
      eventKind: 'CLASSIFICATRICE',
      level: 'Intermédiaire',
    });
    mockPrismaService.registration.findFirst.mockResolvedValue(null);
    // Born 2014 → age 11 → Solo Juvénile, not Solo Adulte
    mockPrismaService.user.findUnique.mockResolvedValue({
      birthDate: new Date(2014, 5, 1),
    });

    await expect(service.register('e1', 'u1', undefined, { byOrganizer: true })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException for CLASSIFICATRICE with insufficient level', async () => {
    mockPrismaService.event.findUnique.mockResolvedValue({
      id: 'e1',
      competitionId: 'c1',
      eventType: 'COUPLE',
      competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: 'NATIONALE' },
      category: 'Latin',
      ageGroup: 'Adulte',
      eventKind: 'CLASSIFICATRICE',
      level: 'Avancé',
    });
    mockPrismaService.registration.findFirst.mockResolvedValue(null);
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1), firstName: 'A', lastName: 'B' });

    await expect(
      service.register('e1', 'u1', 'A B', {
        byOrganizer: true,
        partnerUserId: 'p1',
        registrantLevel: 'Débutant',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should succeed for CLASSIFICATRICE with sufficient level', async () => {
    mockPrismaService.event.findUnique.mockResolvedValue({
      id: 'e1',
      competitionId: 'c1',
      eventType: 'COUPLE',
      competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: 'NATIONALE' },
      category: 'Latin',
      ageGroup: 'Adulte',
      eventKind: 'CLASSIFICATRICE',
      level: 'Avancé',
    });
    mockPrismaService.registration.findFirst.mockResolvedValue(null);
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1), firstName: 'A', lastName: 'B' });

    const result = await service.register('e1', 'u1', 'A B', {
      byOrganizer: true,
      partnerUserId: 'p1',
      registrantLevel: 'Avancé',
    });

    expect(result.id).toBe('r1');
  });

  it('should throw BadRequestException for second MAJEURE registration in same specialty', async () => {
    mockPrismaService.event.findUnique.mockResolvedValue({
      id: 'e1',
      competitionId: 'c1',
      eventType: 'COUPLE',
      competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: 'MAJEURE' },
      category: 'Latin',
      ageGroup: 'Adulte',
      eventKind: 'MAJEURE',
      level: null,
    });
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1), firstName: 'A', lastName: 'B' });
    // First findFirst = no duplicate; second findFirst = existing registration in same specialty
    mockPrismaService.registration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-r' });

    await expect(
      service.register('e1', 'u1', 'A B', {
        byOrganizer: true,
        partnerUserId: 'p1',
        coupleAgeGroup: 'Adulte',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should succeed when no existing MAJEURE registration in same specialty', async () => {
    mockPrismaService.event.findUnique.mockResolvedValue({
      id: 'e1',
      competitionId: 'c1',
      eventType: 'COUPLE',
      competition: { title: 'Comp', date: new Date(2025, 5, 1), competitionType: 'MAJEURE' },
      category: 'Latin',
      ageGroup: 'Adulte',
      eventKind: 'MAJEURE',
      level: null,
    });
    mockPrismaService.user.findUnique
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
      .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1), firstName: 'A', lastName: 'B' });
    // Both findFirst calls return null (no duplicate, no same-specialty conflict)
    mockPrismaService.registration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await service.register('e1', 'u1', 'A B', {
      byOrganizer: true,
      partnerUserId: 'p1',
      coupleAgeGroup: 'Adulte',
    });

    expect(result.id).toBe('r1');
  });
});
```

- [x] **Step 2: Run the tests**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test -- --testPathPattern="competition-registration.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [x] **Step 3: Run the full test suite**

```bash
cd /Users/gabin/Development/FFD-Connect && pnpm --filter backend test --no-coverage 2>&1 | tail -10
```

Expected: All tests pass with zero failures.

- [x] **Step 4: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect
git add apps/backend/src/competitions/services/competition-registration.service.spec.ts
git commit -m "test(registration): add eligibility and MAJEURE specialty rule tests

- Age group mismatch in CLASSIFICATRICE → BadRequestException
- CLASSIFICATRICE with insufficient level → BadRequestException
- CLASSIFICATRICE with sufficient level → succeeds
- Second MAJEURE registration same specialty → BadRequestException
- First MAJEURE registration → succeeds"
```

---

## Criteria de sortie de Phase 5

- [x] Bug 1: `getAllowedCoupleAgeClassesForEvent("Senior V", "", "standard")` does NOT contain "Senior IV"
- [x] Bug 1: `getAllowedCoupleAgeClassesForEvent("Senior V", "", "latines")` DOES contain "Senior IV"
- [x] Bug 2: Registration with `finalAgeGroup` set + no `eventKind`/`competitionType` still runs eligibility
- [x] Bug 3: Couple registration with missing partner birthDate + no `coupleAgeGroup` option → `coupleAgeGroup: null`
- [x] `level-accession.util.spec.ts` exists with tests for all 8 exported functions
- [x] Age boundary tests cover every solo threshold and every couple Senior threshold
- [x] Registration eligibility tests cover age mismatch, level check, MAJEURE specialty rule
- [x] Full backend test suite passes with zero regressions
- [x] `pnpm typecheck` passes with 0 errors
