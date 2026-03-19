// ─────────────────────────────────────────────────────────────────────────────
//  FNetro · core.ts
//  Shared types · route builders · path matching · SEO · constants
//  Reactivity: consumers use solid-js primitives directly
// ─────────────────────────────────────────────────────────────────────────────

import type { Context, MiddlewareHandler, Hono } from 'hono'
import type { Component, JSX } from 'solid-js'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Primitive aliases
// ══════════════════════════════════════════════════════════════════════════════

export type HonoMiddleware = MiddlewareHandler
export type LoaderCtx      = Context

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  SEO / head metadata
// ══════════════════════════════════════════════════════════════════════════════

export interface SEOMeta {
  // Basic
  title?:         string
  description?:   string
  keywords?:      string
  author?:        string
  robots?:        string
  canonical?:     string
  themeColor?:    string
  // Open Graph
  ogTitle?:       string
  ogDescription?: string
  ogImage?:       string
  ogImageAlt?:    string
  ogImageWidth?:  string
  ogImageHeight?: string
  ogUrl?:         string
  ogType?:        string
  ogSiteName?:    string
  ogLocale?:      string
  // Twitter / X
  twitterCard?:        'summary' | 'summary_large_image' | 'app' | 'player'
  twitterSite?:        string
  twitterCreator?:     string
  twitterTitle?:       string
  twitterDescription?: string
  twitterImage?:       string
  twitterImageAlt?:    string
  // Structured data (JSON-LD)
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
  // Arbitrary extra <meta> tags
  extra?: Array<{ name?: string; property?: string; httpEquiv?: string; content: string }>
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  Component prop shapes
// ══════════════════════════════════════════════════════════════════════════════

export type PageProps<TData extends object = {}> = TData & {
  url:    string
  params: Record<string, string>
}

export interface LayoutProps {
  children: JSX.Element
  url:      string
  params:   Record<string, string>
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  Route definitions
// ══════════════════════════════════════════════════════════════════════════════

export interface PageDef<TData extends object = {}> {
  readonly __type:  'page'
  path:             string
  middleware?:      HonoMiddleware[]
  loader?:          (c: LoaderCtx) => TData | Promise<TData>
  seo?:             SEOMeta | ((data: TData, params: Record<string, string>) => SEOMeta)
  layout?:          LayoutDef | false
  Page:             Component<PageProps<TData>>
}

export interface GroupDef {
  readonly __type: 'group'
  prefix:          string
  layout?:         LayoutDef | false
  middleware?:     HonoMiddleware[]
  routes:          Route[]
}

export interface LayoutDef {
  readonly __type: 'layout'
  Component:       Component<LayoutProps>
}

export interface ApiRouteDef {
  readonly __type: 'api'
  path:            string
  register:        (app: Hono, globalMiddleware: HonoMiddleware[]) => void
}

export type Route = PageDef<any> | GroupDef | ApiRouteDef

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  App config
// ══════════════════════════════════════════════════════════════════════════════

export interface AppConfig {
  layout?:    LayoutDef
  seo?:       SEOMeta
  middleware?: HonoMiddleware[]
  routes:     Route[]
  notFound?:  Component
  htmlAttrs?: Record<string, string>
  head?:      string
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  Client middleware
// ══════════════════════════════════════════════════════════════════════════════

export type ClientMiddleware = (
  url:  string,
  next: () => Promise<void>,
) => Promise<void>

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  Builder functions
// ══════════════════════════════════════════════════════════════════════════════

export function definePage<TData extends object = {}>(
  def: Omit<PageDef<TData>, '__type'>,
): PageDef<TData> {
  return { __type: 'page', ...def }
}

export function defineGroup(def: Omit<GroupDef, '__type'>): GroupDef {
  return { __type: 'group', ...def }
}

export function defineLayout(Component: Component<LayoutProps>): LayoutDef {
  return { __type: 'layout', Component }
}

export function defineApiRoute(
  path:     string,
  register: ApiRouteDef['register'],
): ApiRouteDef {
  return { __type: 'api', path, register }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 8  Internal route resolution
// ══════════════════════════════════════════════════════════════════════════════

export interface ResolvedRoute {
  fullPath:   string
  page:       PageDef<any>
  layout:     LayoutDef | false | undefined
  middleware: HonoMiddleware[]
}

export function resolveRoutes(
  routes:  Route[],
  options: {
    prefix?:     string
    middleware?: HonoMiddleware[]
    layout?:     LayoutDef | false
  } = {},
): { pages: ResolvedRoute[]; apis: ApiRouteDef[] } {
  const pages: ResolvedRoute[] = []
  const apis:  ApiRouteDef[]   = []

  for (const route of routes) {
    if (route.__type === 'api') {
      apis.push({ ...route, path: (options.prefix ?? '') + route.path })
    } else if (route.__type === 'group') {
      const prefix = (options.prefix ?? '') + route.prefix
      const mw     = [...(options.middleware ?? []), ...(route.middleware ?? [])]
      const layout = route.layout !== undefined ? route.layout : options.layout
      const sub    = resolveRoutes(route.routes, { prefix, middleware: mw, layout })
      pages.push(...sub.pages)
      apis.push(...sub.apis)
    } else {
      pages.push({
        fullPath:   (options.prefix ?? '') + route.path,
        page:       route,
        layout:     route.layout !== undefined ? route.layout : options.layout,
        middleware: [...(options.middleware ?? []), ...(route.middleware ?? [])],
      })
    }
  }

  return { pages, apis }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 9  Path matching  (used by both server + client)
// ══════════════════════════════════════════════════════════════════════════════

export interface CompiledPath {
  re:   RegExp
  keys: string[]
}

export function compilePath(path: string): CompiledPath {
  const keys: string[] = []
  const src = path
    .replace(/\[\.\.\.([^\]]+)\]/g, (_, k: string) => { keys.push(k); return '(.*)' })
    .replace(/\[([^\]]+)\]/g,       (_, k: string) => { keys.push(k); return '([^/]+)' })
    .replace(/\*/g, '(.*)')
  return { re: new RegExp(`^${src}$`), keys }
}

export function matchPath(
  compiled: CompiledPath,
  pathname: string,
): Record<string, string> | null {
  const m = pathname.match(compiled.re)
  if (!m) return null
  const params: Record<string, string> = {}
  compiled.keys.forEach((k, i) => {
    params[k] = decodeURIComponent(m[i + 1] ?? '')
  })
  return params
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 10  Shared constants
// ══════════════════════════════════════════════════════════════════════════════

export const SPA_HEADER = 'x-fnetro-spa'
export const STATE_KEY  = '__FNETRO_STATE__'
export const PARAMS_KEY = '__FNETRO_PARAMS__'
export const SEO_KEY    = '__FNETRO_SEO__'
