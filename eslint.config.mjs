// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    // Nested git worktrees carry a full copy of the source tree, so every
    // finding in them is a duplicate of one already reported here.
    ignores: ['.claude/**', '.remember/**']
  }
)
