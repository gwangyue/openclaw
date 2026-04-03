import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginRuntimeMock } from "../../../test/helpers/plugins/plugin-runtime-mock.js";
import type { ClawdbotConfig } from "../runtime-api.js";
import { parseMessageContent, resolveFeishuMediaList } from "./bot-content.js";
import { uploadImageFeishu } from "./media.js";
import { setFeishuRuntime } from "./runtime.js";

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

describeLive("feishu inbound media parse live", () => {
  const mockSaveMediaBuffer = vi.fn(
    async (_buffer: Buffer, contentType?: string, _direction?: string, _maxBytes?: number) => ({
      id: `feishu-live-${Date.now()}.bin`,
      path: `/tmp/feishu-live-${Date.now()}.bin`,
      size: 1,
      contentType: contentType ?? "image/png",
    }),
  );

  beforeEach(() => {
    mockSaveMediaBuffer.mockClear();
    setFeishuRuntime(
      createPluginRuntimeMock({
        media: {
          detectMime: vi.fn(async () => "image/png"),
        },
        channel: {
          media: {
            saveMediaBuffer: mockSaveMediaBuffer,
          },
        },
      }),
    );
  });

  it("resolves inbound image message placeholders and downloads attachment", async () => {
    const cfg = createLiveConfig();
    const { imageKey } = await uploadImageFeishu({
      cfg,
      image: createTinyPng(),
    });

    const imageContent = JSON.stringify({ image_key: imageKey });
    const parsed = parseMessageContent(imageContent, "image");
    expect(parsed).toContain("<media:image>");

    const media = await resolveFeishuMediaList({
      cfg,
      messageId: "live-inbound-image-msg",
      messageType: "image",
      content: imageContent,
      maxBytes: 1024 * 1024,
    });

    expect(media).toHaveLength(1);
    expect(media[0]?.placeholder).toBe("<media:image>");
    expect(mockSaveMediaBuffer).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("resolves inbound post embedded image and downloads attachment", async () => {
    const cfg = createLiveConfig();
    const { imageKey } = await uploadImageFeishu({
      cfg,
      image: createTinyPng(),
    });

    const postContent = JSON.stringify({
      title: "Live post",
      content: [
        [
          {
            tag: "img",
            image_key: imageKey,
          },
        ],
      ],
    });
    const parsed = parseMessageContent(postContent, "post");
    expect(parsed).toContain("![image]");

    const media = await resolveFeishuMediaList({
      cfg,
      messageId: "live-inbound-post-msg",
      messageType: "post",
      content: postContent,
      maxBytes: 1024 * 1024,
    });

    expect(media).toHaveLength(1);
    expect(media[0]?.placeholder).toBe("<media:image>");
    expect(mockSaveMediaBuffer).toHaveBeenCalledTimes(1);
  }, 60_000);
});
