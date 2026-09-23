import { Trans } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import {
  useSetSettingValues,
  useStoredSettingValues,
} from "~/settings/queries";
import { SettingSwitchRow } from "~/settings/setting-row";
import { resolveConfigValue } from "~/shared/config";
import { useTeamsCaptionStatus } from "~/stt/teams-caption-capture";

export function TeamsCaptionSettings() {
  const stored = useStoredSettingValues();
  const setValues = useSetSettingValues();
  const status = useTeamsCaptionStatus((state) => state.status);
  if (platform() !== "macos") return null;
  return (
    <div className="flex flex-col gap-2">
      <SettingSwitchRow
        title={<Trans>Teams caption speaker names (experimental)</Trans>}
        description={
          <Trans>
            While recording, read visible native Teams captions to match names
            to transcript words. Requires Accessibility permission, live
            captions, participant consent, and employer approval. No voiceprints
            are created. Captured text follows the session's storage and sync
            settings.
          </Trans>
        }
        checked={resolveConfigValue("teams_caption_names", stored) === true}
        onChange={(value) => setValues({ teams_caption_names: value })}
      />
      <p role="status" className="text-muted-foreground text-sm">
        <Trans>Caption status</Trans>: {status.replace(/_/g, " ")}
      </p>
    </div>
  );
}
