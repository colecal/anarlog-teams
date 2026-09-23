import { create } from "zustand";

import { commands } from "@anlg/plugin-detect";

import { executeTransaction, liveQueryClient } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";
import { parseSpeakerContext } from "~/stt/speaker-context";
import { createTeamsCaptionPoller } from "~/stt/teams-captions";

export const useTeamsCaptionStatus = create<{ status: string }>(() => ({
  status: "not_recording",
}));

export function startTeamsCaptionCapture(sessionId: string) {
  let atCapacity = false;
  const enabled = async () =>
    resolveConfigValue(
      "teams_caption_names",
      await getStoredSettingValues(),
    ) === true;
  const poller = createTeamsCaptionPoller({
    enabled,
    snapshot: async () => {
      const result = await commands.captureTeamsCaptions();
      if (result.status === "error")
        throw new Error("Caption capture unavailable");
      return result.data;
    },
    status: (status) =>
      useTeamsCaptionStatus.setState({
        status:
          atCapacity && status === "capturing"
            ? "capture_limit_reached"
            : status,
      }),
    persist: (observations, valid) =>
      enqueueDatabaseWrite(`session:${sessionId}`, async () => {
        if (!valid() || !(await enabled())) return;
        const rows = await liveQueryClient.execute<{ context: string | null }>(
          "SELECT json_extract(metadata_json, '$.speaker_context') AS context FROM sessions WHERE id = ? AND deleted_at IS NULL",
          [sessionId],
        );
        if (!rows[0] || !valid() || !(await enabled())) return;
        const context = parseSpeakerContext(rows[0].context);
        const previous = context.teams_captions ?? [];
        if (previous.length >= 10_000) {
          atCapacity = true;
          useTeamsCaptionStatus.setState({ status: "capture_limit_reached" });
          return;
        }
        if (context.teams_captions && observations.length === 0) return;
        const next = {
          ...context,
          teams_captions: [...previous, ...observations].slice(0, 10_000),
        };
        atCapacity = next.teams_captions.length >= 10_000;
        if (!valid()) return;
        await executeTransaction([
          {
            sql: "UPDATE sessions SET metadata_json = json_set(metadata_json, '$.speaker_context', json(?)), updated_at = ? WHERE id = ? AND deleted_at IS NULL",
            params: [JSON.stringify(next), new Date().toISOString(), sessionId],
          },
        ]);
      }),
  });
  const timer = setInterval(() => void poller.poll(), 1_000);
  void poller.poll();
  return {
    stop: async () => {
      clearInterval(timer);
      await poller.stop();
    },
  };
}
