"use client";

import { useRef, useState } from "react";

type Status = "idle" | "running" | "done" | "error";

function fmt(ms: number | null): string {
  return ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    const text = prompt.trim();
    if (!text || status === "running") return;

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running");
    setOutput("");
    setError("");
    setMeta("");
    const started = performance.now();
    let firstTokenMs: number | null = null;

    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const label = `${res.headers.get("X-LLM-Provider")} · ${res.headers.get("X-LLM-Model")}`;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        firstTokenMs ??= performance.now() - started;
        const chunk = decoder.decode(value, { stream: true });
        setOutput((prev) => prev + chunk);
      }
      const rest = decoder.decode();
      if (rest) setOutput((prev) => prev + rest);

      setMeta(`${label} · first token ${fmt(firstTokenMs)} · total ${fmt(performance.now() - started)}`);
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) {
        setMeta("Stopped.");
        setStatus("done");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        {/* Rename: project name + one line on who it's for and what it does. */}
        <h1 className="text-3xl font-semibold tracking-tight">Project name</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          One sentence: who this is for and the job it does for them.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label htmlFor="prompt" className="text-sm font-medium">
          Input
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
          }}
          rows={5}
          placeholder="Ask something…"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-transparent p-3 text-base outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={status === "running" || !prompt.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {status === "running" ? "Running…" : "Run"}
          </button>
          {status === "running" && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              Stop
            </button>
          )}
          <span className="text-xs text-zinc-500">⌘/Ctrl + Enter</span>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {(output || status === "running") && (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium">Output</h2>
          <div className="min-h-12 whitespace-pre-wrap leading-7" aria-live="polite">
            {output || <span className="text-zinc-500">Waiting for the first token…</span>}
          </div>
          {meta && <p className="text-xs text-zinc-500">{meta}</p>}
        </section>
      )}
    </main>
  );
}
