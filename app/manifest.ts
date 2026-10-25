import type { MetadataRoute } from "next";

/** Web app manifest (fork addition, 2026-10-25): "Add to Home Screen"
 *  opens the app full screen with its own icon. iOS reads the
 *  apple-icon.png beside this file; the PNGs here serve Android/desktop. */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Learning Harness",
		short_name: "Learn",
		start_url: "/",
		display: "standalone",
		background_color: "#141414",
		theme_color: "#141414",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
	};
}
