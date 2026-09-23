import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptionObservation } from "./teams-captions";

const mocks = vi.hoisted(() => ({
  enabled: true,
  deleted: false,
  context: { intervals: [] } as {
    intervals: unknown[];
    teams_captions?: CaptionObservation[];
  },
  snapshot: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@anlg/plugin-detect", () => ({
  commands: { captureTeamsCaptions: mocks.snapshot },
}));
vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: async () => ({
    values: { teams_caption_names: mocks.enabled },
    hasValues: new Set(["teams_caption_names"]),
  }),
}));
vi.mock("~/db/write-queue", () => ({
  enqueueDatabaseWrite: (_key: string, write: () => Promise<void>) => write(),
}));
vi.mock("~/db", () => ({
  liveQueryClient: {
    execute: async () =>
      mocks.deleted ? [] : [{ context: JSON.stringify(mocks.context) }],
  },
  executeTransaction: async (writes: Array<{ params: unknown[] }>) => {
    mocks.write(writes);
    mocks.context = JSON.parse(writes[0]!.params[0] as string);
  },
}));

import {
  startTeamsCaptionCapture,
  useTeamsCaptionStatus,
} from "./teams-caption-capture";

const caption = {
  speaker: "Alex Example",
  text: "We should review the example tomorrow",
};
const snapshot = {
  status: "ok",
  data: { contextId: "test-meeting", captions: [], status: "capturing" },
};
let capture: ReturnType<typeof startTeamsCaptionCapture> | undefined;

describe("Teams caption session persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.deleted = false;
    mocks.context = { intervals: [] };
    mocks.snapshot.mockResolvedValue(snapshot);
  });
  afterEach(async () => {
    await capture?.stop();
    capture = undefined;
    vi.useRealTimers();
  });
  it("persists caption mode once, appends only fresh evidence, and stops the timer", async () => {
    capture = startTeamsCaptionCapture("test-session");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.context.teams_captions).toEqual([]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    mocks.snapshot.mockResolvedValue({
      ...snapshot,
      data: { ...snapshot.data, captions: [caption] },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.context.teams_captions).toEqual([
      { ...caption, observed_at_ms: 51_000 },
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    await capture.stop();
    const reads = mocks.snapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.snapshot).toHaveBeenCalledTimes(reads);
  });
  it("never reads Teams when the user has not opted in", async () => {
    mocks.enabled = false;
    capture = startTeamsCaptionCapture("test-session");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not recreate a deleted session", async () => {
    mocks.deleted = true;
    capture = startTeamsCaptionCapture("test-session");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("reports the retained-evidence cap instead of claiming successful capture", async () => {
    mocks.context.teams_captions = Array.from({ length: 10_000 }, () => ({
      ...caption,
      observed_at_ms: 1000,
    }));
    capture = startTeamsCaptionCapture("test-session");
    await vi.advanceTimersByTimeAsync(0);
    expect(useTeamsCaptionStatus.getState().status).toBe(
      "capture_limit_reached",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
