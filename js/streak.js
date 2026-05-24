/* streak.js
 * 役割: 三日坊主防止のためのストリーク管理
 * - 「Never miss twice」原則: 1日休みはお休み券で埋められる
 * - 連続日数 / 最長 / 累計 / お休み券残数を管理
 * - マイルストーン達成時に通知メッセージ
 *
 * 注意: 通知/トーストはUI層に通知するためのコールバック onEvent を受け取る
 * (Streak単体はDOMに依存しない → Nodeでもテスト可能)
 */

import { Store } from "./store.js";
import { dateOnly, diffDays } from "./utils.js";
import { STREAK_MILESTONES, FREEZE_MAX, FREEZE_GRANT_INTERVAL_DAYS } from "./config.js";

/** イベント通知用 (toast表示など。UI層がセット) */
export const StreakEvents = {
  onMessage: null // (msg: string) => void
};
function emit(msg) {
  try { if (typeof StreakEvents.onMessage === "function") StreakEvents.onMessage(msg); }
  catch (e) { /* noop */ }
}

/** 当日アクティブを記録。連続日数を更新する */
export function markActive() {
  const s = Store.state.streak;
  const today = dateOnly();
  if (s.last_active_date === today) return; // 同日は何もしない

  // お休み券補充 (週次)
  const grantBase = s.freeze_last_grant || today;
  const elapsed = diffDays(grantBase, today);
  if (elapsed >= FREEZE_GRANT_INTERVAL_DAYS) {
    const grants = Math.floor(elapsed / FREEZE_GRANT_INTERVAL_DAYS);
    s.freeze_tokens = Math.min(FREEZE_MAX, s.freeze_tokens + grants);
    s.freeze_last_grant = today;
  }

  if (s.last_active_date) {
    const gap = diffDays(s.last_active_date, today);
    if (gap === 1) {
      s.current += 1;
    } else if (gap >= 2) {
      // 1日だけ穴あり + 券がある → 継続
      if (gap === 2 && s.freeze_tokens > 0) {
        s.freeze_tokens -= 1;
        s.current += 1;
        emit("🛡 お休み券を1枚使ってストリーク継続中！");
      } else {
        if (s.current > 0) emit(`お休み明けですね。今日からまた1日目です（前回最長 ${s.longest}日）`);
        s.current = 1;
      }
    }
    // gap === 0 はありえない (同日チェック済)、負値もありえない
  } else {
    s.current = 1;
  }

  s.longest = Math.max(s.longest, s.current);
  s.total_active_days += 1;
  s.last_active_date = today;

  s.history.push(today);
  if (s.history.length > 30) s.history = s.history.slice(-30);

  Store.save();
  checkMilestone(s.current);
}

function checkMilestone(n) {
  if (STREAK_MILESTONES[n]) emit(STREAK_MILESTONES[n]);
}

/** 今日すでにミッション達成済みか */
export function isTodayDone() {
  return Store.state.streak.last_active_date === dateOnly();
}

/** 昨日触らなかった (Never miss twice 警告対象) */
export function missedYesterday() {
  const s = Store.state.streak;
  if (!s.last_active_date) return false;
  return diffDays(s.last_active_date, dateOnly()) === 1;
}
