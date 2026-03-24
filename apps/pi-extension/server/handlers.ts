/**
 * Shared request handlers reused across plan, review, and annotate servers.
 * handleImageRequest, handleUploadRequest, handleDraftRequest, handleFavicon
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { saveDraft, loadDraft, deleteDraft } from "../draft.js";

import { json, parseBody, send, toWebRequest } from "./helpers";

type Res = import("node:http").ServerResponse;

const ALLOWED_IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"bmp",
	"ico",
	"tiff",
	"tif",
	"avif",
]);

const IMAGE_CONTENT_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	tiff: "image/tiff",
	tif: "image/tiff",
	avif: "image/avif",
};

const UPLOAD_DIR = join(tmpdir(), "plannotator");

function getExtension(filePath: string): string {
	const lastDot = filePath.lastIndexOf(".");
	if (lastDot === -1) return "";
	return filePath.slice(lastDot + 1).toLowerCase();
}

function validateImagePath(rawPath: string): {
	valid: boolean;
	resolved: string;
	error?: string;
} {
	const resolved = resolvePath(rawPath);
	const ext = getExtension(resolved);

	if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
		return {
			valid: false,
			resolved,
			error: "Path does not point to a supported image file",
		};
	}

	return { valid: true, resolved };
}

function validateUploadExtension(fileName: string): {
	valid: boolean;
	ext: string;
	error?: string;
} {
	const ext = getExtension(fileName) || "png";
	if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
		return {
			valid: false,
			ext,
			error: `File extension ".${ext}" is not a supported image type`,
		};
	}

	return { valid: true, ext };
}

function getImageContentType(filePath: string): string {
	return (
		IMAGE_CONTENT_TYPES[getExtension(filePath)] || "application/octet-stream"
	);
}

export function handleImageRequest(res: Res, url: URL): void {
	const imagePath = url.searchParams.get("path");
	if (!imagePath) {
		send(res, "Missing path parameter", 400, { "Content-Type": "text/plain" });
		return;
	}

	const tryServePath = (candidate: string): boolean => {
		const validation = validateImagePath(candidate);
		if (!validation.valid) return false;
		try {
			if (!existsSync(validation.resolved)) return false;
			const data = readFileSync(validation.resolved);
			send(res, data, 200, {
				"Content-Type": getImageContentType(validation.resolved),
			});
			return true;
		} catch {
			return false;
		}
	};

	if (tryServePath(imagePath)) return;

	const base = url.searchParams.get("base");
	if (
		base &&
		!imagePath.startsWith("/") &&
		tryServePath(resolvePath(base, imagePath))
	) {
		return;
	}

	const validation = validateImagePath(imagePath);
	if (!validation.valid) {
		send(res, validation.error || "Invalid image path", 403, {
			"Content-Type": "text/plain",
		});
		return;
	}

	send(res, "File not found", 404, { "Content-Type": "text/plain" });
}

export async function handleUploadRequest(
	req: IncomingMessage,
	res: Res,
): Promise<void> {
	try {
		const request = toWebRequest(req);
		const formData = await request.formData();
		const file = formData.get("file");
		if (
			!file ||
			typeof file !== "object" ||
			!("arrayBuffer" in file) ||
			!("name" in file)
		) {
			json(res, { error: "No file provided" }, 400);
			return;
		}

		const upload = file as File;
		const extResult = validateUploadExtension(upload.name);
		if (!extResult.valid) {
			json(res, { error: extResult.error }, 400);
			return;
		}

		mkdirSync(UPLOAD_DIR, { recursive: true });
		const tempPath = join(UPLOAD_DIR, `${randomUUID()}.${extResult.ext}`);
		const bytes = Buffer.from(await upload.arrayBuffer());
		writeFileSync(tempPath, bytes);
		json(res, { path: tempPath, originalName: upload.name });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Upload failed";
		json(res, { error: message }, 500);
	}
}

export function handleDraftRequest(
	req: IncomingMessage,
	res: Res,
	draftKey: string,
): Promise<void> | void {
	if (req.method === "POST") {
		return parseBody(req).then((body) => {
			saveDraft(draftKey, body);
			json(res, { ok: true });
		});
	} else if (req.method === "DELETE") {
		deleteDraft(draftKey);
		json(res, { ok: true });
	} else {
		const draft = loadDraft(draftKey);
		if (!draft) {
			json(res, { found: false }, 404);
			return;
		}
		json(res, draft);
	}
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#070b14"/>
  <rect x="12" y="28" width="40" height="14" rx="3" fill="#E0BA55" opacity="0.35"/>
  <text x="32" y="46" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="42" fill="white">P</text>
</svg>`;

export function handleFavicon(res: Res): void {
	send(res, FAVICON_SVG, 200, {
		"Content-Type": "image/svg+xml",
		"Cache-Control": "public, max-age=86400",
	});
}
