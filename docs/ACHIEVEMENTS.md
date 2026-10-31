# Achievements, points and the skin shop

Draft 2026-10-31. Status: **proposal**, numbers open to change. Tracks the "Achievement unlock" task in the
MyToDoEase project.

## The idea in one paragraph

Achievements are the only way to earn points. Each one pays out once. All 50 together are worth
**10,000 points**, which buys **one or two skins**: one Legendary, or two Rare, or four Common. Streaks are the
main line (43 % of all points), because completing tasks alone is too easy to farm. Points buy cosmetic skins in
the style of Discord and Steam: avatar frames, pet skins, profile borders, sticky-note skins, background
effects and Insights designs.

## Requirements (from the brief)

- 50 achievements, each with a point value.
- Completing every achievement is enough for about one or two skins.
- Skins are cosmetic only, like Discord or Steam: avatar, pet skin, border, sticky-note skin, background
  effect, Insights design.
- Points from task completions are easy to farm, so continuous streaks are the main way to earn.

## Assumptions (change these and the numbers below scale)

- "1/2 skin" means one or two skins, not half a skin.
- Points come only from achievements; there is no daily or per-task income.
- Each achievement unlocks once; there are no repeatable rewards in this first set.
- Skins never expire, and points never expire.

## Point economy

| Number | Value | Why |
| ------ | ----- | --- |
| Total from all 50 achievements | 10,000 | One round number to price skins against |
| Streak achievements | 4,250 (43 %) | Hardest to fake: needs real activity every day |
| Completion milestones | 2,600 (26 %) | Volume, capped per day so it cannot be farmed |
| Everything else | 3,150 (31 %) | Habits, planning, notes, Insights, hidden fun |

Rough earning pace for someone who uses TodoEase most days:

| After | Points (typical) | Can buy |
| ----- | ---------------- | ------- |
| 1 week | about 600 | nothing yet; first Common is in sight |
| 1 month | about 2,500 | one Common |
| 3 months | about 5,500 | one Rare, or two Common |
| 1 year+ | 10,000 (everything) | one Legendary, or two Rare |

The last 2,000 points need the 365-day streak and the 1-year anniversary, so a full set takes at least a year.

## Shop prices

| Tier | Price | Examples |
| ---- | ----- | -------- |
| Common | 2,500 | Static profile border, sticky-note paper skin (kraft, grid, lined), accent colour pack |
| Rare | 5,000 | Avatar frame, pet skin, subtle background effect (falling leaves, starfield), Insights colour theme |
| Epic | 7,500 | Animated avatar frame, animated background effect, Insights design (e.g. World theme pack) |
| Legendary | 10,000 | Matching bundle: avatar frame + border + note skin + background + pet skin in one theme |

With all achievements (10,000): 1 Legendary, or 2 Rare, or 1 Epic + 1 Common, or 4 Common.

### Shop sections

The Shop page lists skins by what they change (`SHOP_CATEGORIES` and `SHOP_ITEMS` in
`frontend/src/lib/achievements.ts`); rarity sets the price. Each section's first card is the look everyone has
(Included). The whole-shop page shows up to 5 skins per section (`SECTION_PREVIEW` in `AchievementsView.tsx`);
a section with more ends in a Show more card that opens that section on its own page.

| Section | Skins |
| ------- | ----- |
| Background effects (Home page) | Plain (included), Dot trail (Rare), Character field, Line wave, Chroma trail, Northern lights (Epic), Black hole (Legendary) |
| Tab effects (selected sidebar item) | Soft fill (included), Accent bar, Gradient pill (Common), Shimmer, Neon glow (Rare) |
| Dashboard effects (sidebar progress card) | Classic (included), Aurora, Confetti finish (Rare), Constellation week (Epic) |
| Calendar effects | Classic (included), Today spotlight, Busy-day glow (Common), Seasons (Rare) |
| Sticky notes | Paper skin (Common), Washi tape (Rare) |
| Insights | Colour theme (Rare), World pack (Epic) |
| Profile | Profile border, Accent colour pack (Common), Avatar frame, Pet skin (Rare), Animated avatar frame (Epic) |
| Bundles | Matching bundle (Legendary) |

## The 50 achievements

Points are paid once, when the achievement unlocks. Hidden achievements show as "???" until unlocked.

### Getting started (8 · 180 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 1 | First step | complete your first task | 20 |
| 2 | Captured | add 10 tasks | 20 |
| 3 | Organiser | create your first project | 20 |
| 4 | Tagged | use one label on 3 tasks | 30 |
| 5 | Sectioned | add a section to a project | 20 |
| 6 | Make it yours | change the theme or accent colour | 20 |
| 7 | Shortcut savvy | open search with Ctrl+K 10 times | 30 |
| 8 | Sticky start | write your first sticky note | 20 |

### Completion milestones (8 · 2,600 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 9 | Getting going | complete 10 tasks | 50 |
| 10 | Half century | complete 50 tasks | 100 |
| 11 | Centurion | complete 100 tasks | 150 |
| 12 | Quarter thousand | complete 250 tasks | 250 |
| 13 | Machine | complete 500 tasks | 400 |
| 14 | Thousandaire | complete 1,000 tasks | 600 |
| 15 | Legend of done | complete 2,500 tasks | 900 |
| 16 | P1 slayer | complete 25 Priority 1 tasks | 150 |

### Streaks: the main line (8 · 4,250 points)

A streak day needs at least one counted completion that day (see "Keeping it fair").

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 17 | Warm-up | reach a 3-day streak | 50 |
| 18 | One week | reach a 7-day streak | 150 |
| 19 | Fortnight | reach a 14-day streak | 250 |
| 20 | Month strong | reach a 30-day streak | 500 |
| 21 | Two months | reach a 60-day streak | 750 |
| 22 | Hundred days | reach a 100-day streak | 1,000 |
| 23 | Year of done | reach a 365-day streak | 1,500 |
| 24 | Comeback | start a new streak within 2 days of losing one of 7+ days | 50 |

### Habits (6 · 900 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 25 | Inbox zero | empty your Inbox after sorting at least 5 tasks that day | 100 |
| 26 | Clean slate | end 7 days in a row with nothing overdue | 200 |
| 27 | Planner | use Plan my day 10 times | 100 |
| 28 | Early bird | complete 20 tasks before 9 am | 100 |
| 29 | Weekend warrior | complete tasks on 10 different weekends | 100 |
| 30 | Perfect week | complete every task due in a week, on time (at least 10) | 300 |

### Planning and organising (8 · 830 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 31 | On repeat | create 5 repeating tasks | 50 |
| 32 | Ritual | complete one repeating task 30 times | 200 |
| 33 | Time blocker | give 20 tasks a time on the calendar | 100 |
| 34 | Long haul | create a multi-day task | 30 |
| 35 | Synced | connect Google Calendar | 50 |
| 36 | Broken down | finish a task whose 5+ sub-tasks are all done | 100 |
| 37 | Project finisher | complete every task in a project of 10+ tasks | 200 |
| 38 | Ahead of time | complete 25 tasks before their due date | 100 |

### Notes and capture (5 · 330 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 39 | Brain dump | write 10 sticky notes | 50 |
| 40 | Thought to action | turn one note into 3+ tasks | 50 |
| 41 | Note keeper | create 25 tasks from notes in total | 100 |
| 42 | On the desk | pop a note out into its own window (desktop) | 30 |
| 43 | Quick draw | add 50 tasks using quick-add words (#project, @label, dates, p1–p4) | 100 |

### Insights and World (3 · 500 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 44 | Self-aware | open Insights on 7 different days | 50 |
| 45 | Green year | have 100 days with a completion in one calendar year | 300 |
| 46 | World builder | grow 30 things in your Insights World | 150 |

### Hidden (4 · 410 points)

| # | Achievement | Unlocks when you… | Points |
| - | ----------- | ----------------- | -----: |
| 47 | Oops, fixed | undo an action with Ctrl+Z | 20 |
| 48 | Docked | dock the mini window to the screen edge | 30 |
| 49 | My keys | change a keyboard shortcut | 30 |
| 50 | Anniversary | use TodoEase for a full year | 330 |

**Total: 10,000 points.**

## Keeping it fair (anti-farming)

Points buy things, so they must be hard to fake:

1. A completion counts only if the task existed for at least 5 minutes before it was ticked.
2. At most 30 completions per day count towards milestones; extra ones still count for streaks.
3. Undoing a completion, or deleting the task within 24 hours, removes its credit.
4. Each achievement unlocks once per account, whatever device it happens on.
5. Hidden and settings achievements (Make it yours, My keys, Docked) are worth little on purpose.

## Open questions

1. Can skins also be bought with money (one-time payment), with points as the free path? This fits the
   "cosmetic unlocks + one-time payments, never ads" rule but is not decided.
2. Seasonal achievement sets later (e.g. a holiday set worth 1,000 points) would keep earning possible after
   the first 50; prices would stay the same.
3. Where unlocks are checked: on the device (simple, but can be tampered with) or in a cloud function (safe,
   but Cloud Functions need the paid Blaze plan, which is ruled out). A middle way is checking on the device
   and storing unlocks with security rules that only allow adding, never changing points directly.
