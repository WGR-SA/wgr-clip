// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  // SSR is left enabled (Nuxt 4 dev's vite-node IPC misbehaves with ssr:false).
  // For Tauri we run `nuxt generate`, which prerenders every route to static
  // HTML — the bundled webview gets the same SPA result either way.

  devtools: {
    enabled: false
  },

  app: {
    // Tauri 2 webview serves assets from `tauri://localhost/` so an absolute
    // baseURL works. (Earlier we used './', but that caused `nuxt generate`
    // to emit redirect stubs instead of real HTML files.)
    head: {
      title: 'wgr-clip',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },

  css: ['~/assets/css/fonts.css', '~/assets/css/main.css'],

  // Force a real static SPA output for `nuxt generate`. Without this Nuxt 4
  // emits "Redirecting..." stubs instead of index.html and the bundled
  // Tauri webview can't find the page. (Don't set this in dev — combining
  // ssr:false + nitro.preset:static breaks Nuxt 4's vite-node IPC.)
  nitro: {
    preset: 'static'
  },

  routeRules: {
    '/': { prerender: true }
  },

  vite: {
    clearScreen: false
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
