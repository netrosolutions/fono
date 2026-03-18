# ⬡ Fono

> Full-stack [Hono](https://hono.dev) framework — SSR, SPA, Vue-like reactivity, route groups, middleware and raw API routes in **3 files**.

[![npm](https://img.shields.io/npm/v/@mdakashdeveloper/fono?color=6b8cff&label=fono)](https://www.npmjs.com/package/@mdakashdeveloper/fono)
[![npm](https://img.shields.io/npm/v/@mdakashdeveloper/create-fono?color=3ecf8e&label=create-fono)](https://www.npmjs.com/package/@mdakashdeveloper/create-fono)
[![CI](https://github.com/@mdakashdeveloper/fono/actions/workflows/ci.yml/badge.svg)](https://github.com/@mdakashdeveloper/fono/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## Packages

| Package | Version | Description |
|---|---|---|
| [`fono`](./packages/fono) | [![npm](https://img.shields.io/npm/v/@mdakashdeveloper/fono)](https://npmjs.com/package/@mdakashdeveloper/fono) | The framework — core, server, client |
| [`create-fono`](./packages/create-fono) | [![npm](https://img.shields.io/npm/v/@mdakashdeveloper/create-fono)](https://npmjs.com/package/@mdakashdeveloper/create-fono) | Interactive project scaffolder |

---

## Quick start

```bash
npm create @mdakashdeveloper/fono@latest
# or
npx @mdakashdeveloper/create-fono my-app
# or
bunx @mdakashdeveloper/create-fono my-app
# or
pnpm create @mdakashdeveloper/fono my-app
```

The CLI will ask for your **runtime** (Node, Bun, Deno, Cloudflare Workers, or generic), **template** (minimal or full), and package manager — then scaffold a working app and install dependencies.

---

## Core concepts

```
fono/core    Reactivity engine + route/layout/middleware types
fono/server  Hono integration, SSR renderer, Vite plugin
fono/client  SPA boot, navigation, prefetch, hook patching
```

### `definePage` — unified route file

```tsx
// app/routes/post.tsx
import { definePage, ref, use } from 'fono/core'

const views = ref(0)   // module-level signal — survives SPA navigation

export default definePage({
  path: '/posts/[slug]',

  // Runs on the server — return value becomes Page props.
  // Zero-refetch: serialized into window.__FONO_STATE__ and read by client on boot.
  async loader(c) {
    const slug = c.req.param('slug')
    return { post: await db.findPost(slug) }
  },

  // Same JSX, two runtimes:
  // • Server → hono/jsx → renderToString()
  // • Client → hono/jsx/dom → render()
  Page({ post, params }) {
    const n = use(views)
    return (
      <article>
        <h1>{post.title}</h1>
        <p>Viewed {n} times this session</p>
        <button onClick={() => views.value++}>👁</button>
      </article>
    )
  },
})
```

### `defineGroup` — route composition with layout + middleware

```tsx
export const adminGroup = defineGroup({
  prefix: '/admin',
  layout: AdminLayout,                 // overrides app layout
  middleware: [requireAuth, auditLog], // applied to every route in group
  routes: [dashboard, users, settings],
})
```

### `defineApiRoute` — raw Hono routes

```tsx
export const api = defineApiRoute('/api', (app) => {
  app.get('/posts',    (c) => c.json(posts))
  app.post('/posts',   async (c) => { ... })
  app.route('/admin',  adminRpc)
})
```

### Vue-like reactivity

```ts
import { ref, reactive, computed, watch, watchEffect } from 'fono/core'

const count = ref(0)
const doubled = computed(() => count.value * 2)

watch(count, (n, prev) => console.log(prev, '→', n))
watchEffect(() => document.title = `Count: ${count.value}`)

count.value++  // triggers computed + watcher + effect
```

---

## Runtime support

| Runtime | How |
|---|---|
| **Node.js** | `serve()` → `@hono/node-server` |
| **Bun** | `serve()` → `Bun.serve()` |
| **Deno** | `serve()` → `Deno.serve()` |
| **Cloudflare Workers** | `export default { fetch: fono.handler }` |
| **Generic / WinterCG** | `export const handler = fono.handler` |

`serve()` auto-detects the runtime — no config needed.

---

## Monorepo structure

```
fono/
├── packages/
│   ├── fono/              # Framework package
│   │   ├── core.ts        # Reactivity + type definitions
│   │   ├── server.ts      # Hono app factory + SSR + Vite plugin
│   │   ├── client.ts      # SPA runtime + navigation + hook patching
│   │   └── package.json
│   └── create-fono/       # CLI scaffolder
│       ├── src/index.ts
│       └── package.json
├── .github/
│   └── workflows/
│       ├── ci.yml         # Typecheck + build on every PR
│       └── publish.yml    # Publish via Changesets on merge to main
└── .changeset/
    └── config.json
```

---

## Contributing

```bash
git clone https://github.com/@mdakashdeveloper/fono.git
cd fono
npm install       # install all workspaces
npm run build     # build fono + create-fono
npm run typecheck # run tsc --noEmit across all packages
```

### Creating a release

Fono uses [Changesets](https://github.com/changesets/changesets) for versioning:

```bash
npx changeset          # describe your change
npx changeset version  # bump versions and update changelogs
npx changeset publish  # publish to npm
```

Or push to `main` — the [Release workflow](./.github/workflows/publish.yml) will open a version PR automatically, then publish when merged.

---

## License

MIT — see [LICENSE](./LICENSE).
