/**
 * Copies text to the system clipboard across platforms.
 *
 * Tries:
 * 1. Native Electron clipboard API (bypasses browser focus / Wayland sandbox constraints)
 * 2. Async Clipboard API (navigator.clipboard.writeText)
 * 3. Fallback DOM execCommand("copy")
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	if (!text) {
		return false;
	}

	// 1. Electron IPC / native clipboard
	if (typeof window !== "undefined") {
		const electronApi = (
			window as unknown as {
				electronAPI?: {
					writeClipboardText?: (
						text: string,
					) => Promise<{ success: boolean; error?: string }>;
				};
			}
		).electronAPI;

		if (typeof electronApi?.writeClipboardText === "function") {
			try {
				const result = await electronApi.writeClipboardText(text);
				if (result?.success) {
					return true;
				}
			} catch {
				// fall through to browser APIs
			}
		}
	}

	// 2. Standard navigator.clipboard
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// fall through to DOM execCommand fallback
		}
	}

	// 3. Fallback: DOM-based execCommand copy
	if (typeof document !== "undefined") {
		try {
			const textArea = document.createElement("textarea");
			textArea.value = text;
			textArea.style.position = "fixed";
			textArea.style.opacity = "0";
			textArea.style.left = "-9999px";
			textArea.style.top = "-9999px";
			textArea.setAttribute("readonly", "");
			document.body.appendChild(textArea);
			textArea.focus();
			textArea.select();
			const success = document.execCommand("copy");
			document.body.removeChild(textArea);
			if (success) {
				return true;
			}
		} catch {
			// all fallbacks exhausted
		}
	}

	return false;
}
