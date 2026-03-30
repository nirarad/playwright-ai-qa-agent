# Plan: Demo Web App (Next.js + Vercel Free Tier)

## Purpose

A deployable web app that serves as the test target for the QA AI agent. It must have realistic user flows, deliberate breakable UI states, and be fully controllable so you can demonstrate failures on demand during portfolio showcases.

**Deploy to:** Vercel (free tier — no credit card required for hobby projects)  
**Framework:** Next.js 14 (App Router)  
**Styling:** Tailwind CSS  
**State:** localStorage (no database required for free tier)

---

## What the App Is

A simple **Task Manager** with authentication. Three core flows that are realistic enough to justify automation, with enough complexity to produce meaningful test failures.

### Pages / Routes

| Route | Description |
|---|---|
| `/` | Landing page with "Get Started" CTA |
| `/login` | Login form (email + password) |
| `/register` | Register form |
| `/dashboard` | Protected: task list, add/complete/delete tasks |
| `/profile` | Protected: user profile, display name edit |

### Deliberate Breakable States

The app includes a **"Break Mode"** toggle in a dev panel (visible only in non-production env). When toggled, it simulates common real-world breakages:

| Break Mode | What changes | Expected test failure type |
|---|---|---|
| `selector-change` | Renames `data-testid` attributes | BROKEN_LOCATOR |
| `logic-bug` | "Add Task" button saves empty tasks | REAL_BUG |
| `slow-network` | Adds 3s delay to all form submissions | FLAKY |
| `auth-break` | Login always returns "Invalid credentials" | REAL_BUG |

This gives you on-demand control over what the agent detects.

---

## Vercel Feature Flags (Fixed or Probabilistic)

In addition to local `Break Mode`, support **Vercel-configured feature flags** that can:

- introduce **UI changes** (element/attribute changes → `BROKEN_LOCATOR`)
- introduce **app bugs** (logic failures → `REAL_BUG`)
- introduce **environment issues** (misconfig/network-like failures → `ENV_ISSUE`)

### Requirements

- **Fixed flags**: always on/off
- **Probabilistic flags**: activated with a `chance` percent (0–100)
- **Reproducible randomness for CI**: probabilistic evaluation must be controllable via a seed so Playwright runs are deterministic

### Recommended Configuration

Store a JSON config in a Vercel environment variable:

- `NEXT_PUBLIC_QA_FLAGS`: JSON string describing flags and how they trigger
- `NEXT_PUBLIC_QA_FLAGS_SEED_SOURCE`: how to seed randomness (recommended: request header)

Example `NEXT_PUBLIC_QA_FLAGS`:

```json
{
  "version": 1,
  "flags": [
    { "key": "ui.selectorChange", "type": "ui", "mode": "fixed", "enabled": false },
    { "key": "bug.emptyTaskSaves", "type": "bug", "mode": "chance", "chance": 25 },
    { "key": "env.misconfiguredApi", "type": "env", "mode": "fixed", "enabled": false }
  ]
}
```

Example `NEXT_PUBLIC_QA_FLAGS_SEED_SOURCE`:

- `header:x-qa-run-seed` (recommended for Playwright/CI)
- `query:seed` (useful for manual demos)

### How Flags Map to Failure Types

- **UI change flags**:
	- rename `data-testid` or change structure/labels to break locators predictably
	- expected classification: `BROKEN_LOCATOR`
- **Bug flags**:
	- corrupt business logic (e.g. allow empty task creation, auth always fails)
	- expected classification: `REAL_BUG`
- **Env issue flags**:
	- simulate missing required env/config (e.g. route handler refuses to run when a required env var is absent)
	- simulate non-actionable infra-like failure (e.g. server returns a 500 with a specific “misconfigured” marker)
	- expected classification: `ENV_ISSUE`

### Seeding Strategy (Deterministic “Chance”)

To keep `chance`-based behavior reproducible:

- Derive a random number from a **seed** + **flag key**
- Seed comes from `NEXT_PUBLIC_QA_FLAGS_SEED_SOURCE`:
	- Playwright sets a stable seed header (e.g. `x-qa-run-seed: <run-id>`)
	- manual demos can use a query param seed

This allows:

- **reproducible CI runs** (same seed → same outcomes)
- **controlled variability** (change seed to get different outcomes intentionally)

---

## Repo Structure

```
demo-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # Landing
│   ├── login/
│   │   └── page.tsx
│   ├── register/
│   │   └── page.tsx
│   ├── dashboard/
│   │   └── page.tsx
│   └── profile/
│       └── page.tsx
├── components/
│   ├── TaskList.tsx
│   ├── TaskItem.tsx
│   ├── AddTaskForm.tsx
│   ├── AuthForm.tsx
│   └── DevPanel.tsx               # Break Mode controls
├── lib/
│   ├── auth.ts                    # localStorage-based auth
│   ├── tasks.ts                   # localStorage-based task CRUD
│   └── breakMode.ts               # Break Mode state management
├── public/
├── tailwind.config.ts
├── next.config.ts
├── package.json
└── vercel.json
```

---

## Authentication (`lib/auth.ts`)

No backend. Users stored in localStorage. Sufficient for demo purposes.

```typescript
export interface User {
  id: string;
  email: string;
  password: string; // plaintext for demo — fine, no real data
  displayName: string;
}

const USERS_KEY = "demo_users";
const SESSION_KEY = "demo_session";

export function register(email: string, password: string, displayName: string): User {
  const users = getUsers();
  if (users.find((u) => u.email === email)) {
    throw new Error("Email already registered");
  }
  const user: User = { id: crypto.randomUUID(), email, password, displayName };
  localStorage.setItem(USERS_KEY, JSON.stringify([...users, user]));
  return user;
}

export function login(email: string, password: string): User {
  // Break mode: always fail
  if (getBreakMode() === "auth-break") {
    throw new Error("Invalid credentials");
  }

  const user = getUsers().find((u) => u.email === email && u.password === password);
  if (!user) throw new Error("Invalid credentials");

  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

export function getSession(): User | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function getUsers(): User[] {
  const raw = localStorage.getItem(USERS_KEY);
  return raw ? JSON.parse(raw) : [];
}
```

---

## Task CRUD (`lib/tasks.ts`)

```typescript
export interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  userId: string;
}

const TASKS_KEY = "demo_tasks";

export function getTasks(userId: string): Task[] {
  const all: Task[] = JSON.parse(localStorage.getItem(TASKS_KEY) ?? "[]");
  return all.filter((t) => t.userId === userId);
}

export function addTask(userId: string, title: string): Task {
  // Break mode: save empty task regardless of input
  const effectiveTitle = getBreakMode() === "logic-bug" ? "" : title;

  if (!effectiveTitle.trim()) throw new Error("Task title cannot be empty");

  const task: Task = {
    id: crypto.randomUUID(),
    title: effectiveTitle,
    completed: false,
    createdAt: new Date().toISOString(),
    userId,
  };

  const all: Task[] = JSON.parse(localStorage.getItem(TASKS_KEY) ?? "[]");
  localStorage.setItem(TASKS_KEY, JSON.stringify([...all, task]));
  return task;
}

export function toggleTask(taskId: string): void {
  const all: Task[] = JSON.parse(localStorage.getItem(TASKS_KEY) ?? "[]");
  const updated = all.map((t) =>
    t.id === taskId ? { ...t, completed: !t.completed } : t
  );
  localStorage.setItem(TASKS_KEY, JSON.stringify(updated));
}

export function deleteTask(taskId: string): void {
  const all: Task[] = JSON.parse(localStorage.getItem(TASKS_KEY) ?? "[]");
  localStorage.setItem(TASKS_KEY, JSON.stringify(all.filter((t) => t.id !== taskId)));
}
```

---

## Break Mode (`lib/breakMode.ts`)

```typescript
export type BreakMode =
  | "none"
  | "selector-change"
  | "logic-bug"
  | "slow-network"
  | "auth-break";

const BREAK_KEY = "demo_break_mode";

export function getBreakMode(): BreakMode {
  return (localStorage.getItem(BREAK_KEY) as BreakMode) ?? "none";
}

export function setBreakMode(mode: BreakMode): void {
  localStorage.setItem(BREAK_KEY, mode);
}
```

---

## Key Components with `data-testid` Attributes

All interactive elements need `data-testid` for Playwright targeting. When `selector-change` break mode is active, these attributes change.

### `AuthForm.tsx`

```tsx
"use client";
import { getBreakMode } from "@/lib/breakMode";

interface Props {
  mode: "login" | "register";
  onSubmit: (email: string, password: string, displayName?: string) => void;
  error?: string;
}

export function AuthForm({ mode, onSubmit, error }: Props) {
  const broken = typeof window !== "undefined" && getBreakMode() === "selector-change";

  return (
    <form>
      <input
        type="email"
        placeholder="Email"
        data-testid={broken ? "email-field-v2" : "email-input"}  // breaks when mode active
      />
      <input
        type="password"
        placeholder="Password"
        data-testid={broken ? "pwd-field-v2" : "password-input"}
      />
      {mode === "register" && (
        <input
          type="text"
          placeholder="Display name"
          data-testid="displayname-input"
        />
      )}
      <button
        type="submit"
        data-testid={broken ? "submit-btn-v2" : "submit-button"}
      >
        {mode === "login" ? "Sign In" : "Register"}
      </button>
      {error && <p data-testid="error-message">{error}</p>}
    </form>
  );
}
```

### `AddTaskForm.tsx`

```tsx
<input
  type="text"
  placeholder="Add a task..."
  data-testid="task-input"
  value={title}
  onChange={(e) => setTitle(e.target.value)}
/>
<button type="submit" data-testid="add-task-button">
  Add Task
</button>
```

### `TaskItem.tsx`

```tsx
<div data-testid={`task-item-${task.id}`}>
  <input
    type="checkbox"
    checked={task.completed}
    data-testid={`task-checkbox-${task.id}`}
    onChange={() => onToggle(task.id)}
  />
  <span data-testid={`task-title-${task.id}`}>{task.title}</span>
  <button data-testid={`task-delete-${task.id}`} onClick={() => onDelete(task.id)}>
    Delete
  </button>
</div>
```

---

## Dev Panel (`components/DevPanel.tsx`)

Visible only when `NODE_ENV !== "production"` — or controlled by a query param `?dev=true` so you can show it in prod for demos.

```tsx
"use client";
import { useState } from "react";
import { setBreakMode, getBreakMode, BreakMode } from "@/lib/breakMode";

const modes: { value: BreakMode; label: string; description: string }[] = [
  { value: "none", label: "Normal", description: "All tests should pass" },
  { value: "selector-change", label: "Break Selectors", description: "Renames data-testid → BROKEN_LOCATOR" },
  { value: "logic-bug", label: "Logic Bug", description: "Add Task saves empty titles → REAL_BUG" },
  { value: "slow-network", label: "Slow Network", description: "3s delays on forms → FLAKY" },
  { value: "auth-break", label: "Auth Break", description: "Login always fails → REAL_BUG" },
];

export function DevPanel() {
  const [current, setCurrent] = useState<BreakMode>(getBreakMode());

  const handleChange = (mode: BreakMode) => {
    setBreakMode(mode);
    setCurrent(mode);
    window.location.reload(); // reload so components pick up new mode
  };

  return (
    <div
      data-testid="dev-panel"
      className="fixed bottom-4 right-4 z-[9999] w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-950/95 p-4 text-sm text-slate-100 shadow-xl backdrop-blur"
    >
      <p className="mb-2 font-semibold text-amber-400">QA Dev Panel</p>
      {modes.map((m) => (
        <label
          key={m.value}
          className="mb-1 block cursor-pointer select-none"
        >
          <input
            type="radio"
            name="break-mode"
            value={m.value}
            checked={current === m.value}
            onChange={() => handleChange(m.value)}
            className="mr-2"
          />
          <strong>{m.label}</strong>
          <span className="ml-2 text-slate-400">{m.description}</span>
        </label>
      ))}
    </div>
  );
}
```

---

## Landing Page (`app/page.tsx`)

```tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-4xl font-bold text-gray-900 mb-4" data-testid="landing-heading">
        TaskFlow
      </h1>
      <p className="text-gray-500 mb-8">Simple task management, AI-tested.</p>
      <div className="flex gap-4">
        <Link href="/login">
          <button data-testid="login-link" className="px-6 py-2 bg-blue-600 text-white rounded-lg">
            Sign In
          </button>
        </Link>
        <Link href="/register">
          <button data-testid="register-link" className="px-6 py-2 border border-blue-600 text-blue-600 rounded-lg">
            Register
          </button>
        </Link>
      </div>
    </main>
  );
}
```

---

## Vercel Deployment

### `vercel.json`

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "outputDirectory": ".next"
}
```

### Deploy Steps

```bash
npm i -g vercel
vercel login
vercel --prod
```

Vercel auto-detects Next.js. No config needed beyond `vercel.json`.  
Free tier gives: custom domain, HTTPS, unlimited deployments, 100GB bandwidth/month.

### Environment Variable for Demo Mode

In Vercel dashboard: `Settings > Environment Variables`

Add:
```
NEXT_PUBLIC_DEMO_MODE=true
```

Use this to always show the Dev Panel in production for portfolio demos:

```tsx
// In layout.tsx
{process.env.NEXT_PUBLIC_DEMO_MODE === "true" && <DevPanel />}
```

---

## Seed Data for Testing

Add a seed script that pre-populates localStorage via a special route `/api/seed` (called by Playwright `beforeAll`):

```typescript
// app/api/seed/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  // Return seed data as JSON — Playwright will inject it into localStorage
  return NextResponse.json({
    demo_users: JSON.stringify([
      {
        id: "user-001",
        email: "test@example.com",
        password: "password123",
        displayName: "Test User",
      },
    ]),
    demo_tasks: JSON.stringify([]),
  });
}
```

In Playwright tests:
```typescript
const seed = await fetch(`${BASE_URL}/api/seed`, { method: "POST" });
const data = await seed.json();
await page.addInitScript((d) => {
  for (const [key, value] of Object.entries(d)) {
    localStorage.setItem(key, value as string);
  }
}, data);
```

---

## Summary: What This Gives You for the Portfolio

- A real deployed app (live URL to show employers)
- On-demand failure modes that map to exact agent classification categories
- Clean `data-testid` structure that mirrors production engineering standards
- Seed data pattern that makes tests deterministic
- Dev Panel that you can demo live: "watch me break the app and the agent catches it"
