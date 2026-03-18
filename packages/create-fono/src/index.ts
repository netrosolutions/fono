#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  create-fono · Interactive project scaffolding CLI
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync, cpSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import prompts from 'prompts'
import {
  bold, cyan, green, red, yellow, dim, magenta, reset,
} from 'kolorist'

// ── Types ─────────────────────────────────────────────────────────────────────

type Runtime  = 'node' | 'bun' | 'deno' | 'cloudflare' | 'generic'
type PkgMgr   = 'npm' | 'pnpm' | 'bun' | 'yarn' | 'deno'
type Template = 'minimal' | 'full'

interface Answers {
  projectName: string
  runtime: Runtime
  pkgManager: PkgMgr
  template: Template
  gitInit: boolean
  installDeps: boolean
}

// ── Banner ────────────────────────────────────────────────────────────────────

function banner() {
  console.log()
  console.log(bold(cyan('  ⬡  Fono')))
  console.log(dim('  Full-stack Hono framework — SSR + SPA + Reactivity'))
  console.log()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateName(name: string): string | true {
  if (!name.trim()) return 'Project name is required'
  if (!/^[a-z0-9@._/-]+$/i.test(name)) return 'Invalid project name'
  return true
}

function isEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true
  let items: string[] = []
  try { items = readdirSync(dir) as string[] } catch { return true }
  return items.length === 0 || (items.length === 1 && items[0] === '.git')
}

function write(filePath: string, content: string) {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  if (dir) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

// ── Runtime-specific files ────────────────────────────────────────────────────

function serverEntry(runtime: Runtime, pkg: string): string {
  const common = `import { createFono } from 'fono/server'
import { RootLayout } from './app/layouts'
import home from './app/routes/home'
import about from './app/routes/about'
import { apiRoutes } from './app/routes/api'

const fono = createFono({
  layout: RootLayout,
  routes: [apiRoutes, home, about],
})

// Access the raw Hono app for custom middleware / error handling
fono.app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})`

  if (runtime === 'node') {
    return `${common}

import { serve } from 'fono/server'
await serve({ app: fono, port: 3000 })
`
  }

  if (runtime === 'bun') {
    return `${common}

import { serve } from 'fono/server'
await serve({ app: fono, port: 3000, runtime: 'bun' })
`
  }

  if (runtime === 'deno') {
    return `${common}

import { serve } from 'fono/server'
await serve({ app: fono, port: 3000, runtime: 'deno' })
`
  }

  if (runtime === 'cloudflare') {
    return `${common}

// Cloudflare Workers: export the fetch handler
export default { fetch: fono.handler }
`
  }

  // generic
  return `${common}

// Export the fetch handler — works on any WinterCG-compatible runtime
export default { fetch: fono.handler }
export const handler = fono.handler
`
}

function clientEntry(): string {
  return `import { boot } from 'fono/client'
import { RootLayout } from './app/layouts'
import home from './app/routes/home'
import about from './app/routes/about'

boot({
  layout: RootLayout,
  prefetchOnHover: true,
  routes: [home, about],
})
`
}

function rootLayout(): string {
  return `import { defineLayout, use } from 'fono/core'
import { ref } from 'fono/core'

const menuOpen = ref(false)

export const RootLayout = defineLayout(function Layout({ children, url }) {
  const open = use(menuOpen)

  return (
    <div class="app">
      <nav class="nav">
        <a class="logo" href="/">⬡ Fono</a>
        <div class={\`nav-links \${open ? 'open' : ''}\`}>
          <a href="/" class={\`nav-link\${url === '/' ? ' active' : ''}\`}>Home</a>
          <a href="/about" class={\`nav-link\${url === '/about' ? ' active' : ''}\`}>About</a>
        </div>
        <button class="burger" onClick={() => (menuOpen.value = !open)}>
          {open ? '✕' : '☰'}
        </button>
      </nav>
      <main class="main">{children}</main>
      <footer class="footer">Built with ⬡ Fono</footer>
    </div>
  )
})
`
}

function homeRoute(): string {
  return `import { definePage } from 'fono/core'

export default definePage({
  path: '/',
  loader: () => ({ message: 'Hello from Fono!' }),
  Page({ message }) {
    return (
      <div class="page">
        <h1>⬡ Fono</h1>
        <p>{message}</p>
        <p>
          Edit <code>app/routes/home.tsx</code> and save to see changes.
        </p>
        <a href="/about">About →</a>
      </div>
    )
  },
})
`
}

function aboutRoute(): string {
  return `import { definePage } from 'fono/core'

export default definePage({
  path: '/about',
  loader: () => ({ version: '0.1.0' }),
  Page({ version }) {
    return (
      <div class="page">
        <h1>About</h1>
        <p>Fono v{version} — SSR + SPA + Vue-like reactivity on Hono.</p>
        <a href="/">← Home</a>
      </div>
    )
  },
})
`
}

function apiRoute(): string {
  return `import { defineApiRoute } from 'fono/core'

export const apiRoutes = defineApiRoute('/api', (app) => {
  app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

  app.get('/hello', (c) => {
    const name = c.req.query('name') ?? 'world'
    return c.json({ message: \`Hello, \${name}!\` })
  })
})
`
}

function appCss(): string {
  return `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0d0f14; color: #e8eaf2; line-height: 1.6; }
.app { display: flex; flex-direction: column; min-height: 100vh; }
.nav { display: flex; align-items: center; gap: 1rem; padding: 0 1.5rem; height: 52px; background: #151820; border-bottom: 1px solid #2a2f3d; }
.logo { font-weight: 700; color: #e8eaf2; text-decoration: none; }
.nav-links { display: flex; gap: .25rem; flex: 1; }
.nav-link { padding: .35rem .75rem; border-radius: 6px; color: #7b829a; text-decoration: none; }
.nav-link:hover, .nav-link.active { color: #e8eaf2; background: #1d2130; }
.burger { display: none; background: none; border: none; color: #e8eaf2; font-size: 1.1rem; cursor: pointer; }
.main { flex: 1; max-width: 800px; width: 100%; margin: 0 auto; padding: 3rem 1.5rem; }
.footer { text-align: center; padding: 1rem; color: #7b829a; font-size: .8rem; border-top: 1px solid #2a2f3d; }
.page h1 { font-size: 2rem; font-weight: 700; margin-bottom: 1rem; }
.page a { color: #6b8cff; }
code { background: #1d2130; padding: .1rem .4rem; border-radius: 4px; font-family: monospace; font-size: .9em; }
`
}

function viteConfig(runtime: Runtime): string {
  const isEdge = runtime === 'cloudflare' || runtime === 'generic'

  if (isEdge) {
    return `import { fonoVitePlugin } from 'fono/vite'

export default {
  plugins: [
    fonoVitePlugin({
      serverEntry: 'server.ts',
      clientEntry:  'client.ts',
      serverExternal: [],
    }),
  ],
}
`
  }

  return `import { fonoVitePlugin } from 'fono/vite'

export default {
  plugins: [
    fonoVitePlugin({
      serverEntry: 'server.ts',
      clientEntry:  'client.ts',
    }),
  ],
}
`
}

function packageJson(name: string, runtime: Runtime): string {
  const scripts: Record<string, string> = {
    build: 'vite build',
    start: 'node dist/server/server.js',
    typecheck: 'tsc --noEmit',
  }

  if (runtime === 'bun') {
    scripts.start = 'bun dist/server/server.js'
    scripts.dev = 'bun --watch dist/server/server.js'
  } else if (runtime === 'deno') {
    scripts.start = 'deno run -A dist/server/server.js'
    scripts.dev = 'deno run --watch -A dist/server/server.js'
  } else if (runtime === 'cloudflare') {
    scripts.start = 'wrangler dev'
    scripts.deploy = 'wrangler deploy'
    delete scripts.start
  } else {
    scripts.dev = 'node --watch dist/server/server.js'
  }

  const deps: Record<string, string> = { fono: '^0.1.0', hono: '^4.12.0' }

  const devDeps: Record<string, string> = {
    vite: '^6.0.0',
    typescript: '^5.8.0',
  }

  if (runtime === 'node') devDeps['@hono/node-server'] = '^1.14.0'
  if (runtime === 'cloudflare') devDeps['wrangler'] = '^3.0.0'

  return JSON.stringify({
    name,
    version: '0.0.1',
    type: 'module',
    private: true,
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
  }, null, 2) + '\n'
}

function tsconfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM'],
      jsx: 'react-jsx',
      jsxImportSource: 'hono/jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'dist'],
  }, null, 2) + '\n'
}

function gitignore(): string {
  return `node_modules
dist
.env
.env.local
*.local
.DS_Store
Thumbs.db
`
}

function envExample(): string {
  return `# Copy this to .env and fill in your values
PORT=3000
NODE_ENV=development
`
}

function denoJson(name: string): string {
  return JSON.stringify({
    name,
    version: '0.0.1',
    tasks: {
      build: 'vite build',
      start: 'deno run -A dist/server/server.js',
      dev: 'deno run --watch -A dist/server/server.js',
    },
    imports: {
      fono: 'npm:fono@^0.1.0',
      hono: 'npm:hono@^4.12.0',
    },
  }, null, 2) + '\n'
}

function wranglerToml(name: string): string {
  return `name = "${name}"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
main = "dist/server/server.js"

[build]
command = "npm run build"

[[rules]]
type = "ESModule"
globs = ["**/*.js"]
`
}

// ── Scaffold ──────────────────────────────────────────────────────────────────

function scaffold(dir: string, answers: Answers) {
  const { runtime, template } = answers

  // Directory structure
  mkdirSync(join(dir, 'app/routes'), { recursive: true })
  mkdirSync(join(dir, 'app/components'), { recursive: true })
  mkdirSync(join(dir, 'public'), { recursive: true })

  // Root files
  write(join(dir, 'package.json'),   packageJson(answers.projectName, runtime))
  write(join(dir, 'tsconfig.json'),  tsconfig())
  write(join(dir, 'vite.config.ts'), viteConfig(runtime))
  write(join(dir, '.gitignore'),     gitignore())
  write(join(dir, '.env.example'),   envExample())
  write(join(dir, 'server.ts'),      serverEntry(runtime, answers.projectName))
  write(join(dir, 'client.ts'),      clientEntry())

  // Runtime-specific
  if (runtime === 'deno') {
    write(join(dir, 'deno.json'), denoJson(answers.projectName))
  }
  if (runtime === 'cloudflare') {
    write(join(dir, 'wrangler.toml'), wranglerToml(answers.projectName))
  }

  // App files
  write(join(dir, 'app/layouts.tsx'),      rootLayout())
  write(join(dir, 'app/routes/home.tsx'),  homeRoute())
  write(join(dir, 'app/routes/about.tsx'), aboutRoute())
  write(join(dir, 'app/routes/api.ts'),    apiRoute())
  write(join(dir, 'public/style.css'),     appCss())

  // Full template — extra demo pages
  if (template === 'full') {
    write(join(dir, 'app/store.ts'), storeFile())
    write(join(dir, 'app/routes/counter.tsx'), counterRoute())
    write(join(dir, 'app/routes/posts/index.tsx'), postsIndexRoute())
    write(join(dir, 'app/routes/posts/[slug].tsx'), postDetailRoute())
  }

  // README
  write(join(dir, 'README.md'), projectReadme(answers))
}

// ── Extra full-template files ─────────────────────────────────────────────────

function storeFile(): string {
  return `import { ref, reactive, computed } from 'fono/core'

export const theme = ref<'dark' | 'light'>('dark')
export const toggleTheme = () => { theme.value = theme.value === 'dark' ? 'light' : 'dark' }

export const cart = reactive<{ items: { id: string; name: string; qty: number; price: number }[] }>({ items: [] })
export const cartCount = computed(() => cart.items.reduce((s, i) => s + i.qty, 0))
`
}

function counterRoute(): string {
  return `import { definePage, ref, computed, use } from 'fono/core'

const count = ref(0)
const doubled = computed(() => count.value * 2)

export default definePage({
  path: '/counter',
  loader: () => ({}),
  Page() {
    const n = use(count)
    const d = use(doubled)
    return (
      <div class="page">
        <h1>Counter — {n}</h1>
        <p>Doubled: {d}</p>
        <p>
          <button onClick={() => count.value--}>−</button>
          {' '}
          <button onClick={() => count.value++}>+</button>
          {' '}
          <button onClick={() => (count.value = 0)}>reset</button>
        </p>
        <p>Navigate away and back — the count persists.</p>
      </div>
    )
  },
})
`
}

function postsIndexRoute(): string {
  return `import { definePage } from 'fono/core'

const POSTS = [
  { slug: 'hello-fono', title: 'Hello Fono', date: '2025-01-01' },
  { slug: 'signals', title: 'How signals work', date: '2025-01-08' },
]

export default definePage({
  path: '/posts',
  loader: async () => ({ posts: POSTS }),
  Page({ posts }) {
    return (
      <div class="page">
        <h1>Posts</h1>
        <ul>
          {posts.map(p => (
            <li key={p.slug}>
              <a href={\`/posts/\${p.slug}\`}>{p.title}</a>
              <span> — {p.date}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  },
})
`
}

function postDetailRoute(): string {
  return `import { definePage } from 'fono/core'

const POSTS: Record<string, { title: string; body: string }> = {
  'hello-fono': { title: 'Hello Fono', body: 'Fono is a full-stack framework built on Hono.' },
  'signals': { title: 'How signals work', body: 'Signals are reactive values that notify subscribers on change.' },
}

export default definePage<{ post: { title: string; body: string } | null }>({
  path: '/posts/[slug]',
  loader: (c) => {
    const slug = (c.req as any).param('slug')
    return { post: POSTS[slug] ?? null }
  },
  Page({ post }) {
    if (!post) return <div class="page"><h1>Not found</h1><a href="/posts">← Posts</a></div>
    return (
      <article class="page">
        <a href="/posts">← Posts</a>
        <h1>{post.title}</h1>
        <p>{post.body}</p>
      </article>
    )
  },
})
`
}

function projectReadme(a: Answers): string {
  const install: Record<PkgMgr, string> = {
    npm: 'npm install',
    pnpm: 'pnpm install',
    bun: 'bun install',
    yarn: 'yarn',
    deno: 'deno install',
  }
  const build: Record<PkgMgr, string> = {
    npm: 'npm run build',
    pnpm: 'pnpm build',
    bun: 'bun run build',
    yarn: 'yarn build',
    deno: 'deno task build',
  }
  const start: Record<PkgMgr, string> = {
    npm: 'npm start',
    pnpm: 'pnpm start',
    bun: 'bun start',
    yarn: 'yarn start',
    deno: 'deno task start',
  }

  return `# ${a.projectName}

A [Fono](https://github.com/your-org/fono) app — SSR + SPA, Vue-like reactivity, built on [Hono](https://hono.dev).

## Setup

\`\`\`bash
${install[a.pkgManager]}
${build[a.pkgManager]}
${start[a.pkgManager]}
\`\`\`

## Structure

\`\`\`
server.ts          # Server entry — createFono() + serve()
client.ts          # Client entry — boot()
app/
  layouts.tsx      # Root layout (nav, footer)
  routes/
    home.tsx       # GET /
    about.tsx      # GET /about
    api.ts         # GET /api/health, GET /api/hello
\`\`\`

## Fono features used

- \`definePage\` — route + SSR loader + Page component in one file
- \`defineLayout\` — shared nav/footer wrapper
- \`defineApiRoute\` — raw Hono routes at /api
- \`ref\` / \`use\` — reactive state that survives SPA navigation

## Runtime: ${a.runtime}

Learn more at [github.com/your-org/fono](https://github.com/your-org/fono).
`
}

// ── Install deps ──────────────────────────────────────────────────────────────

function installCmds(mgr: PkgMgr, dir: string): void {
  const cmd: Record<PkgMgr, string> = {
    npm: 'npm install',
    pnpm: 'pnpm install',
    bun: 'bun install',
    yarn: 'yarn',
    deno: 'deno install',
  }
  execSync(cmd[mgr], { cwd: dir, stdio: 'inherit' })
}

function initGit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'inherit' })
  execSync('git add -A', { cwd: dir, stdio: 'inherit' })
  execSync('git commit -m "chore: initial fono scaffold"', { cwd: dir, stdio: 'inherit' })
}

// ── Next steps text ───────────────────────────────────────────────────────────

function nextSteps(dir: string, answers: Answers): string {
  const isCurrentDir = dir === '.'
  const cmds: Record<PkgMgr, { build: string; start: string }> = {
    npm:  { build: 'npm run build', start: 'npm start' },
    pnpm: { build: 'pnpm build',    start: 'pnpm start' },
    bun:  { build: 'bun run build', start: 'bun start' },
    yarn: { build: 'yarn build',    start: 'yarn start' },
    deno: { build: 'deno task build', start: 'deno task start' },
  }

  const { build, start } = cmds[answers.pkgManager]
  const lines: string[] = ['']
  if (!isCurrentDir) lines.push(`  ${cyan('cd')} ${answers.projectName}`)
  if (!answers.installDeps) lines.push(`  ${cyan(build.split(' ')[0])} install`)
  lines.push(`  ${cyan(build)}`)
  lines.push(`  ${cyan(start)}`)
  lines.push('')
  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner()

  const argv = process.argv.slice(2)
  const argName = argv.find(a => !a.startsWith('--'))

  let cancelled = false

  const answers = await prompts(
    [
      {
        type: 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: argName ?? 'my-fono-app',
        validate: validateName,
      },
      {
        type: (prev: string) => {
          const dir = resolve(process.cwd(), prev)
          if (existsSync(dir) && !isEmpty(dir)) return 'confirm'
          return null as any
        },
        name: 'overwrite',
        message: (prev: string) =>
          `${yellow('!')} "${prev}" already exists and is not empty. Overwrite?`,
        initial: false,
      },
      {
        type: (_: any, values: any) => {
          if (values.overwrite === false) {
            cancelled = true
            return null as any
          }
          return null as any
        },
        name: '_guard',
        message: '',
      },
      {
        type: 'select',
        name: 'runtime',
        message: 'Target runtime:',
        choices: [
          { title: `${green('Node.js')}  ${dim('(recommended, @hono/node-server)')}`, value: 'node' },
          { title: `${magenta('Bun')}      ${dim('(fast startup, built-in serve)')}`, value: 'bun' },
          { title: `${cyan('Deno')}     ${dim('(Deno.serve, permissions)')}`, value: 'deno' },
          { title: `${yellow('Cloudflare Workers')} ${dim('(edge, wrangler)')}`, value: 'cloudflare' },
          { title: `${dim('Generic')}  ${dim('(export handler, WinterCG)')}`, value: 'generic' },
        ],
      },
      {
        type: 'select',
        name: 'template',
        message: 'Template:',
        choices: [
          { title: `${green('Minimal')}  ${dim('Home + About + /api health')}`, value: 'minimal' },
          { title: `${cyan('Full')}     ${dim('+ Counter (signals) + Posts [slug] + store')}`, value: 'full' },
        ],
      },
      {
        type: 'select',
        name: 'pkgManager',
        message: 'Package manager:',
        choices: (_, values: Partial<Answers>) => {
          const base = [
            { title: 'npm',  value: 'npm' },
            { title: 'pnpm', value: 'pnpm' },
            { title: 'yarn', value: 'yarn' },
          ]
          if (values.runtime === 'bun')  return [{ title: 'bun', value: 'bun' }, ...base]
          if (values.runtime === 'deno') return [{ title: 'deno', value: 'deno' }, ...base]
          return base
        },
      },
      {
        type: 'confirm',
        name: 'installDeps',
        message: 'Install dependencies now?',
        initial: true,
      },
      {
        type: 'confirm',
        name: 'gitInit',
        message: 'Initialize a git repository?',
        initial: true,
      },
    ],
    {
      onCancel() { cancelled = true },
    }
  )

  if (cancelled) {
    console.log(red('\nCancelled.\n'))
    process.exit(1)
  }

  const projectDir = resolve(process.cwd(), answers.projectName)
  mkdirSync(projectDir, { recursive: true })

  console.log()
  console.log(`  Scaffolding ${bold(cyan(answers.projectName))}…`)
  console.log()

  scaffold(projectDir, answers as Answers)

  if (answers.installDeps) {
    console.log(`  Installing dependencies with ${bold(answers.pkgManager)}…\n`)
    try {
      installCmds(answers.pkgManager as PkgMgr, projectDir)
    } catch {
      console.log(yellow('\n  Dependency install failed. Run it manually.\n'))
    }
  }

  if (answers.gitInit) {
    try { initGit(projectDir) } catch { /* git may not be installed */ }
  }

  console.log()
  console.log(green('  Done! 🎉'))
  console.log()
  console.log('  Next steps:')
  console.log(nextSteps(answers.projectName, answers as Answers))
  console.log(`  Docs: ${cyan('https://github.com/your-org/fono')}`)
  console.log()
}

main().catch((e) => {
  console.error(red(e.message))
  process.exit(1)
})
