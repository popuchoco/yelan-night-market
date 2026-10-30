import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DATA, getOutletSpecialty, outletRetailPrice } from "../dist/data.js";
import { CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, ENDINGS, MARKET_CARDS, MARKET_CARD_SCHEDULE, WEEKLY_DECISION_DAYS, campaignCycleDay, campaignEntry, marketCardForDay, selectEnding } from "../dist/campaign.js";
import { closeDepreciation, CHART_OF_ACCOUNTS, getDailyCashbookSummary, postJournal } from "../dist/accounting.js";
import { boot, createGameEngine } from "../dist/game.js";
import { createGameAudio } from "../dist/audio.js";
import { createUI } from "../dist/ui.js";
import { applyCameraAction, getFootprintDepth } from "../dist/scene.js";
import { getStallVisualProfile, splitStallSupportPosts } from "../dist/scene/objects.js";
import { createRevenueRenderer, getRevenueBreakdown } from "../dist/scene/revenue.js";
import { INSURANCE_RATES, isInsuranceBillingDay } from "../dist/safety.js";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS, evaluateAchievements, normalizeAchievementState } from "../dist/achievements.js";
import { WEEKLY_FOCUSES, createWeeklyFocus, getLegacyWeeklyFocus, getWeeklyFocusIdForDecision, normalizeWeeklyFocus, recordWeeklyFocusProgress, resolveWeeklyFocus } from "../dist/progression.js";
import {
  createLedger, fixedOperatingCost, forecast, freshState, getPurchasePrice, getTonightGuests, hasBrandAlliance,
  captureStateSnapshot, loadState, loadStateResult, normalizeState, restoreStateSnapshot,
  saveState, saveStateResult, clearSavedProgress, SAVE_SCHEMA_VERSION,
  todayEvent, todayMarketCard, todayStory, ledgerIncome, ledgerNet
} from "../dist/state.js";

function serviceState(day = 3) {
  const state = freshState();
  state.day = day;
  state.phase = "service";
  state.ledger = createLedger(state);
  return state;
}

test("weekly focus maps strategic choices to bounded, save-safe objectives", () => {
  assert.equal(getWeeklyFocusIdForDecision("expand"), "expand");
  assert.equal(getWeeklyFocusIdForDecision("hire"), "hire");
  assert.equal(getWeeklyFocusIdForDecision("acquire"), "acquire");
  assert.equal(getWeeklyFocusIdForDecision("hold"), "hold");
  assert.equal(getLegacyWeeklyFocus(8, []), null, "legacy saves wait for a decision at the new-week boundary");
  assert.equal(getLegacyWeeklyFocus(10, [{ day: 8, id: "expand" }]).id, "expand");
  assert.equal(normalizeWeeklyFocus({ id: "unknown", target: 999 }), null);
  assert.equal(normalizeWeeklyFocus({ id: "hire", target: 999, progress: 999 }).target, WEEKLY_FOCUSES.hire.target);
});

test("weekly focus progress only counts matching activities and resolves without a failure penalty", () => {
  const focus = createWeeklyFocus("hire", 8);
  recordWeeklyFocusProgress(focus, "served");
  assert.equal(focus.progress, 0);
  recordWeeklyFocusProgress(focus, "good-service");
  assert.equal(focus.progress, 1);
  focus.progress = focus.target;
  const result = resolveWeeklyFocus(focus, { closingDay: 14, coins: 900, loanTakenDay: 0 });
  assert.equal(result.success, true);
  assert.equal(result.resolvedDay, 14);
  assert.match(result.message, /口碑 \+2/);

  const missed = createWeeklyFocus("hold", 15);
  missed.progress = missed.target;
  const failed = resolveWeeklyFocus(missed, { closingDay: 21, coins: 900, loanTakenDay: 15 });
  assert.equal(failed.success, false, "borrowing during the focus week blocks the no-new-loan goal");
  assert.match(failed.message, /沒有額外扣款/);
});

test("weekly focus closes into the diary and worksheet, rewarding completion only", () => {
  const state = serviceState(7);
  state.phase = "report";
  state.reportChoice = "paperboat";
  state.weeklyFocus = createWeeklyFocus("opening", 1);
  state.weeklyFocus.progress = state.weeklyFocus.target;
  const beforeFame = state.fame;
  const beforeRegulars = state.regulars;
  const engine = createGameEngine(state, { random: () => 1 });
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.weeklyFocus.result.success, true);
  assert.equal(state.journal[0].weeklyFocus.success, true);
  assert.equal(state.accounting.weeklyReports.at(-1).weeklyFocus.success, true);
  assert.equal(state.fame, beforeFame + 2);
  assert.equal(state.regulars, beforeRegulars + 1);
  assert.match(state.journal[0].weeklyFocus.message, /口碑 \+2/);
});

test("engine backfills a missing legacy focus when the current week is already underway", () => {
  const state = freshState();
  state.day = 7;
  delete state.weeklyFocus;
  createGameEngine(state);
  assert.equal(state.weeklyFocus.id, "opening");
  assert.equal(state.weeklyFocus.startDay, 7);
  assert.equal(state.weeklyFocus.target, 3);

  const boundary = freshState();
  boundary.day = 8;
  boundary.phase = "decision";
  delete boundary.weeklyFocus;
  createGameEngine(boundary);
  assert.equal(boundary.weeklyFocus, null, "a legacy save at a decision prompt waits for the chosen direction");
});

test("schema-five saves migrate into the current week's decision-matched focus", () => {
  const migrated = normalizeState({ schemaVersion: 5, day: 10, decisions: [{ day: 8, id: "expand" }] });
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.deepEqual(migrated.weeklyFocus, {
    id: "expand", startDay: 10, progress: 0, target: 18, resolved: false, success: false, result: null
  });
});

test("weekly decisions change guest capacity, recurring costs, and lead into the next prep phase", () => {
  const state = serviceState(7);
  state.phase = "report";
  state.reportChoice = "paperboat";
  const engine = createGameEngine(state);
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.day, 8);
  assert.equal(state.phase, "decision");
  const guestsBefore = getTonightGuests(state).length;
  const rentBefore = createLedger(state).rent + createLedger(state).expansionRent;
  const fundsBefore = state.coins;
  assert.equal(engine.chooseWeeklyDecision("expand").ok, true);
  assert.equal(state.phase, "prep");
  assert.equal(state.expansions, 1);
  assert.equal(getTonightGuests(state).length, guestsBefore + 1);
  assert.equal(createLedger(state).rent + createLedger(state).expansionRent, rentBefore + 24);
  assert.equal(state.coins, fundsBefore - 460);
  assert.equal(state.weeklyFocus.id, "expand");
  assert.equal(state.weeklyFocus.progress, 0);
});
