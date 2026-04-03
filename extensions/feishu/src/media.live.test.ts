import { describe, expect, it } from "vitest";
import type { ClawdbotConfig } from "../runtime-api.js";
import { downloadImageFeishu, uploadImageFeishu } from "./media.js";

const FEISHU_APP_ID = process.env.FEISHU_APP_ID?.trim() ?? "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET?.trim() ?? "";
const FEISHU_DOMAIN = process.env.OPENCLAW_LIVE_FEISHU_DOMAIN?.trim() || "feishu";

const liveEnabled =
  process.env.OPENCLAW_LIVE_TEST === "1" &&
  FEISHU_APP_ID.length > 0 &&
  FEISHU_APP_SECRET.length > 0;
const describeLive = liveEnabled ? describe : describe.skip;

function createLiveConfig(): ClawdbotConfig {
  return {
    channels: {
      feishu: {
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
        domain: FEISHU_DOMAIN,
      },
    },
  } as ClawdbotConfig;
}

function createTinyPng(): Buffer {
  // 1x1 PNG (opaque black pixel)
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WmWzvQAAAAASUVORK5CYII=",
    "base64",
  );
}

describeLive("feishu media live", () => {
  it("uploads and downloads image via im.image APIs", async () => {
    const cfg = createLiveConfig();
    const uploaded = await uploadImageFeishu({
      cfg,
      image: createTinyPng(),
    });

    expect(uploaded.imageKey).toBeTruthy();

    const downloaded = await downloadImageFeishu({
      cfg,
      imageKey: uploaded.imageKey,
    });

    expect(downloaded.buffer.byteLength).toBeGreaterThan(0);
    if (downloaded.contentType) {
      expect(downloaded.contentType.toLowerCase()).toContain("image");
    }
  }, 60_000);
});
