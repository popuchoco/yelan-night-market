import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readStyles } from "./style-support.js";
import { createAchievementsRenderer } from "../dist/ui/achievements.js";
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

test("achievement catalogue is thematic, bounded, and never changes the economy", async () => {
  assert.equal(ACHIEVEMENTS.length, 26);
  assert.deepEqual(ACHIEVEMENT_CATEGORIES.map((item) => item.id), ["all", "growth", "operations", "risk", "branches", "menu", "story", "accounting"]);
  assert.ok(ACHIEVEMENTS.every((item) => item.id && item.title && item.description && item.hint && !("reward" in item)));
  const css = await readStyles();
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /id="achievementTrigger"[^>]*data-action="open-achievements"/);
  assert.match(html, /<dialog class="achievement-dialog" id="achievementsDialog"/);
  assert.match(css, /\.achievement-card\.is-unlocked/);
  assert.match(css, /\.achievement-card\.is-locked\s*\{[^}]*filter:\s*grayscale\(1\)/);
});

test("achievement state normalization filters unknown ids and legacy backfill is silent", () => {
  const normalized = normalizeAchievementState({
    unlocked: { first_open: { day: 8, period: 1 }, injected: { day: 1 } },
    pending: ["first_open", "injected"], viewedStatements: ["income", "forged"]
  });
  assert.deepEqual(normalized.unlocked, { first_open: { day: 8, period: 1 } });
  assert.deepEqual(normalized.pending, ["first_open"]);
  assert.deepEqual(normalized.viewedStatements, ["income"]);

  const migrated = normalizeState({ schemaVersion: 3, day: 2, phase: "service", results: [] });
  const awards = evaluateAchievements(migrated, { silent: true });
  assert.deepEqual(awards, []);
  assert.deepEqual(migrated.achievements.unlocked.first_open, { day: 0, period: 0 });
  assert.deepEqual(migrated.achievements.pending, []);
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
});

test("visible locked achievements show a bounded next-step progress bar without exposing secrets", () => {
  const priorDocument = globalThis.document;
  const makeNode = (tagName) => ({
    tagName, children: [], dataset: {}, attributes: {}, style: {},
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  });
  globalThis.document = { createElement: makeNode };
  try {
    const state = freshState();
    state.expansions = 2;
    const root = createAchievementsRenderer().render(state);
    const findByAchievement = (node, id) => {
      if (node.dataset?.achievementId === id) return node;
      for (const child of node.children || []) {
        const found = findByAchievement(child, id);
        if (found) return found;
      }
      return null;
    };
    const findClass = (node, className) => {
      if (node.className === className) return node;
      for (const child of node.children || []) {
        const found = findClass(child, className);
        if (found) return found;
      }
      return null;
    };
    const progress = findClass(findByAchievement(root, "expand_thrice"), "achievement-progress-track");
    assert.equal(progress.attributes.role, "progressbar");
    assert.equal(progress.attributes["aria-valuenow"], "2");
    assert.equal(progress.attributes["aria-valuemax"], "3");
    assert.equal(findClass(findByAchievement(root, "harbor_icon"), "achievement-progress-line"), null);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test("first successful opening records a milestone without granting money", () => {
  const state = freshState();
  const engine = createGameEngine(state, { random: () => 0.999 });
  const startingCash = state.coins;
  assert.equal(engine.openDoors().ok, true);
  assert.deepEqual(state.achievements.unlocked.first_open, { day: 1, period: 1 });
  assert.deepEqual(engine.drainAchievementAwards(), ["first_open"]);
  assert.equal(state.coins, startingCash - fixedOperatingCost(state.ledger));
});

test("period achievements record the actual close night rather than the next night", () => {
  const state = freshState();
  state.day = 31;
  state.accounting.monthlyReports.push({ period: 1, endDay: 30, outcomeId: "harbor-icon", totals: { profit: 40 } });
  evaluateAchievements(state);
  assert.deepEqual(state.achievements.unlocked.period_close, { day: 30, period: 1 });
  assert.deepEqual(state.achievements.unlocked.positive_period, { day: 30, period: 1 });
  assert.deepEqual(state.achievements.unlocked.harbor_icon, { day: 30, period: 1 });
});

test("journal and statement reading achievements persist, while restarting clears them and pending awards", () => {
  const state = freshState();
  const engine = createGameEngine(state);
  engine.markJournalViewed();
  assert.deepEqual(engine.drainAchievementAwards(), ["read_journal"]);
  state.accounting.monthlyReports.push({ id: "period-1", totals: { profit: 10 } });
  evaluateAchievements(state, { silent: true });
  for (const id of ["income", "equity", "position", "cashflow"]) engine.markStatementViewed(id);
  assert.deepEqual(engine.drainAchievementAwards(), ["read_statements"]);
  assert.equal(state.achievements.viewedStatements.length, 4);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(engine.restartCampaign().ok, true);
  assert.deepEqual(state.achievements.unlocked, {});
  assert.deepEqual(state.achievements.pending, []);
  assert.deepEqual(engine.drainAchievementAwards(), []);
});
