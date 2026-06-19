// An empty `.vitepress/theme/` directory makes VitePress try to import this
// `theme/index` entry; without it the production build fails (the dev server
// tolerates it, the build does not). Re-export the default theme so the build
// resolves, leaving a seam here for future customization (custom CSS, layout
// slots, registered global components).
import DefaultTheme from "vitepress/theme";

export default DefaultTheme;
