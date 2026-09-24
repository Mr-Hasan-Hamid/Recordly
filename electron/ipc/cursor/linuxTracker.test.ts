import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLinuxCursorSync, isLinuxWayland, startLinuxCursorTracker } from "./linuxTracker";

describe("linuxTracker", () => {
	const originalEnv = { ...process.env };
	const originalPlatform = process.platform;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	describe("isLinuxWayland", () => {
		it("returns false on darwin or win32", () => {
			Object.defineProperty(process, "platform", { value: "darwin" });
			process.env.WAYLAND_DISPLAY = "wayland-1";
			expect(isLinuxWayland()).toBe(false);

			Object.defineProperty(process, "platform", { value: "win32" });
			expect(isLinuxWayland()).toBe(false);
		});

		it("returns true on linux when WAYLAND_DISPLAY is set", () => {
			Object.defineProperty(process, "platform", { value: "linux" });
			process.env.WAYLAND_DISPLAY = "wayland-1";
			delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
			delete process.env.XDG_SESSION_TYPE;
			expect(isLinuxWayland()).toBe(true);
		});

		it("returns true on linux when HYPRLAND_INSTANCE_SIGNATURE is set", () => {
			Object.defineProperty(process, "platform", { value: "linux" });
			delete process.env.WAYLAND_DISPLAY;
			delete process.env.XDG_SESSION_TYPE;
			process.env.HYPRLAND_INSTANCE_SIGNATURE = "mock_signature";
			expect(isLinuxWayland()).toBe(true);
		});

		it("returns false on linux X11 session without Wayland indicators", () => {
			Object.defineProperty(process, "platform", { value: "linux" });
			delete process.env.WAYLAND_DISPLAY;
			delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
			process.env.XDG_SESSION_TYPE = "x11";
			expect(isLinuxWayland()).toBe(false);
		});
	});

	describe("startLinuxCursorTracker", () => {
		it("returns null on non-linux platforms", () => {
			Object.defineProperty(process, "platform", { value: "darwin" });
			const cleanup = startLinuxCursorTracker(vi.fn(), vi.fn());
			expect(cleanup).toBeNull();
		});

		it("returns a cleanup function on linux", () => {
			Object.defineProperty(process, "platform", { value: "linux" });
			const cleanup = startLinuxCursorTracker(vi.fn(), vi.fn());
			expect(typeof cleanup).toBe("function");
			cleanup?.();
		});
	});

	describe("getLinuxCursorSync", () => {
		it("returns null on non-linux platforms", () => {
			Object.defineProperty(process, "platform", { value: "win32" });
			expect(getLinuxCursorSync()).toBeNull();
		});
	});
});
