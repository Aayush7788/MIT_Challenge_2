# Project name

One sentence: who this is for and the job it does for them.

**Live demo:** add the Vercel link here
**Videos:** add the three video links here

## The problem

Two or three sentences about one specific user, what they do today, and what it costs them (time, money, mistakes).

## What it does

1. Step one of the main flow
2. Step two
3. What the user gets at the end

Add a screenshot of the main screen here.

## How it works

The browser calls a Next.js route handler, which calls the model (Claude or OpenAI, picked by environment variables) and streams the answer back. Prompts live on the server in `src/lib/prompts.ts`.

## Evaluation

I scored the app and a plain-model baseline on N cases from (describe the source) with `scripts/eval.mjs`.

| System | Passed | 95% CI |
| --- | --- | --- |
| Baseline (plain model) | x/N | a% to b% |
| This project | y/N | c% to d% |

On the cases where the two systems disagree, McNemar's exact test gives p = (value).

Describe how the cases were written and how answers were scored.

## Built during Hack-Nation 7 (Oct 3-4, 2026)

Before the event I set up a starter: the Next.js template, one streaming model route, a mock model server for offline UI work, and the eval script. Everything else in this repo was built during the event.

## Run it locally

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY or OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Without a key, `npm run dev:mock` serves an echo model so the UI still works.
To score a route: `npm run eval -- --url http://localhost:3000/api/llm --label baseline`.
Before pushing: `npm run check` (secret scan, lint, typecheck, build).

## Limitations

What works, what doesn't yet, and what was not tested.

## Author

Krishna Harish
