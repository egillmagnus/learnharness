"use client";

/**
 * THE SOURCES PAGE (fork addition, 2026-10-24): course folders on the
 * left, the selected course's files on the right. Upload by button or by
 * dropping files on the list; files open in a new tab (PDFs, images,
 * text) or download. The agent reads the same folders, so a chat can say
 * "teach me chapter 2 of <course>". Server side: lib/sources-store.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileIcon, FolderIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SourceFile {
	path: string;
	size: number;
	modified: string;
}

interface Course {
	name: string;
	files: SourceFile[];
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function errorText(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string };
		return body.error ?? `HTTP ${response.status}`;
	} catch {
		return response.status === 413 ? "File too large (max 50 MB)." : `HTTP ${response.status}`;
	}
}

export function SourcesBrowser() {
	const [enabled, setEnabled] = useState(true);
	const [courses, setCourses] = useState<Course[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [newCourse, setNewCourse] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		const response = await fetch("/api/sources", { cache: "no-store" });
		if (!response.ok) {
			setError(await errorText(response));
			return;
		}
		const body = (await response.json()) as { enabled: boolean; courses: Course[] };
		setEnabled(body.enabled);
		setCourses(body.courses);
		setSelected((current) =>
			current && body.courses.some((c) => c.name === current) ? current : (body.courses[0]?.name ?? null),
		);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const run = async (label: string, action: () => Promise<void>) => {
		setBusy(label);
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
			await refresh();
		}
	};

	const post = async (course: string, files: File[] = []) => {
		const form = new FormData();
		form.append("course", course);
		for (const file of files) form.append("files", file);
		const response = await fetch("/api/sources", { method: "POST", body: form });
		if (!response.ok) throw new Error(await errorText(response));
		return (await response.json()) as { course: string; saved: string[] };
	};

	const createCourse = () =>
		run("Creating course…", async () => {
			const { course } = await post(newCourse);
			setNewCourse("");
			setSelected(course);
		});

	const upload = (files: File[]) => {
		if (!selected || files.length === 0) return;
		const course = selected;
		void run(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`, async () => {
			// One request per file: a single 50 MB request is the proxy's
			// limit, and one bad file shouldn't sink the rest.
			const failed: string[] = [];
			for (const file of files) {
				try {
					await post(course, [file]);
				} catch (e) {
					failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
			if (failed.length) throw new Error(failed.join("\n"));
		});
	};

	const remove = (course: string, file?: string) => {
		const what = file ? `"${file}"` : `the empty course "${course}"`;
		if (!window.confirm(`Delete ${what}?`)) return;
		const query = new URLSearchParams({ course, ...(file ? { path: file } : {}) });
		void run("Deleting…", async () => {
			const response = await fetch(`/api/sources?${query}`, { method: "DELETE" });
			if (!response.ok) throw new Error(await errorText(response));
		});
	};

	const current = courses?.find((c) => c.name === selected) ?? null;

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="font-title text-3xl tracking-tight">Sources</h1>
				<span className="text-xs text-muted-foreground max-md:hidden">
					Course material the teacher can read. In a chat, name the course and section.
				</span>
			</TopBar>

			{!enabled ? (
				<p className="p-6 text-sm text-muted-foreground">
					Sources are off on this server (LH_SOURCES_DIR is not set).
				</p>
			) : (
				<div className="flex min-h-0 flex-1 max-md:flex-col">
					{/* Courses */}
					<aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3 max-md:max-h-[40dvh] max-md:w-full max-md:border-b max-md:border-r-0">
						<span className="mb-1 text-xs uppercase tracking-widest text-muted-foreground/70">Courses</span>
						{courses?.map((course) => (
							<button
								key={course.name}
								type="button"
								onClick={() => setSelected(course.name)}
								className={cn(
									"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
									course.name === selected ? "bg-accent text-foreground" : "text-muted-foreground",
								)}
							>
								<FolderIcon className="size-3.5 shrink-0" />
								<span className="min-w-0 flex-1 truncate">{course.name}</span>
								<span className="text-xs text-muted-foreground/70">{course.files.length}</span>
							</button>
						))}
						{courses?.length === 0 && <p className="px-2 text-xs text-muted-foreground">No courses yet.</p>}
						<form
							className="mt-3 flex gap-1.5"
							onSubmit={(e) => {
								e.preventDefault();
								if (newCourse.trim()) void createCourse();
							}}
						>
							<Input
								value={newCourse}
								onChange={(e) => setNewCourse(e.target.value)}
								placeholder="New course"
								aria-label="New course name"
								className="h-8 text-sm"
							/>
							<Button type="submit" variant="outline" size="icon" className="size-8" aria-label="Create course" disabled={!newCourse.trim() || busy !== null}>
								<PlusIcon className="size-3.5" />
							</Button>
						</form>
					</aside>

					{/* Files */}
					<section
						className={cn("flex min-w-0 flex-1 flex-col overflow-y-auto p-4", dragging && "bg-accent/30")}
						onDragOver={(e) => {
							if (!current) return;
							e.preventDefault();
							setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={(e) => {
							e.preventDefault();
							setDragging(false);
							upload(Array.from(e.dataTransfer.files));
						}}
					>
						{current ? (
							<>
								<div className="mb-3 flex items-center gap-2">
									<h2 className="min-w-0 flex-1 truncate text-lg">{current.name}</h2>
									<input
										ref={fileInputRef}
										type="file"
										multiple
										className="hidden"
										onChange={(e) => {
											upload(Array.from(e.target.files ?? []));
											e.target.value = ""; // allow re-picking the same file
										}}
									/>
									<Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
										<UploadIcon className="size-3.5" />
										<span className="max-md:hidden">Upload files</span>
										<span className="md:hidden">Upload</span>
									</Button>
									{current.files.length === 0 && (
										<Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => remove(current.name)}>
											<Trash2Icon className="size-3.5" />
											Delete course
										</Button>
									)}
								</div>
								{busy && <p className="mb-2 text-xs text-muted-foreground">{busy}</p>}
								{error && (
									<p role="alert" className="mb-2 whitespace-pre-wrap text-xs text-red-400">
										{error}
									</p>
								)}
								{current.files.length === 0 ? (
									<div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10 text-sm text-muted-foreground">
										Drop course notes, slides or problem sets here (PDF, Markdown, text, images; max 50 MB each).
									</div>
								) : (
									<table className="w-full text-sm">
										<thead>
											<tr className="text-left text-xs uppercase tracking-wider text-muted-foreground/70">
												<th className="py-1.5 font-normal">Name</th>
												<th className="w-24 py-1.5 font-normal">Size</th>
												<th className="w-32 py-1.5 font-normal max-md:hidden">Added</th>
												<th className="w-10" />
											</tr>
										</thead>
										<tbody>
											{current.files.map((file) => (
												<tr key={file.path} className="border-t border-border/60">
													<td className="py-1.5 pr-3">
														<a
															href={`/api/sources/file?${new URLSearchParams({ course: current.name, path: file.path })}`}
															target="_blank"
															rel="noopener"
															className="flex items-center gap-2 hover:underline"
														>
															<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
															<span className="truncate">{file.path}</span>
														</a>
													</td>
													<td className="py-1.5 text-muted-foreground">{formatBytes(file.size)}</td>
													<td className="py-1.5 text-muted-foreground max-md:hidden">{new Date(file.modified).toLocaleDateString()}</td>
													<td className="py-1.5 text-right">
														<Button
															variant="ghost"
															size="icon"
															className="size-7"
															aria-label={`Delete ${file.path}`}
															disabled={busy !== null}
															onClick={() => remove(current.name, file.path)}
														>
															<Trash2Icon className="size-3.5" />
														</Button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</>
						) : (
							<>
								{error && (
									<p role="alert" className="mb-2 whitespace-pre-wrap text-xs text-red-400">
										{error}
									</p>
								)}
								<p className="text-sm text-muted-foreground">
									{courses === null ? "Loading…" : "Create a course on the left, then upload its notes."}
								</p>
							</>
						)}
					</section>
				</div>
			)}
		</div>
	);
}
