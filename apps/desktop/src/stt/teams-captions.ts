export type CaptionObservation = {
  observed_at_ms: number;
  speaker: string;
  text: string;
};

export type CaptionSnapshot = {
  contextId: string | null;
  captions: Array<{ speaker: string; text: string }>;
  status: string;
};

export function parseCaptionObservations(value: unknown): CaptionObservation[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 10_000)
    .filter(
      (item): item is CaptionObservation =>
        item &&
        Number.isSafeInteger(item.observed_at_ms) &&
        item.observed_at_ms > 0 &&
        typeof item.speaker === "string" &&
        item.speaker.trim().length > 0 &&
        item.speaker.length <= 120 &&
        !/\p{Cc}/u.test(item.speaker) &&
        typeof item.text === "string" &&
        item.text.length > 0 &&
        item.text.length <= 2_000,
    );
}

export function createTeamsCaptionPoller(deps: {
  enabled: () => Promise<boolean>;
  snapshot: () => Promise<CaptionSnapshot>;
  persist: (
    observations: CaptionObservation[],
    valid: () => boolean,
  ) => Promise<void>;
  status: (status: string) => void;
  now?: () => number;
}) {
  let stopped = false;
  let pending: Promise<void> | null = null;
  let writing: Promise<void> | null = null;
  let context: string | null = null;
  let previous: Set<string> | null = null;
  let rejectedContext = false;
  let initialized = false;
  const now = deps.now ?? Date.now;
  const persist = async (observations: CaptionObservation[]) => {
    writing = deps.persist(observations, () => !stopped);
    try {
      await writing;
    } finally {
      writing = null;
    }
  };
  const run = async () => {
    if (!(await deps.enabled()) || stopped) {
      previous = null;
      if (!stopped) deps.status("disabled");
      return;
    }
    // Even unavailable captions must disable roster/title-based remote name guesses.
    if (!initialized) {
      await persist([]);
      if (stopped || !(await deps.enabled())) return;
      initialized = true;
    }
    const snapshot = await deps.snapshot();
    const observedAt = now();
    if (stopped || !(await deps.enabled())) {
      previous = null;
      return;
    }
    if (!snapshot.contextId) {
      previous = null;
      deps.status(snapshot.status);
      return;
    }
    context ??= snapshot.contextId;
    if (context !== snapshot.contextId) rejectedContext = true;
    if (rejectedContext) {
      deps.status("meeting_changed_restart_recording");
      return;
    }
    const current = new Set(
      snapshot.captions.map((caption) =>
        JSON.stringify([caption.speaker, caption.text]),
      ),
    );
    // Do not ingest text that was already visible when recording/permission began.
    const fresh =
      previous === null
        ? []
        : snapshot.captions.filter(
            (caption) =>
              !previous!.has(JSON.stringify([caption.speaker, caption.text])),
          );
    const observations = parseCaptionObservations(
      fresh.map((caption) => ({
        ...caption,
        observed_at_ms: observedAt,
      })),
    );
    await persist(observations);
    if (!stopped) {
      previous = current;
      deps.status(snapshot.status);
    }
  };
  return {
    poll() {
      if (stopped) return Promise.resolve();
      if (pending) return pending;
      pending = run()
        .catch(() => {
          previous = null;
          if (!stopped) deps.status("capture_error");
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    async stop() {
      stopped = true;
      // A slow native AX read must not block stopping audio. Drain only writes;
      // the stopped guard discards any read that completes later.
      await writing;
      deps.status("not_recording");
    },
  };
}
