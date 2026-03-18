// ─────────────────────────────────────────────────────────────────────────────
//  Fono · client.ts
//  SPA runtime · hook patching · navigation · prefetch · lifecycle
// ─────────────────────────────────────────────────────────────────────────────

import { render } from 'hono/jsx/dom'
import { jsx } from 'hono/jsx'
import {
  useState, useEffect, useMemo, useRef as useHonoRef,
  useSyncExternalStore,
} from 'hono/jsx'
import {
  __hooks, ref, reactive, computed, watchEffect, isRef,
  SPA_HEADER, STATE_KEY, PARAMS_KEY,
  type Ref, type AppConfig, type ResolvedRoute,
  type LayoutDef,
} from './core'
import { resolveRoutes } from './core'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Patch reactivity hooks for hono/jsx/dom
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Connect a Ref (or computed getter) to the current JSX component.
 * Re-renders whenever the source changes.
 */
function clientUseValue<T>(source: Ref<T> | (() => T)): T {
  if (isRef(source)) {
    // Fast path: useSyncExternalStore is ideal for refs
    return useSyncExternalStore(
      (notify) => (source as any).subscribe(notify),
      () => (source as any).peek?.() ?? source.value,
    )
  }
  // Getter: wrap in a computed ref, then subscribe
  const c = useMemo(() => computed(source as () => T), [source])
  return useSyncExternalStore(
    (notify) => (c as any).subscribe(notify),
    () => (c as any).peek?.() ?? c.value,
  )
}

/**
 * Component-local Ref — stable across re-renders, lost on unmount.
 */
function clientUseLocalRef<T>(init: T): Ref<T> {
  // Create the ref once (stable ref object via hono's useRef)
  const stableRef = useHonoRef<Ref<T> | null>(null)
  if (stableRef.current === null) stableRef.current = ref(init)
  const r = stableRef.current!
  // Subscribe so mutations trigger re-render
  useSyncExternalStore(
    (notify) => (r as any).subscribe(notify),
    () => (r as any).peek?.() ?? r.value,
  )
  return r
}

/**
 * Component-local reactive object — deep proxy, re-renders on any mutation.
 */
function clientUseLocalReactive<T extends object>(init: T): T {
  const stableRef = useHonoRef<T | null>(null)
  if (stableRef.current === null) stableRef.current = reactive(init)
  const proxy = stableRef.current!

  // watchEffect to re-render whenever any tracked key changes
  const [tick, setTick] = useState(0)
  useEffect(() => {
    return watchEffect(() => {
      // Touch all keys to establish tracking
      JSON.stringify(proxy)
      // Schedule re-render (not on first run)
      setTick(t => t + 1)
    })
  }, [])

  return proxy
}

// Patch the module-level hook table
Object.assign(__hooks, {
  useValue: clientUseValue,
  useLocalRef: clientUseLocalRef,
  useLocalReactive: clientUseLocalReactive,
})

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  Path matching (mirrors server)
// ══════════════════════════════════════════════════════════════════════════════

interface CompiledRoute {
  route: ResolvedRoute
  re: RegExp
  keys: string[]
}

function compileRoute(r: ResolvedRoute): CompiledRoute {
  const keys: string[] = []
  const src = r.fullPath
    .replace(/\[\.\.\.([^\]]+)\]/g, (_: string, k: string) => { keys.push(k); return '(.*)' })
    .replace(/\[([^\]]+)\]/g, (_: string, k: string) => { keys.push(k); return '([^/]+)' })
    .replace(/\*/g, '(.*)')
  return { route: r, re: new RegExp(`^${src}$`), keys }
}

function matchRoute(compiled: CompiledRoute[], pathname: string) {
  for (const c of compiled) {
    const m = pathname.match(c.re)
    if (m) {
      const params: Record<string, string> = {}
      c.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
      return { route: c.route, params }
    }
  }
  return null
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  Navigation lifecycle hooks
// ══════════════════════════════════════════════════════════════════════════════

type NavListener = (url: string) => void | Promise<void>
const beforeNavListeners: NavListener[] = []
const afterNavListeners: NavListener[] = []

/** Called before each SPA navigation. Returning false cancels. */
export function onBeforeNavigate(fn: NavListener): () => void {
  beforeNavListeners.push(fn)
  return () => beforeNavListeners.splice(beforeNavListeners.indexOf(fn), 1)
}

/** Called after each SPA navigation (including initial boot). */
export function onAfterNavigate(fn: NavListener): () => void {
  afterNavListeners.push(fn)
  return () => afterNavListeners.splice(afterNavListeners.indexOf(fn), 1)
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  SPA navigation
// ══════════════════════════════════════════════════════════════════════════════

let compiled: CompiledRoute[] = []
let currentConfig: AppConfig
let currentLayout: LayoutDef | undefined
const prefetchCache = new Map<string, Promise<any>>()

function fetchPage(url: string): Promise<any> {
  if (!prefetchCache.has(url)) {
    prefetchCache.set(url, fetch(url, {
      headers: { [SPA_HEADER]: '1' }
    }).then(r => r.json()))
  }
  return prefetchCache.get(url)!
}

async function renderPage(
  route: ResolvedRoute,
  data: object,
  url: string,
  params: Record<string, string>
) {
  const container = document.getElementById('fono-app')!
  const pageNode = (jsx as any)(route.page.Page, { ...data, url, params })
  const layout = route.layout !== undefined ? route.layout : currentLayout
  const tree = layout
    ? (jsx as any)(layout.Component, { url, params, children: pageNode })
    : pageNode
  render(tree, container)
}

export interface NavigateOptions {
  replace?: boolean
  scroll?: boolean
}

export async function navigate(
  to: string,
  opts: NavigateOptions = {}
): Promise<void> {
  const u = new URL(to, location.origin)
  if (u.origin !== location.origin) { location.href = to; return }

  // Run before-nav hooks
  for (const fn of beforeNavListeners) await fn(u.pathname)

  const match = matchRoute(compiled, u.pathname)
  if (!match) { location.href = to; return }

  try {
    const payload = await fetchPage(u.toString())
    const method = opts.replace ? 'replaceState' : 'pushState'
    history[method]({ url: u.pathname }, '', u.pathname)
    if (opts.scroll !== false) window.scrollTo(0, 0)
    await renderPage(match.route, payload.state ?? {}, u.pathname, payload.params ?? {})
    // Cache state for popstate
    ;(window as any)[STATE_KEY] = {
      ...(window as any)[STATE_KEY],
      [u.pathname]: payload.state ?? {}
    }
    for (const fn of afterNavListeners) await fn(u.pathname)
  } catch (e) {
    console.error('[fono] Navigation failed:', e)
    location.href = to
  }
}

/** Warm the prefetch cache for a URL (call on hover / mousedown). */
export function prefetch(url: string): void {
  const u = new URL(url, location.origin)
  if (u.origin !== location.origin) return
  if (!matchRoute(compiled, u.pathname)) return
  fetchPage(u.toString())
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Click interceptor + popstate
// ══════════════════════════════════════════════════════════════════════════════

function interceptClicks(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.composedPath().find(
    (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement
  )
  if (!a?.href) return
  if (a.target && a.target !== '_self') return
  if (a.hasAttribute('data-no-spa') || a.rel?.includes('external')) return
  const u = new URL(a.href)
  if (u.origin !== location.origin) return
  e.preventDefault()
  navigate(a.href)
}

function interceptHover(e: MouseEvent) {
  const a = e.composedPath().find(
    (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement
  )
  if (a?.href) prefetch(a.href)
}

function onPopState() {
  navigate(location.href, { replace: true, scroll: false })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  boot()
// ══════════════════════════════════════════════════════════════════════════════

export interface BootOptions extends AppConfig {
  /**
   * Enable hover-based prefetching (default: true).
   * Fires a SPA fetch when the user hovers any <a> that matches a route.
   */
  prefetchOnHover?: boolean
}

export async function boot(options: BootOptions): Promise<void> {
  const { pages } = resolveRoutes(options.routes, {
    layout: options.layout,
    middleware: [],
  })

  compiled = pages.map(compileRoute)
  currentConfig = options
  currentLayout = options.layout

  const pathname = location.pathname
  const match = matchRoute(compiled, pathname)

  if (!match) {
    console.warn(`[fono] No route matched "${pathname}" — not hydrating`)
    return
  }

  // Read server-injected state (no refetch!)
  const stateMap: Record<string, object> = (window as any)[STATE_KEY] ?? {}
  const paramsMap: Record<string, string> = (window as any)[PARAMS_KEY] ?? {}
  const data = stateMap[pathname] ?? {}

  await renderPage(match.route, data, pathname, paramsMap)

  // Wire up navigation
  document.addEventListener('click', interceptClicks)
  if (options.prefetchOnHover !== false) {
    document.addEventListener('mouseover', interceptHover)
  }
  window.addEventListener('popstate', onPopState)

  for (const fn of afterNavListeners) await fn(pathname)
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  Re-export core for client code that imports only client.ts
// ══════════════════════════════════════════════════════════════════════════════
export {
  ref, shallowRef, reactive, shallowReactive, readonly,
  computed, effect, watch, watchEffect, effectScope,
  toRef, toRefs, unref, isRef, isReactive, isReadonly, markRaw, toRaw,
  triggerRef, use, useLocalRef, useLocalReactive,
  definePage, defineGroup, defineLayout, defineMiddleware, defineApiRoute,
} from './core'
export type {
  Ref, ComputedRef, WritableComputedRef,
  AppConfig, PageDef, GroupDef, LayoutDef, ApiRouteDef,
  WatchSource, WatchOptions,
} from './core'
