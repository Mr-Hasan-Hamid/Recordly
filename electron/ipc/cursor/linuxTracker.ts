import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setLinuxCursorScreenPoint } from "../state";

export function isLinuxWayland(): boolean {
	if (process.platform !== "linux") return false;
	return Boolean(
		process.env.WAYLAND_DISPLAY ||
			process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland" ||
			process.env.HYPRLAND_INSTANCE_SIGNATURE,
	);
}

function getHyprlandSocketPath(): string | null {
	const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE;
	if (!sig) return null;
	const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
	const sockPath = path.join(runtimeDir, "hypr", sig, ".socket.sock");
	if (fs.existsSync(sockPath)) {
		return sockPath;
	}
	return null;
}

export function getLinuxCursorSync(): { x: number; y: number } | null {
	if (process.platform !== "linux") return null;
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
		try {
			const out = execFileSync("hyprctl", ["cursorpos"], {
				encoding: "utf8",
				timeout: 50,
				stdio: ["ignore", "pipe", "ignore"],
			});
			const parts = out.trim().split(",");
			if (parts.length === 2) {
				const x = parseFloat(parts[0]);
				const y = parseFloat(parts[1]);
				if (Number.isFinite(x) && Number.isFinite(y)) {
					const pt = { x, y, updatedAt: Date.now() };
					setLinuxCursorScreenPoint(pt);
					return { x, y };
				}
			}
		} catch {
			// ignore
		}
	}
	return null;
}

export function startLinuxCursorTracker(
	onMouseDown: (button: 1 | 2 | 3) => void,
	onMouseUp: () => void,
): (() => void) | null {
	if (process.platform !== "linux") {
		return null;
	}

	let active = true;
	const cleanups: (() => void)[] = [];

	// Fetch initial position immediately
	getLinuxCursorSync();

	// ── 1. Position tracking (Hyprland / Wayland IPC) ───────────────────────────
	const hyprSock = getHyprlandSocketPath();
	if (hyprSock) {
		let inFlight = false;
		let pollTimer: NodeJS.Timeout | null = null;
		let currentSocket: net.Socket | null = null;

		const pollHyprlandCursor = () => {
			if (!active) return;
			if (inFlight) {
				pollTimer = setTimeout(pollHyprlandCursor, 16);
				return;
			}
			inFlight = true;

			let buffer = "";
			const client = net.createConnection(hyprSock, () => {
				client.write("cursorpos");
			});
			currentSocket = client;
			client.setTimeout(150);

			client.on("data", (data) => {
				buffer += data.toString();
			});

			const handleClose = () => {
				if (buffer) {
					const parts = buffer.trim().split(",");
					if (parts.length === 2) {
						const x = parseFloat(parts[0]);
						const y = parseFloat(parts[1]);
						if (Number.isFinite(x) && Number.isFinite(y)) {
							setLinuxCursorScreenPoint({ x, y, updatedAt: Date.now() });
						}
					}
					buffer = "";
				}
				inFlight = false;
				currentSocket = null;
				if (active) {
					pollTimer = setTimeout(pollHyprlandCursor, 16);
				}
			};

			client.on("timeout", () => {
				client.destroy();
			});

			client.on("close", handleClose);

			client.on("error", () => {
				client.destroy();
			});
		};

		pollHyprlandCursor();
		cleanups.push(() => {
			active = false;
			if (pollTimer) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
			if (currentSocket) {
				currentSocket.destroy();
				currentSocket = null;
			}
		});
	}

	// ── 2. Click tracking via evdev (/dev/input/by-id/ or /dev/input/) ──────────
	try {
		const byIdDir = "/dev/input/by-id";
		let mouseDevices: string[] = [];

		if (fs.existsSync(byIdDir)) {
			mouseDevices = fs
				.readdirSync(byIdDir)
				.filter((name) => name.includes("event-mouse") || name.includes("touchpad"))
				.map((name) => path.join(byIdDir, name));
		}

		if (mouseDevices.length === 0 && fs.existsSync("/dev/input")) {
			mouseDevices = fs
				.readdirSync("/dev/input")
				.filter((name) => name.startsWith("event"))
				.map((name) => path.join("/dev/input", name));
		}

		for (const devPath of mouseDevices) {
			try {
				const stream = fs.createReadStream(devPath);
				stream.on("data", (chunk: Buffer) => {
					if (!active) return;
					// Linux 64-bit input_event is 24 bytes:
					// timeval (16 bytes), uint16 type (2), uint16 code (2), int32 value (4)
					for (let offset = 0; offset + 24 <= chunk.length; offset += 24) {
						const type = chunk.readUInt16LE(offset + 16);
						const code = chunk.readUInt16LE(offset + 18);
						const value = chunk.readInt32LE(offset + 20);

						// EV_KEY = 1
						if (type === 1) {
							// BTN_LEFT = 272 (0x110), BTN_RIGHT = 273 (0x111), BTN_MIDDLE = 274 (0x112)
							let button: 1 | 2 | 3 | null = null;
							if (code === 272) button = 1;
							else if (code === 273) button = 2;
							else if (code === 274) button = 3;

							if (button !== null) {
								if (value === 1) {
									onMouseDown(button);
								} else if (value === 0) {
									onMouseUp();
								}
							}
						}
					}
				});

				stream.on("error", () => {
					// Ignore read stream errors on individual device
				});

				cleanups.push(() => {
					try {
						stream.destroy();
					} catch {
						// ignore destroy errors
					}
				});
			} catch {
				// Device might not be readable, skip
			}
		}
	} catch {
		// Ignore /dev/input enumeration errors
	}

	return () => {
		active = false;
		for (const cleanup of cleanups) {
			try {
				cleanup();
			} catch {
				// ignore cleanup errors
			}
		}
	};
}
