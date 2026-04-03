import { describe, expect, it } from "vitest";
import { parseMessageContent } from "./bot-content.js";

describe("parseMessageContent", () => {
  it("returns the standard image placeholder for image messages", () => {
    expect(parseMessageContent(JSON.stringify({ image_key: "img_v3_123" }), "image")).toBe(
      "<media:image>",
    );
  });

  it("returns the standard video placeholder for video and media messages", () => {
    const payload = JSON.stringify({
      file_key: "file_v3_video",
      image_key: "img_v3_thumb",
      file_name: "clip.mov",
    });

    expect(parseMessageContent(payload, "video")).toBe("<media:video>");
    expect(parseMessageContent(payload, "media")).toBe("<media:video>");
  });

  it("returns the standard document placeholder for file messages", () => {
    expect(
      parseMessageContent(
        JSON.stringify({ file_key: "file_v3_doc", file_name: "report.pdf" }),
        "file",
      ),
    ).toBe("<media:document>");
  });
});
