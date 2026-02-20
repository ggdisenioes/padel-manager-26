import { supabase } from "./supabase";

async function sendNotification(payload: Record<string, unknown>) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;

  const res = await fetch("/api/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[notify] API returned ${res.status}:`, result);
  } else {
    console.log("[notify] Notifications sent:", result);
  }
}

/**
 * Notify players about newly created matches.
 * Non-blocking: errors are logged but don't interrupt the flow.
 */
export async function notifyMatchCreated(matchIds: number[]) {
  if (!matchIds.length) return;

  try {
    await sendNotification({
      type: "match_created",
      match_ids: matchIds,
    });
  } catch (err) {
    console.error("[notify] Failed to send match notifications:", err);
  }
}

/**
 * Notify players when a match result is finalized.
 * Non-blocking: errors are logged but don't interrupt the flow.
 */
export async function notifyMatchFinished(matchId: number) {
  if (!matchId) return;

  try {
    await sendNotification({
      type: "match_finished",
      match_id: matchId,
    });
  } catch (err) {
    console.error("[notify] Failed to send match finished notification:", err);
  }
}
