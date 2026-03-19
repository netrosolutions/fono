// ─────────────────────────────────────────────────────────────────────────────
//  FNetro · client.ts
//  SolidJS hydration · SPA routing · client middleware · SEO sync · prefetch
// ─────────────────────────────────────────────────────────────────────────────

import { createSignal, createMemo, createComponent } from 'solid-js'
import { hydrate } from 'solid-js/web'
import {
  resolveRoutes, compilePath, matchPath,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY,
  type AppConfig, type ResolvedRoute, type CompiledPath,
  type LayoutDef, type SEOMeta, type ClientMiddleware,
} from './core'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Compiled route cache (module-level, populated on boot)
// ══════════════════════════════════════════════════════════════════════════════

interface CRoute { route: ResolvedRoute; cp: CompiledPath }

let _routes:    CRoute[]          = []
let _appLayout: LayoutDef | undefined

function findRoute(pathname: string) {
  for (const { route, cp } of _routes) {
    const params = matchPath(cp, pathname)
    if (params !== null) return { route, params }
  }
  return null
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  Navigation state signal
// ══════════════════════════════════════════════════════════════════════════════

interface NavState {
  path:   string
  data:   Record<string, unknown>
  params: Record<string, string>
}

// Populated by createAppRoot(); exposed so navigate() can update it.
let _setNav: ((s: NavState) => void) | null = null

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  Client middleware
// ══════════════════════════════════════════════════════════════════════════════

const _mw: ClientMiddleware[] = []

/**
 * Register a client-side navigation middleware.
 * Must be called **before** `boot()`.
 *
 * @example
 * useClientMiddleware(async (url, next) => {
 *   if (!isLoggedIn() && url.startsWith('/dashboard')) {
 *     await navigate('/login')
 *     return                   // cancel original navigation
 *   }
 *   await next()
 * })
 */
export function useClientMiddleware(mw: ClientMiddleware): void {
  _mw.push(mw)
}

async function runMiddleware(url: string, done: () => Promise<void>): Promise<void> {
  const chain = [..._mw, async (_u: string, next: () => Promise<void>) => { await done(); await next() }]
  let i = 0
  const run = async (): Promise<void> => {
    const fn = chain[i++]
    if (fn) await fn(url, run)
  }
  await run()
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  SEO — client-side <head> sync
// ══════════════════════════════════════════════════════════════════════════════

function setMeta(selector: string, attr: string, val: string | undefined): void {
  if (!val) { document.querySelector(selector)?.remove(); return }
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    const m = /\[(\w+[:-]?\w*)="([^"]+)"\]/.exec(selector)
    if (m) el.setAttribute(m[1], m[2])
    document.head.appendChild(el)
  }
  el.setAttribute(attr, val)
}

function syncSEO(seo: SEOMeta): void {
  if (seo.title) document.title = seo.title

  setMeta('[name="description"]',        'content', seo.description)
  setMeta('[name="keywords"]',           'content', seo.keywords)
  setMeta('[name="robots"]',             'content', seo.robots)
  setMeta('[name="theme-color"]',        'content', seo.themeColor)
  setMeta('[property="og:title"]',       'content', seo.ogTitle)
  setMeta('[property="og:description"]', 'content', seo.ogDescription)
  setMeta('[property="og:image"]',       'content', seo.ogImage)
  setMeta('[property="og:url"]',         'content', seo.ogUrl)
  setMeta('[property="og:type"]',        'content', seo.ogType)
  setMeta('[name="twitter:card"]',       'content', seo.twitterCard)
  setMeta('[name="twitter:title"]',      'content', seo.twitterTitle)
  setMeta('[name="twitter:description"]','content', seo.twitterDescription)
  setMeta('[name="twitter:image"]',      'content', seo.twitterImage)

  // Canonical link
  const canon = seo.canonical
  let linkEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (canon) {
    if (!linkEl) {
      linkEl = document.createElement('link')
      linkEl.rel = 'canonical'
      document.head.appendChild(linkEl)
    }
    linkEl.href = canon
  } else {
    linkEl?.remove()
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Prefetch cache
// ══════════════════════════════════════════════════════════════════════════════

interface NavPayload {
  state:  Record<string, unknown>
  params: Record<string, string>
  seo:    SEOMeta
  url:    string
}

const _cache = new Map<string, Promise<NavPayload>>()

function fetchPayload(href: string): Promise<NavPayload> {
  if (!_cache.has(href)) {
    _cache.set(
      href,
      fetch(href, { headers: { [SPA_HEADER]: '1' } })
        .then(r => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
          return r.json() as Promise<NavPayload>
        }),
    )
  }
  return _cache.get(href)!
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  navigate / prefetch
// ══════════════════════════════════════════════════════════════════════════════

export interface NavigateOptions {
  replace?: boolean
  scroll?:  boolean
}

export async function navigate(to: string, opts: NavigateOptions = {}): Promise<void> {
  const u = new URL(to, location.origin)
  if (u.origin !== location.origin) { location.href = to; return }
  if (!findRoute(u.pathname))        { location.href = to; return }

  await runMiddleware(u.pathname, async () => {
    try {
      const payload = await fetchPayload(u.toString())
      history[opts.replace ? 'replaceState' : 'pushState'](
        { url: u.pathname }, '', u.pathname,
      )
      if (opts.scroll !== false) window.scrollTo(0, 0)

      _setNav?.({ path: u.pathname, data: payload.state ?? {}, params: payload.params ?? {} })
      syncSEO(payload.seo ?? {})
    } catch (err) {
      console.error('[fnetro] Navigation error:', err)
      location.href = to
    }
  })
}

/** Warm the prefetch cache for a URL on hover/focus/etc. */
export function prefetch(url: string): void {
  try {
    const u = new URL(url, location.origin)
    if (u.origin !== location.origin || !findRoute(u.pathname)) return
    fetchPayload(u.toString())
  } catch { /* ignore invalid URLs */ }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  DOM event intercepts
// ══════════════════════════════════════════════════════════════════════════════

function onLinkClick(e: MouseEvent): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.composedPath().find(
    (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement,
  )
  if (!a?.href) return
  if (a.target && a.target !== '_self') return
  if (a.hasAttribute('data-no-spa') || a.rel?.includes('external')) return
  const u = new URL(a.href)
  if (u.origin !== location.origin) return
  e.preventDefault()
  navigate(a.href)
}

function onLinkHover(e: MouseEvent): void {
  const a = e.composedPath().find(
    (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement,
  )
  if (a?.href) prefetch(a.href)
}

function onPopState(): void {
  navigate(location.href, { replace: true, scroll: false })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 8  App root component (created inside hydrate's reactive owner)
// ══════════════════════════════════════════════════════════════════════════════

function AppRoot(props: { initial: NavState; appLayout: LayoutDef | undefined }): any {
  const [nav, setNav] = createSignal<NavState>(props.initial)
  // Expose setter so navigate() can trigger re-renders
  _setNav = setNav

  const view = createMemo(() => {
    const { path, data, params } = nav()
    const m = findRoute(path)

    if (!m) {
      // No match client-side — shouldn't happen but handle gracefully
      return null as any
    }

    const layout = m.route.layout !== undefined ? m.route.layout : props.appLayout
    const pageEl = createComponent(m.route.page.Page as any, { ...data, url: path, params })

    if (!layout) return pageEl

    return createComponent(layout.Component as any, {
      url: path,
      params,
      get children() { return pageEl },
    })
  })

  return view
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 9  boot()
// ══════════════════════════════════════════════════════════════════════════════

export interface BootOptions extends AppConfig {
  /** Enable hover-based prefetching.  @default true */
  prefetchOnHover?: boolean
}

export async function boot(options: BootOptions): Promise<void> {
  const { pages } = resolveRoutes(options.routes, {
    layout:     options.layout,
    middleware: [],
  })

  _routes    = pages.map(r => ({ route: r, cp: compilePath(r.fullPath) }))
  _appLayout = options.layout

  const pathname = location.pathname
  if (!findRoute(pathname)) {
    console.warn(`[fnetro] No route matched "${pathname}" — skipping hydration`)
    return
  }

  // Server-injected initial state (no refetch needed on first load)
  const stateMap  = (window as any)[STATE_KEY]  as Record<string, Record<string, unknown>> ?? {}
  const paramsMap = (window as any)[PARAMS_KEY] as Record<string, string>                  ?? {}
  const seoData   = (window as any)[SEO_KEY]    as SEOMeta                                 ?? {}

  const initial: NavState = {
    path:   pathname,
    data:   stateMap[pathname] ?? {},
    params: paramsMap,
  }

  const container = document.getElementById('fnetro-app')
  if (!container) {
    console.error('[fnetro] #fnetro-app not found — aborting hydration')
    return
  }

  // Sync initial SEO (document.title etc.)
  syncSEO(seoData)

  // Hydrate the server-rendered HTML with SolidJS
  hydrate(
    () => createComponent(AppRoot as any, { initial, appLayout: _appLayout }) as any,
    container,
  )

  // Wire up SPA navigation
  document.addEventListener('click', onLinkClick)
  if (options.prefetchOnHover !== false) {
    document.addEventListener('mouseover', onLinkHover)
  }
  window.addEventListener('popstate', onPopState)
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 10  Re-exports
// ══════════════════════════════════════════════════════════════════════════════

export {
  definePage, defineGroup, defineLayout, defineApiRoute,
  resolveRoutes, compilePath, matchPath,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY,
} from './core'

export type {
  AppConfig, PageDef, GroupDef, LayoutDef, ApiRouteDef, Route,
  PageProps, LayoutProps, SEOMeta, HonoMiddleware, LoaderCtx,
  ResolvedRoute, CompiledPath, ClientMiddleware,
} from './core'
