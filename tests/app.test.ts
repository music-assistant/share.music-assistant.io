// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { Storage } from "happy-dom";
import App from "@/App.vue";
import { decodeSharePayload, ShareLinkCompatibilityError } from "@/helpers/share";
import type { SharePayload } from "@/types";

vi.mock("@/helpers/share", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/share")>()),
  decodeSharePayload: vi.fn(),
}));

const decode = vi.mocked(decodeSharePayload);
const track: SharePayload = { type: "track", title: "Shared song" };
let wrapper: VueWrapper | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function changeHash(hash: string) {
  window.history.replaceState(null, "", `/#${hash}`);
  window.dispatchEvent(new Event("hashchange"));
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new Storage());
  localStorage.clear();
  window.history.replaceState(null, "", "/#1first");
  decode.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("share page", () => {
  it("labels the instance address, explains storage and includes the OHF footer", async () => {
    decode.mockResolvedValue(track);
    wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get('label[for="instance-url"]').text()).toContain(
      "your Music Assistant instance"
    );
    expect(wrapper.get("#instance-url").attributes("aria-describedby")).toBe("instance-url-hint");
    expect(wrapper.get("#instance-url-hint").text()).toBe(
      "This URL is only stored in your browser."
    );
    expect(wrapper.get("footer a").attributes("href")).toBe("https://www.openhomefoundation.org/");
    expect(wrapper.find("footer img").exists()).toBe(false);
  });

  it("keeps opening disabled until decoding succeeds, then opens the accepted fragment", async () => {
    const pending = deferred<SharePayload>();
    decode.mockReturnValue(pending.promise);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    wrapper = mount(App);
    expect(wrapper.get(".btn-open").attributes("disabled")).toBeDefined();
    await wrapper.get("#instance-url").trigger("keyup", { key: "Enter" });
    expect(open).not.toHaveBeenCalled();

    pending.resolve(track);
    await flushPromises();
    expect(wrapper.get(".btn-open").attributes("disabled")).toBeUndefined();
    await wrapper.get("#instance-url").setValue("https://ma.example/");
    await wrapper.get(".btn-open").trigger("click");
    expect(open).toHaveBeenCalledWith(
      "https://ma.example/#/share?payload=1first",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it.each([
    ["", "No share data found in URL."],
    ["1broken", "Could not decode share link. It may be corrupted."],
  ])("disables opening for missing or corrupt data (%s)", async (fragment, message) => {
    window.history.replaceState(null, "", `/#${fragment}`);
    decode.mockRejectedValue(new Error("Bad compressed input"));
    wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(message);
    expect(wrapper.get(".btn-open").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Share link unavailable");
  });

  it.each([
    "Unsupported share format version. Please create a new share link.",
    "Unsupported share payload: playlist share links are no longer supported.",
    "This browser does not support raw DEFLATE share links. Please use an up-to-date browser.",
  ])("shows an actionable compatibility error: %s", async (message) => {
    decode.mockRejectedValue(new ShareLinkCompatibilityError(message));
    wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(message);
    expect(wrapper.get(".btn-open").attributes("disabled")).toBeDefined();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an older decode that finishes with %s after the current link",
    async (outcome) => {
      const old = deferred<SharePayload>();
      decode.mockImplementation((raw) =>
        raw === "1first" ? old.promise : Promise.resolve({ ...track, title: "New song" })
      );
      wrapper = mount(App);
      changeHash("1second");
      await flushPromises();
      if (outcome === "resolve") old.resolve(track);
      else old.reject(new Error("Old failure"));
      await flushPromises();
      expect(wrapper.text()).toContain("New song");
      expect(wrapper.text()).not.toContain("Shared song");
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(document.title).toBe("New song – Music Assistant");
    }
  );

  it("rejects opening a changed fragment even before its hashchange event", async () => {
    decode.mockResolvedValue(track);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    wrapper = mount(App);
    await flushPromises();
    window.history.replaceState(null, "", "/#1different");
    await wrapper.get(".btn-open").trigger("click");
    expect(open).not.toHaveBeenCalled();
  });

  it("clears the previous preview while a replacement link is decoding", async () => {
    const pending = deferred<SharePayload>();
    decode.mockImplementation((raw) =>
      raw === "1first" ? Promise.resolve(track) : pending.promise
    );
    wrapper = mount(App);
    await flushPromises();
    changeHash("1second");
    await nextTick();
    expect(wrapper.text()).not.toContain("Shared song");
    expect(wrapper.get(".btn-open").attributes("disabled")).toBeDefined();
  });
});
