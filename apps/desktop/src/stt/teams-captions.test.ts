import { describe, expect, it, vi } from "vitest";

import {
  createTeamsCaptionPoller,
  parseCaptionObservations,
  type CaptionSnapshot,
  type CaptionObservation,
} from "./teams-captions";

const caption = {
  speaker: "Alex Example",
  text: "We should review the example tomorrow",
};
function setup() {
  const enabled = vi.fn(async () => true);
  const snapshot = vi.fn(
    async (): Promise<CaptionSnapshot> => ({
      contextId: "meeting-one",
      captions: [],
      status: "capturing",
    }),
  );
  const persist = vi.fn(
    async (_observations: CaptionObservation[], _valid: () => boolean) => {},
  );
  const status = vi.fn();
  return {
    enabled,
    snapshot,
    persist,
    status,
    poller: createTeamsCaptionPoller({
      enabled,
      snapshot,
      persist,
      status,
      now: () => 12345,
    }),
  };
}
describe("Teams caption recording lifecycle", () => {
  it("does not read Accessibility when disabled", async () => {
    const f = setup();
    f.enabled.mockResolvedValue(false);
    await f.poller.poll();
    expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });
  it("baselines existing captions and records only changes", async () => {
    const f = setup();
    f.snapshot.mockResolvedValue({
      contextId: "meeting-one",
      captions: [caption],
      status: "capturing",
    });
    await f.poller.poll();
    expect(f.persist.mock.calls[0]?.[0]).toEqual([]);
    f.persist.mockClear();
    await f.poller.poll();
    expect(f.persist.mock.calls[0]?.[0]).toEqual([]);
    f.snapshot.mockResolvedValue({
      contextId: "meeting-one",
      captions: [{ ...caption, text: caption.text + " morning" }],
      status: "capturing",
    });
    await f.poller.poll();
    expect(f.persist.mock.calls[1]?.[0]).toEqual([
      { ...caption, text: caption.text + " morning", observed_at_ms: 12345 },
    ]);
  });
  it("does not rebind an ongoing recording to a different meeting", async () => {
    const f = setup();
    await f.poller.poll();
    f.persist.mockClear();
    f.snapshot.mockResolvedValue({
      contextId: "meeting-two",
      captions: [caption],
      status: "capturing",
    });
    await f.poller.poll();
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenLastCalledWith(
      "meeting_changed_restart_recording",
    );
  });
  it("does not wait for a hung native read and drops its late results", async () => {
    const f = setup();
    let resolve!: (value: CaptionSnapshot) => void;
    f.snapshot.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const polling = f.poller.poll();
    await vi.waitFor(() => expect(f.snapshot).toHaveBeenCalledTimes(1));
    f.persist.mockClear();
    const stopping = f.poller.stop();
    await stopping;
    expect(f.status).toHaveBeenLastCalledWith("not_recording");
    resolve({
      contextId: "meeting-one",
      captions: [caption],
      status: "capturing",
    });
    await Promise.all([polling, stopping]);
    expect(f.persist).not.toHaveBeenCalled();
    await f.poller.poll();
    expect(f.snapshot).toHaveBeenCalledTimes(1);
  });

  it("drains a database write already in progress before stop finishes", async () => {
    const f = setup();
    let finish!: () => void;
    f.persist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const polling = f.poller.poll();
    await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(1));
    const stopping = f.poller.stop();
    expect(f.status).not.toHaveBeenCalledWith("not_recording");
    expect(f.persist.mock.calls[0]?.[1]()).toBe(false);
    finish();
    await Promise.all([polling, stopping]);
    expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenLastCalledWith("not_recording");
  });
  it("drops results if permission is disabled mid-poll", async () => {
    const f = setup();
    await f.poller.poll();
    f.persist.mockClear();
    f.enabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await f.poller.poll();
    expect(f.persist).not.toHaveBeenCalled();
  });
  it("serializes overlapping polls and reports errors without transcript logging", async () => {
    const f = setup();
    f.snapshot.mockRejectedValue(new Error("private contents"));
    await Promise.all([f.poller.poll(), f.poller.poll()]);
    expect(f.snapshot).toHaveBeenCalledTimes(1);
    expect(f.status).toHaveBeenLastCalledWith("capture_error");
  });
  it("marks caption mode even when Teams exposes no supported caption layout", async () => {
    const f = setup();
    f.snapshot.mockResolvedValue({
      contextId: null,
      captions: [],
      status: "captions_off_or_unsupported_layout",
    });
    await f.poller.poll();
    expect(f.persist).toHaveBeenCalledWith([], expect.any(Function));
    expect(f.status).toHaveBeenLastCalledWith(
      "captions_off_or_unsupported_layout",
    );
  });
  it("validates stored evidence", () => {
    expect(
      parseCaptionObservations([
        null,
        {},
        { ...caption, observed_at_ms: NaN },
        { ...caption, observed_at_ms: 12345 },
      ]),
    ).toEqual([{ ...caption, observed_at_ms: 12345 }]);
  });
});
