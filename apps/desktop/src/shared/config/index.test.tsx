import { describe, expect, test } from "vitest";

import { resolveConfigValue } from ".";

describe("resolveConfigValue", () => {
  test.each([
    "teams_caption_names",
    "cloud_sync_enabled",
    "telemetry_consent",
    "crash_reporting_consent",
    "remember_speakers",
    "auto_start_scheduled_meetings",
  ] as const)("requires explicit opt-in for %s on a fresh install", (key) => {
    expect(resolveConfigValue(key, { values: {}, hasValues: new Set() })).toBe(
      false,
    );
    expect(
      resolveConfigValue(key, {
        values: { [key]: true },
        hasValues: new Set([key]),
      }),
    ).toBe(true);
  });
  test("uses legacy don't-save when audio retention is missing", () => {
    expect(
      resolveConfigValue("audio_retention", {
        values: { save_recordings: false },
        hasValues: new Set(["save_recordings"]),
      }),
    ).toBe("none");
  });

  test("keeps explicit audio retention over legacy save_recordings", () => {
    expect(
      resolveConfigValue("audio_retention", {
        values: { save_recordings: false, audio_retention: "oneMonth" },
        hasValues: new Set(["save_recordings", "audio_retention"]),
      }),
    ).toBe("oneMonth");
  });

  test("parses stored array values without exposing malformed entries", () => {
    expect(
      resolveConfigValue("spoken_languages", {
        values: { spoken_languages: '["en",2,"ko"]' },
        hasValues: new Set(["spoken_languages"]),
      }),
    ).toEqual(["en", "ko"]);
  });

  test("keeps recording disclosure auto-post off until explicitly enabled", () => {
    expect(
      resolveConfigValue("consent_auto_send_chat", {
        values: {},
        hasValues: new Set(),
      }),
    ).toBe(false);
  });

  test("shows folders on sidebar notes until explicitly disabled", () => {
    expect(
      resolveConfigValue("sidebar_show_folder", {
        values: {},
        hasValues: new Set(),
      }),
    ).toBe(true);
  });

  test("keeps sidebar tags hidden until explicitly enabled", () => {
    expect(
      resolveConfigValue("sidebar_show_tags", {
        values: {},
        hasValues: new Set(),
      }),
    ).toBe(false);
  });

  test("keeps upstream automatic updates off in the private fork", () => {
    expect(
      resolveConfigValue("automatic_updates", {
        values: {},
        hasValues: new Set(),
      }),
    ).toBe(false);
  });

  test("keeps voice memory off until explicitly enabled", () => {
    expect(
      resolveConfigValue("remember_speakers", {
        values: {},
        hasValues: new Set(),
      }),
    ).toBe(false);
  });

  test("respects an explicit remember speakers opt-out", () => {
    expect(
      resolveConfigValue("remember_speakers", {
        values: { remember_speakers: false },
        hasValues: new Set(["remember_speakers"]),
      }),
    ).toBe(false);
  });

  test("uses disabled legacy bounce preferences for the general setting", () => {
    expect(
      resolveConfigValue("notification_bounce", {
        values: {
          notification_bounce_summary: true,
          notification_bounce_transcript: false,
        },
        hasValues: new Set([
          "notification_bounce_summary",
          "notification_bounce_transcript",
        ]),
      }),
    ).toBe(false);
  });

  test("prefers the explicit general bounce preference", () => {
    expect(
      resolveConfigValue("notification_bounce", {
        values: {
          notification_bounce: true,
          notification_bounce_summary: false,
        },
        hasValues: new Set([
          "notification_bounce",
          "notification_bounce_summary",
        ]),
      }),
    ).toBe(true);
  });
});
