import crypto from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ResolvedAgentRoute } from "openclaw/plugin-sdk/routing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginRuntimeMock } from "../../../test/helpers/plugins/plugin-runtime-mock.js";
import type { ClawdbotConfig } from "../runtime-api.js";
import { resolveFeishuRuntimeAccount } from "./accounts.js";
import { downloadMessageResourceFeishu } from "./media.js";
import { monitorSingleAccount } from "./monitor.account.js";
import { setFeishuRuntime } from "./runtime.js";

vi.mock("./media.js", async () => {
  const actual = await vi.importActual<typeof import("./media.js")>("./media.js");
  return {
    ...actual,
    downloadMessageResourceFeishu: vi.fn(
      async (params: { type: "image" | "file"; fileKey: string; messageId: string }) => {
        const isVideoLike = params.fileKey.includes("video");
        return {
          buffer: Buffer.from(isVideoLike ? "video-bytes" : "file-bytes"),
          contentType: isVideoLike ? "video/mp4" : "application/pdf",
          fileName: isVideoLike ? "clip.mp4" : "document.pdf",
        };
      },
    ),
  };
});

const FEISHU_APP_ID = process.env.FEISHU_APP_ID?.trim() ?? "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET?.trim() ?? "";
const FEISHU_VERIFICATION_TOKEN =
  process.env.FEISHU_VERIFICATION_TOKEN?.trim() ?? "live_verify_token";
const FEISHU_ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY?.trim() ?? "live_encrypt_key";
const FEISHU_DOMAIN = process.env.OPENCLAW_LIVE_FEISHU_DOMAIN?.trim() || "feishu";

const liveEnabled =
  process.env.OPENCLAW_LIVE_TEST === "1" &&
  FEISHU_APP_ID.length > 0 &&
  FEISHU_APP_SECRET.length > 0;
const describeLive = liveEnabled ? describe : describe.skip;

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("missing server address");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitUntilServerReady(url: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`server did not start: ${url}`);
}

function signFeishuPayload(params: {
  encryptKey: string;
  rawBody: string;
  timestamp?: string;
  nonce?: string;
}): Record<string, string> {
  const timestamp = params.timestamp ?? "1711111111";
  const nonce = params.nonce ?? "nonce-test";
  const signature = crypto
    .createHash("sha256")
    .update(timestamp + nonce + params.encryptKey + params.rawBody)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": nonce,
    "x-lark-signature": signature,
  };
}

function createWebhookLiveConfig(params: { port: number }): ClawdbotConfig {
  return {
    channels: {
      feishu: {
        enabled: true,
        connectionMode: "webhook",
        dmPolicy: "open",
        allowFrom: ["*"],
        resolveSenderNames: false,
        domain: FEISHU_DOMAIN,
        accounts: {
          live: {
            enabled: true,
            appId: FEISHU_APP_ID,
            appSecret: FEISHU_APP_SECRET,
            domain: FEISHU_DOMAIN,
            connectionMode: "webhook",
            webhookHost: "127.0.0.1",
            webhookPort: params.port,
            webhookPath: "/feishu/live-events",
            verificationToken: FEISHU_VERIFICATION_TOKEN,
            encryptKey: FEISHU_ENCRYPT_KEY,
            dmPolicy: "open",
            allowFrom: ["*"],
            requireMention: false,
            resolveSenderNames: false,
          },
        },
      },
    },
  } as ClawdbotConfig;
}

function buildRuntimeHarness() {
  const dispatchReplyFromConfigMock = vi.fn(async ({ ctx }: { ctx?: Record<string, unknown> }) => ({
    queuedFinal: false,
    counts: { tool: 0, block: 0, final: 0 },
    ctx,
  }));
  const saveMediaBufferMock = vi.fn(
    async (_buffer: Buffer, contentType?: string, _direction?: string, _maxBytes?: number) => ({
      id: `feishu-webhook-live-${Date.now()}.bin`,
      path: `/tmp/feishu-webhook-live-${Date.now()}.bin`,
      size: 1,
      contentType: contentType ?? "application/octet-stream",
    }),
  );
  const resolvedRoute: ResolvedAgentRoute = {
    agentId: "main",
    channel: "feishu",
    accountId: "default",
    sessionKey: "agent:main:feishu:dm:ou_live_sender",
    mainSessionKey: "agent:main:feishu:dm:ou_live_sender",
    lastRoutePolicy: "main",
    matchedBy: "default",
  };
  setFeishuRuntime(
    createPluginRuntimeMock({
      media: {
        detectMime: vi.fn(async () => "application/octet-stream"),
      },
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(() => resolvedRoute),
        },
        reply: {
          createReplyDispatcherWithTyping: vi.fn(() => ({
            dispatcher: {
              sendToolResult: vi.fn(() => false),
              sendBlockReply: vi.fn(() => false),
              sendFinalReply: vi.fn(() => true),
              waitForIdle: vi.fn(async () => {}),
              getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
              getFailedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
              markComplete: vi.fn(),
            },
            replyOptions: {},
            markDispatchIdle: vi.fn(),
            markRunComplete: vi.fn(),
          })),
          dispatchReplyFromConfig: dispatchReplyFromConfigMock,
        },
        media: {
          saveMediaBuffer: saveMediaBufferMock,
        },
      },
    }),
  );
  return { dispatchReplyFromConfigMock, saveMediaBufferMock };
}

async function runWebhookEventAndAssert(params: {
  messageType: "file" | "media";
  content: string;
  expectedPlaceholder: "<media:document>" | "<media:video>";
  expectedMimePart: "application/pdf" | "video/mp4";
}) {
  const port = await getFreePort();
  const cfg = createWebhookLiveConfig({ port });
  const account = resolveFeishuRuntimeAccount(
    { cfg, accountId: "live" },
    { requireEventSecrets: true },
  );
  const { dispatchReplyFromConfigMock, saveMediaBufferMock } = buildRuntimeHarness();

  const abortController = new AbortController();
  const runtime = {
    log: (...args: unknown[]) => console.log(...args),
    error: (...args: unknown[]) => console.error(...args),
    exit: () => {},
  };
  const monitorPromise = monitorSingleAccount({
    cfg,
    account,
    runtime,
    abortSignal: abortController.signal,
    botOpenIdSource: { kind: "prefetched", botOpenId: "ou_live_bot", botName: "OpenClaw" },
  });

  const url = `http://127.0.0.1:${port}/feishu/live-events`;
  await waitUntilServerReady(url);

  const payload = {
    schema: "2.0",
    header: {
      event_type: "im.message.receive_v1",
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_live_sender",
        },
        sender_type: "user",
      },
      message: {
        message_id: `msg_live_${Date.now()}`,
        chat_id: "oc-live-p2p",
        chat_type: "p2p",
        message_type: params.messageType,
        content: params.content,
      },
    },
  };
  const rawBody = JSON.stringify(payload);
  const response = await fetch(url, {
    method: "POST",
    headers: signFeishuPayload({ encryptKey: FEISHU_ENCRYPT_KEY, rawBody }),
    body: rawBody,
  });

  expect(response.status).toBe(200);

  await vi.waitFor(
    () => {
      expect(saveMediaBufferMock).toHaveBeenCalledTimes(1);
      expect(dispatchReplyFromConfigMock).toHaveBeenCalledTimes(1);
      expect(downloadMessageResourceFeishu).toHaveBeenCalledTimes(1);
    },
    { timeout: 20_000 },
  );

  const firstCall = dispatchReplyFromConfigMock.mock.calls[0]?.[0] as
    | { ctx?: Record<string, unknown> }
    | undefined;
  expect(firstCall?.ctx).toBeDefined();
  expect(firstCall?.ctx?.Body).toEqual(expect.stringContaining(params.expectedPlaceholder));
  expect(firstCall?.ctx?.MediaPath ?? firstCall?.ctx?.MediaPaths).toBeTruthy();
  expect(saveMediaBufferMock.mock.calls[0]?.[1]).toEqual(
    expect.stringContaining(params.expectedMimePart),
  );

  abortController.abort();
  await monitorPromise;
}

describeLive("feishu webhook to handleFeishuMessage file/video chain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("processes signed webhook file event through inbound media context", async () => {
    await runWebhookEventAndAssert({
      messageType: "file",
      content: JSON.stringify({
        file_key: "file_key_document_live",
        file_name: "document.pdf",
      }),
      expectedPlaceholder: "<media:document>",
      expectedMimePart: "application/pdf",
    });
  }, 90_000);

  it("processes signed webhook media(video) event through inbound media context", async () => {
    await runWebhookEventAndAssert({
      messageType: "media",
      content: JSON.stringify({
        file_key: "file_key_video_live",
        file_name: "clip.mp4",
      }),
      expectedPlaceholder: "<media:video>",
      expectedMimePart: "video/mp4",
    });
  }, 90_000);
});
