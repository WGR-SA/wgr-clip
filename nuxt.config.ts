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
    // Relative baseURL is required for Tauri's `tauri://` asset resolution
    // in production. In dev (HTTP) it's harmless.
    baseURL: './',
    head: {
      title: 'wgr-clip',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },

  css: ['~/assets/css/fonts.css', '~/assets/css/main.css'],

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
